import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Eye,
  EyeOff,
  Keyboard,
  Loader2,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type {
  PointAnnotation,
  PointAnnotationGroup,
} from "@/lib/api";
import { api } from "@/lib/api";
import { VideoTimelineStrip } from "@/components/video-timeline-strip";
import { cn } from "@/lib/utils";

type Mode = "positive" | "negative";

interface VideoFrameClickAnnotatorProps {
  jobId: string;
  /** Total number of frames in the video, for the frame-stepper UI. */
  numFrames: number;
  /** URL of the *current* frame preview. Will be refetched when frame changes. */
  imageUrlForFrame: (frameIdx: number) => string;
  /** Currently selected object id (1, 2, 3…). */
  objId: number;
  /** The frame index on which the user is annotating. */
  frameIdx: number;
  /** Called when the user steps to a different frame. */
  onFrameChange?: (frameIdx: number) => void;
  /** All point groups across frames. */
  groups: PointAnnotationGroup[];
  /** Called whenever groups change. */
  onChange?: (groups: PointAnnotationGroup[]) => void;
  /** Disabled state during submission. */
  disabled?: boolean;
}

const OBJ_HUES = [
  "hsl(0 90% 60%)",
  "hsl(45 90% 60%)",
  "hsl(110 80% 55%)",
  "hsl(200 80% 60%)",
  "hsl(280 80% 65%)",
  "hsl(320 80% 60%)",
];

/**
 * Click-to-segment annotation tool (v2).
 *
 * Improvements over v1:
 *  - Multi-frame annotation (jump between frames, points persist per-frame)
 *  - Keyboard shortcuts: +/- toggle mode, Z undo, C clear, [ / ] step frames
 *  - Coalesced in-flight preview requests (only the most recent one wins)
 *  - Confidence threshold slider forwarded to the backend
 *  - Drag-to-edit existing points
 *  - Right-click on empty area to drop a negative point (positive by default)
 *  - Per-frame and per-object legends
 */
