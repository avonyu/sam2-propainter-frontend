import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Crosshair,
  Loader2,
  Plus,
  Trash2,
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type {
  PointAnnotation,
  PointAnnotationGroup,
} from "@/lib/api";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Mode = "positive" | "negative";

interface VideoFrameClickAnnotatorProps {
  jobId: string;
  /** URL to the first-frame preview image (jpeg) */
  imageUrl: string;
  /** Currently selected object id (1, 2, 3…). */
  objId: number;
  /** The frame index on which the user is annotating. */
  frameIdx: number;
  /** All point groups across frames (this component owns the points on `frameIdx`). */
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
];

/**
 * Click-to-segment annotation tool.
 *
 * Click anywhere on the first frame to drop a positive (green) or negative
 * (red) point. SAM 2's image predictor runs on the backend and returns a
 * mask preview PNG that is overlaid on the image. Multi-object tracking is
 * supported: each object has its own color.
 */
export function VideoFrameClickAnnotator({
  jobId,
  imageUrl,
  objId,
  frameIdx,
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

  // The points for the current frame & current obj_id
  const currentGroup = groups.find(
    (g) => g.frame_idx === frameIdx && g.obj_id === objId
  );
  const currentPoints = currentGroup?.points ?? [];

  // notify parent when groups change
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

  // Coordinate helpers: client-space → image-space
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

  // Drop a point on the current frame for the current object
  const onContainerPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.button !== 0) return;
    // ignore clicks on UI controls inside the container
    if ((e.target as HTMLElement).closest("[data-overlay-control]")) return;
    const coords = toImageCoords(e.clientX, e.clientY);
    if (!coords) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

    const newPoint: PointAnnotation = {
      label: mode === "positive" ? 1 : 0,
      x: coords.x,
      y: coords.y,
      obj_id: objId,
    };

    // Add to current group or create new
    const next: PointAnnotationGroup[] = (() => {
      const exists = groups.find(
        (g) => g.frame_idx === frameIdx && g.obj_id === objId
      );
      if (!exists) {
        return [
          ...groups,
          { obj_id: objId, frame_idx: frameIdx, points: [newPoint] },
        ];
      }
      return groups.map((g) =>
        g.frame_idx === frameIdx && g.obj_id === objId
          ? { ...g, points: [...g.points, newPoint] }
          : g
      );
    })();

    // trigger via setState (we can't directly mutate `groups`)
    setGroups(next);
    requestPreviewRefresh();
  };

  const setGroups = (next: PointAnnotationGroup[]) => {
    // mutate via internal event-like pattern
    onChange?.(next);
  };

  const removePoint = (idx: number) => {
    const next = groups
      .map((g) =>
        g.frame_idx === frameIdx && g.obj_id === objId
          ? { ...g, points: g.points.filter((_, i) => i !== idx) }
          : g
      )
      .filter((g) => g.points.length > 0);
    onChange?.(next);
    requestPreviewRefresh();
  };

  const clearCurrent = () => {
    const next = groups.filter(
      (g) => !(g.frame_idx === frameIdx && g.obj_id === objId)
    );
    onChange?.(next);
    setPreviewPng(null);
  };

  const clearAll = () => {
    onChange?.([]);
    setPreviewPng(null);
  };

  // Request a preview mask from the backend whenever points change
  const refreshTimerRef = useRef<number | null>(null);
  const requestPreviewRefresh = () => {
    if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(async () => {
      await runPreview();
    }, 250); // debounce
  };

  const runPreview = async () => {
    if (currentPoints.length === 0) {
      setPreviewPng(null);
      return;
    }
    setLoadingPreview(true);
    setPreviewError(null);
    try {
      const res = await api.previewSegment(jobId, frameIdx, currentPoints);
      setPreviewPng(res.png_url);
    } catch (e: any) {
      setPreviewError(e.message ?? "preview failed");
    } finally {
      setLoadingPreview(false);
    }
  };

  const totalPoints = groups.reduce((s, g) => s + g.points.length, 0);
  const usedObjIds = Array.from(new Set(groups.map((g) => g.obj_id))).sort();
  const objColor = OBJ_HUES[(objId - 1) % OBJ_HUES.length];

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

      <CardContent>
        {/* Toolbar */}
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
            Object:
            <span
              className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-black"
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
        >
          <img
            ref={imageRef}
            src={imageUrl}
            alt="Video frame"
            onLoad={onImageLoad}
            className="absolute inset-0 h-full w-full object-contain"
            draggable={false}
            crossOrigin="anonymous"
          />

          {/* Live mask overlay (semi-transparent PNG) */}
          {previewPng && previewVisible && (
            <img
              src={previewPng}
              alt="SAM 2 mask preview"
              className="pointer-events-none absolute inset-0 h-full w-full object-contain"
              style={{ opacity: 0.55, mixBlendMode: "normal" }}
            />
          )}

          {/* Point overlays */}
          {imageSize &&
            containerRef.current &&
            currentPoints.map((p, i) => {
              const color = p.label === 1 ? "hsl(140 80% 55%)" : "hsl(0 85% 60%)";
              const leftPct = (p.x / imageSize.w) * 100;
              const topPct = (p.y / imageSize.h) * 100;
              return (
                <button
                  key={i}
                  title={`${p.label === 1 ? "+" : "−"} click #${i + 1}`}
                  data-overlay-control
                  onClick={(e) => {
                    e.stopPropagation();
                    removePoint(i);
                  }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition hover:scale-110"
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

        {/* Object legend (if multiple objects were used) */}
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
            onClick={clearCurrent}
            disabled={disabled || currentPoints.length === 0}
            data-overlay-control
          >
            Clear object {objId}
          </Button>
          <p className="text-xs text-muted-foreground">
            Tip: For best results, click the most central / representative part
            of the object. Add a negative point on a similar-looking
            neighbouring region to disambiguate.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}