export function VideoFrameClickAnnotator({
  jobId,
  numFrames,
  imageUrlForFrame,
  objId,
  frameIdx,
  onFrameChange,
  groups,
  onChange,
  disabled = false,
}: VideoFrameClickAnnotatorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(
    null
  );
  const [mode, setMode] = useState<Mode>("positive");
  const [previewPng, setPreviewPng] = useState<string | null>(null);
  const [previewVisible, setPreviewVisible] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(0.5);

  // Undo/redo stack
  const undoStack = useRef<PointAnnotationGroup[][]>([]);
  const redoStack = useRef<PointAnnotationGroup[][]>([]);

  // In-flight request id for coalescing
  const inflightRef = useRef<number | null>(null);
  const debounceRef = useRef<number | null>(null);

  // Drag-to-edit point state
  const [drag, setDrag] = useState<
    | { groupIdx: number; pointIdx: number }
    | null
  >(null);

  const currentGroup = groups.find(
    (g) => g.frame_idx === frameIdx && g.obj_id === objId
  );
  const currentPoints = currentGroup?.points ?? [];
  const currentImageUrl = imageUrlForFrame(frameIdx);

  // Snapshot for undo
  const pushUndo = useCallback(
    (current: PointAnnotationGroup[]) => {
      undoStack.current.push(JSON.parse(JSON.stringify(current)));
      if (undoStack.current.length > 50) undoStack.current.shift();
      redoStack.current = [];
    },
    []
  );

  // Apply a new groups array (records undo snapshot first)
  const applyGroups = useCallback(
    (next: PointAnnotationGroup[]) => {
      pushUndo(groups);
      onChange?.(next);
    },
    [groups, onChange, pushUndo]
  );

  // notify parent on local mutations from outside (eg. clearAll in toolbar)
  useEffect(() => {
    onChange?.(groups);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  const onImageLoad = useCallback(() => {
    if (imageRef.current) {
      setImageSize({
        w: imageRef.current.naturalWidth,
        h: imageRef.current.naturalHeight,
      });
    }
  }, []);

  // Reset preview when frame changes
  useEffect(() => {
    setPreviewPng(null);
    setPreviewError(null);
    if (currentPoints.length > 0) {
      requestPreviewRefresh(currentPoints);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameIdx]);

  const toImageCoords = useCallback(
    (clientX: number, clientY: number) => {
      if (!containerRef.current || !imageSize) return null;
      const rect = containerRef.current.getBoundingClientRect();
      return {
        x: Math.max(
          0,
          Math.min(imageSize.w, (clientX - rect.left) * (imageSize.w / rect.width))
        ),
        y: Math.max(
          0,
          Math.min(imageSize.h, (clientY - rect.top) * (imageSize.h / rect.height))
        ),
      };
    },
    [imageSize]
  );

  // ----- Adding / removing / clearing points -----

  const addPoint = (x: number, y: number, label: 0 | 1) => {
    const newPoint: PointAnnotation = { label, x, y, obj_id: objId };
    const next = (() => {
      const idx = groups.findIndex(
        (g) => g.frame_idx === frameIdx && g.obj_id === objId
      );
      if (idx < 0) {
        return [
          ...groups,
          { obj_id: objId, frame_idx: frameIdx, points: [newPoint] },
        ];
      }
      return groups.map((g, i) =>
        i === idx ? { ...g, points: [...g.points, newPoint] } : g
      );
    })();
    applyGroups(next);
    requestPreviewRefresh(next.find((g) => g.frame_idx === frameIdx && g.obj_id === objId)?.points ?? []);
  };

  const removePoint = (pointIdx: number) => {
    const next = groups
      .map((g) =>
        g.frame_idx === frameIdx && g.obj_id === objId
          ? { ...g, points: g.points.filter((_, i) => i !== pointIdx) }
          : g
      )
      .filter((g) => g.points.length > 0);
    applyGroups(next);
    const pts = next.find((g) => g.frame_idx === frameIdx && g.obj_id === objId)?.points ?? [];
    if (pts.length === 0) setPreviewPng(null);
    else requestPreviewRefresh(pts);
  };

  const clearCurrentObjectOnFrame = () => {
    const next = groups.filter(
      (g) => !(g.frame_idx === frameIdx && g.obj_id === objId)
    );
    applyGroups(next);
    setPreviewPng(null);
  };

  const clearAll = () => {
    applyGroups([]);
    setPreviewPng(null);
  };

  // ----- Undo / redo -----

  const undo = () => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push(JSON.parse(JSON.stringify(groups)));
    onChange?.(prev);
  };

  const redo = () => {
    const nxt = redoStack.current.pop();
    if (!nxt) return;
    undoStack.current.push(JSON.parse(JSON.stringify(groups)));
    onChange?.(nxt);
  };

  // ----- Preview fetching (debounced + coalesced) -----

  const requestPreviewRefresh = (pts: PointAnnotation[]) => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void runPreview(pts);
    }, 220);
  };

  const runPreview = async (pts: PointAnnotation[]) => {
    if (pts.length === 0) {
      setPreviewPng(null);
      return;
    }
    const reqId = (inflightRef.current ?? 0) + 1;
    inflightRef.current = reqId;
    setLoadingPreview(true);
    setPreviewError(null);
    try {
      const res = await api.previewSegment(
        jobId,
        frameIdx,
        pts,
        threshold
      );
      if (inflightRef.current === reqId) {
        setPreviewPng(res.png_url);
      }
    } catch (e: any) {
      if (inflightRef.current === reqId) {
        setPreviewError(e.message ?? "preview failed");
      }
    } finally {
      if (inflightRef.current === reqId) {
        setLoadingPreview(false);
      }
    }
  };

  // Re-run preview when threshold changes (debounced)
  useEffect(() => {
    if (currentPoints.length === 0) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void runPreview(currentPoints);
    }, 150);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold]);

  // ----- Pointer interactions on the canvas -----

  const onContainerPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    if ((e.target as HTMLElement).closest("[data-overlay-control]")) return;
    if (e.button !== 0) return;
    const coords = toImageCoords(e.clientX, e.clientY);
    if (!coords) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    addPoint(coords.x, coords.y, mode === "positive" ? 1 : 0);
  };

  const onPointPointerDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    groupIdx: number,
    pointIdx: number
  ) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ groupIdx, pointIdx });
  };

  const onPointDragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const coords = toImageCoords(e.clientX, e.clientY);
    if (!coords) return;
    const next = groups.map((g, gi) =>
      gi !== drag.groupIdx
        ? g
        : {
            ...g,
            points: g.points.map((p, pi) =>
              pi !== drag.pointIdx ? p : { ...p, x: coords.x, y: coords.y }
            ),
          }
    );
    // Direct mutation (don't push undo during drag)
    onChange?.(next);
  };

  const onPointDragEnd = () => {
    if (!drag) return;
    setDrag(null);
    // After drag, refetch preview
    const pts =
      groups
        .map((g, gi) => (gi === drag.groupIdx ? g.points : g.points))
        .flat()
        .filter(Boolean);
    requestPreviewRefresh(pts);
  };

  // ----- Keyboard shortcuts -----

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    // ignore when focus is in a text input
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      setMode("positive");
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      setMode("negative");
    } else if (e.key === "z" || e.key === "Z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (e.key === "c" || e.key === "C") {
      e.preventDefault();
      clearCurrentObjectOnFrame();
    } else if (e.key === "ArrowLeft" || e.key === "[") {
      e.preventDefault();
      onFrameChange?.(Math.max(0, frameIdx - 1));
    } else if (e.key === "ArrowRight" || e.key === "]") {
      e.preventDefault();
      onFrameChange?.(Math.min(numFrames - 1, frameIdx + 1));
    }
  };

  // ----- Derived -----

  const totalPoints = useMemo(
    () => groups.reduce((s, g) => s + g.points.length, 0),
    [groups]
  );
  const usedObjIds = useMemo(
    () => Array.from(new Set(groups.map((g) => g.obj_id))).sort(),
    [groups]
  );
  const pointsByFrame = useMemo(() => {
    const map: Record<number, number> = {};
    groups.forEach((g) => {
      map[g.frame_idx] = (map[g.frame_idx] ?? 0) + g.points.length;
    });
    return map;
  }, [groups]);

  const objColor = OBJ_HUES[(objId - 1) % OBJ_HUES.length];

  // Build lookup for point rendering
  const flatPointList: {
    point: PointAnnotation;
    groupIdx: number;
    pointIdx: number;
    isCurrentObj: boolean;
  }[] = [];
  groups.forEach((g, gi) => {
    if (g.frame_idx !== frameIdx) return;
    g.points.forEach((p, pi) => {
      flatPointList.push({
        point: p,
        groupIdx: gi,
        pointIdx: pi,
        isCurrentObj: g.obj_id === objId,
      });
    });
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Crosshair className="h-4 w-4" />
            Click-to-Segment (SAM 2)
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Click on the object to add positive points; click on background to
            exclude. Each click triggers a live SAM 2 mask preview.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={totalPoints > 0 ? "success" : "secondary"}>
            {totalPoints} point{totalPoints !== 1 ? "s" : ""}
          </Badge>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Keyboard className="mr-1 h-3 w-3" /> Shortcuts
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 text-xs">
              <div className="space-y-1 font-mono">
                <Row k="+ / =" v="switch to positive mode" />
                <Row k="− / _" v="switch to negative mode" />
                <Row k="Z" v="undo" />
                <Row k="Shift+Z" v="redo" />
                <Row k="C" v="clear current object" />
                <Row k="← / [" v="previous frame" />
                <Row k="→ / ]" v="next frame" />
              </div>
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            size="sm"
            onClick={clearAll}
            disabled={disabled || totalPoints === 0}
          >
            <Trash2 className="mr-1 h-3 w-3" /> Reset all
          </Button>
        </div>
      </CardHeader>

      <CardContent tabIndex={0} onKeyDown={onKeyDown}>
        {/* Frame stepper */}
        <div className="mb-3 flex items-center justify-between gap-2 rounded-md border bg-muted/30 p-2">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => onFrameChange?.(Math.max(0, frameIdx - 1))}
              disabled={disabled || frameIdx === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => onFrameChange?.(Math.min(numFrames - 1, frameIdx + 1))}
              disabled={disabled || frameIdx >= numFrames - 1}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="ml-2 text-sm tabular-nums">
              Frame{" "}
              <span className="font-mono text-primary">
                {String(frameIdx).padStart(4, "0")}
              </span>
              {" "}/ {numFrames}
            </span>
            {pointsByFrame[frameIdx] !== undefined && (
              <Badge variant="secondary" className="ml-2">
                {pointsByFrame[frameIdx]} pts here
              </Badge>
            )}
          </div>
        </div>

        {/* Mode switcher + confidence slider */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label="Click mode"
            className="inline-flex overflow-hidden rounded-md border"
          >
            <Button
              role="tab"
              aria-selected={mode === "positive"}
              variant={mode === "positive" ? "default" : "ghost"}
              size="sm"
              className="rounded-none"
              onClick={() => setMode("positive")}
              disabled={disabled}
              data-overlay-control
            >
              <Plus className="mr-1 h-3 w-3" /> Positive
            </Button>
            <Button
              role="tab"
              aria-selected={mode === "negative"}
              variant={mode === "negative" ? "destructive" : "ghost"}
              size="sm"
              className="rounded-none"
              onClick={() => setMode("negative")}
              disabled={disabled}
              data-overlay-control
            >
              <Plus className="mr-1 h-3 w-3" /> Negative
            </Button>
          </div>

          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>Object</span>
            <span
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-black"
              style={{ background: objColor }}
            >
              {objId}
            </span>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setPreviewVisible((v) => !v)}
            disabled={!previewPng}
            data-overlay-control
          >
            {previewVisible ? (
              <Eye className="mr-1 h-3 w-3" />
            ) : (
              <EyeOff className="mr-1 h-3 w-3" />
            )}
            {previewVisible ? "Hide mask" : "Show mask"}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={undo}
            disabled={undoStack.current.length === 0}
            data-overlay-control
          >
            <RotateCcw className="mr-1 h-3 w-3" /> Undo
          </Button>

          {/* Confidence threshold */}
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="h-3 w-3" />
            <span>Confidence</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value))}
              className="h-1.5 w-24 accent-primary"
              disabled={disabled}
              data-overlay-control
            />
            <span className="w-8 tabular-nums">{threshold.toFixed(2)}</span>
          </div>

          {loadingPreview && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              predicting…
            </span>
          )}
        </div>

        {/* Frame canvas */}
        <div
          ref={containerRef}
          className={cn(
            "relative w-full select-none overflow-hidden rounded-md border bg-black/40",
            disabled ? "cursor-not-allowed" : "cursor-crosshair"
          )}
          style={{
            aspectRatio: imageSize ? `${imageSize.w} / ${imageSize.h}` : "16 / 9",
          }}
          onPointerDown={onContainerPointerDown}
          onPointerMove={onPointDragMove}
          onPointerUp={onPointDragEnd}
        >
          <img
            key={currentImageUrl /* force reload when frame changes */}
            ref={imageRef}
            src={currentImageUrl}
            alt={`Frame ${frameIdx}`}
            onLoad={onImageLoad}
            className="absolute inset-0 h-full w-full object-contain"
            draggable={false}
            crossOrigin="anonymous"
          />

          {/* Loading overlay (translucent spinner on top of image while previewing) */}
          {loadingPreview && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30">
              <Loader2 className="h-8 w-8 animate-spin text-white" />
            </div>
          )}

          {/* Live mask overlay */}
          {previewPng && previewVisible && (
            <img
              src={previewPng}
              alt="SAM 2 mask preview"
              className="pointer-events-none absolute inset-0 h-full w-full object-contain"
              style={{ opacity: 0.55 }}
            />
          )}

          {/* Point overlays */}
          {imageSize &&
            containerRef.current &&
            flatPointList.map(({ point, groupIdx, pointIdx, isCurrentObj }) => {
              const baseColor =
                point.label === 1 ? "hsl(140 80% 55%)" : "hsl(0 85% 60%)";
              const color = isCurrentObj
                ? baseColor
                : point.label === 1
                  ? "hsl(140 30% 70%)"
                  : "hsl(0 40% 70%)";
              const leftPct = (point.x / imageSize.w) * 100;
              const topPct = (point.y / imageSize.h) * 100;
              return (
                <div
                  key={`${groupIdx}-${pointIdx}`}
                  title={`obj ${point.obj_id ?? objId} · ${point.label === 1 ? "+" : "−"}`}
                  data-overlay-control
                  onPointerDown={(e) => onPointPointerDown(e, groupIdx, pointIdx)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    removePoint(pointIdx);
                  }}
                  className={cn(
                    "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2",
                    !disabled && "cursor-move"
                  )}
                  style={{
                    left: `${leftPct}%`,
                    top: `${topPct}%`,
                    width: 18,
                    height: 18,
                    background: color,
                    borderColor: "white",
                  }}
                />
              );
            })}
        </div>

        {/* Object legend */}
        {usedObjIds.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
            {usedObjIds.map((id) => {
              const color = OBJ_HUES[(id - 1) % OBJ_HUES.length];
              const count = groups
                .filter((g) => g.obj_id === id)
                .reduce((s, g) => s + g.points.length, 0);
              return (
                <div
                  key={id}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-2 py-1",
                    id === objId ? "border-primary bg-primary/10" : ""
                  )}
                >
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ background: color }}
                  />
                  <span>obj {id}</span>
                  <span className="text-muted-foreground">({count})</span>
                </div>
              );
            })}
          </div>
        )}

        {previewError && (
          <div className="mt-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
            Preview error: {previewError}
          </div>
        )}

        <div className="mt-3 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={clearCurrentObjectOnFrame}
            disabled={disabled || currentPoints.length === 0}
            data-overlay-control
          >
            Clear object {objId} on this frame
          </Button>
          <p className="text-xs text-muted-foreground">
            Drag points to fine-tune · Double-click to delete · Press
            <kbd className="mx-1 rounded border bg-muted px-1 font-mono text-[10px]">?</kbd>
            for shortcuts
          </p>
        </div>

        {/* Timeline strip */}
        <div className="mt-4">
          <VideoTimelineStrip
            jobId={jobId}
            numFrames={numFrames}
            currentFrame={frameIdx}
            onFrameSelect={(f) => onFrameChange?.(f)}
            groups={groups}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <kbd className="rounded border bg-muted px-1 text-[10px]">{k}</kbd>
      <span className="text-muted-foreground">{v}</span>
    </div>
  );
}