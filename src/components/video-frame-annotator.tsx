import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Trash2, Plus, MousePointer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AnnotationBox } from "@/lib/api";
import { cn } from "@/lib/utils";

interface VideoFrameAnnotatorProps {
  /** URL to the first-frame preview image (jpeg) */
  imageUrl: string;
  /** Callback when boxes change */
  onChange?: (boxes: AnnotationBox[]) => void;
  /** Initial boxes */
  initialBoxes?: AnnotationBox[];
  /** Whether interaction is disabled */
  disabled?: boolean;
}

/**
 * Allows the user to draw one or more bounding boxes on the first frame of the video.
 * Each box can be moved/resized via drag handles. The boxes are returned in
 * **original video pixel coordinates** (image-space), not display-space.
 */
export function VideoFrameAnnotator({
  imageUrl,
  onChange,
  initialBoxes = [],
  disabled = false,
}: VideoFrameAnnotatorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null);
  const [boxes, setBoxes] = useState<AnnotationBox[]>(initialBoxes);
  const [drawingBox, setDrawingBox] = useState<AnnotationBox | null>(null);
  const [drag, setDrag] = useState<
    | { boxIdx: number; mode: "move" | "resize-nw" | "resize-ne" | "resize-sw" | "resize-se" }
    | null
  >(null);

  // notify parent
  useEffect(() => {
    onChange?.(boxes);
  }, [boxes, onChange]);

  // when initialBoxes changes (eg. reset), sync
  useEffect(() => {
    setBoxes(initialBoxes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBoxes.length === 0 && boxes.length > 0]); // only when going to zero

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
      const scaleX = imageSize.w / rect.width;
      const scaleY = imageSize.h / rect.height;
      return {
        x: Math.max(0, Math.min(imageSize.w, (clientX - rect.left) * scaleX)),
        y: Math.max(0, Math.min(imageSize.h, (clientY - rect.top) * scaleY)),
        scaleX,
        scaleY,
      };
    },
    [imageSize]
  );

  const onContainerPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    if ((e.target as HTMLElement).closest(".watermark-box")) return; // let box handlers run
    if ((e.target as HTMLElement).closest(".watermark-box-handle")) return;
    if (e.button !== 0) return;
    const coords = toImageCoords(e.clientX, e.clientY);
    if (!coords) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrawingBox({
      x1: coords.x,
      y1: coords.y,
      x2: coords.x,
      y2: coords.y,
    });
  };

  const onContainerPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const coords = toImageCoords(e.clientX, e.clientY);
    if (!coords) return;
    if (drawingBox) {
      setDrawingBox({
        ...drawingBox,
        x2: coords.x,
        y2: coords.y,
      });
      return;
    }
    if (drag) {
      const deltaX = coords.x - (drag as any)._lastX;
      const deltaY = coords.y - (drag as any)._lastY;
      (drag as any)._lastX = coords.x;
      (drag as any)._lastY = coords.y;
      setBoxes((prev) => {
        const next = [...prev];
        const b = { ...next[drag.boxIdx] };
        if (drag.mode === "move") {
          const w = b.x2 - b.x1;
          const h = b.y2 - b.y1;
          b.x1 = clamp(b.x1 + deltaX, 0, imageSize!.w - w);
          b.y1 = clamp(b.y1 + deltaY, 0, imageSize!.h - h);
          b.x2 = b.x1 + w;
          b.y2 = b.y1 + h;
        } else {
          if (drag.mode === "resize-se") {
            b.x2 = clamp(coords.x, b.x1 + 5, imageSize!.w);
            b.y2 = clamp(coords.y, b.y1 + 5, imageSize!.h);
          } else if (drag.mode === "resize-ne") {
            b.x2 = clamp(coords.x, b.x1 + 5, imageSize!.w);
            b.y1 = clamp(coords.y, 0, b.y2 - 5);
          } else if (drag.mode === "resize-sw") {
            b.x1 = clamp(coords.x, 0, b.x2 - 5);
            b.y2 = clamp(coords.y, b.y1 + 5, imageSize!.h);
          } else if (drag.mode === "resize-nw") {
            b.x1 = clamp(coords.x, 0, b.x2 - 5);
            b.y1 = clamp(coords.y, 0, b.y2 - 5);
          }
        }
        next[drag.boxIdx] = b;
        return next;
      });
    }
  };

  const onContainerPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drawingBox) {
      // Normalize and ensure min size
      const x1 = Math.min(drawingBox.x1, drawingBox.x2);
      const y1 = Math.min(drawingBox.y1, drawingBox.y2);
      const x2 = Math.max(drawingBox.x1, drawingBox.x2);
      const y2 = Math.max(drawingBox.y1, drawingBox.y2);
      if (x2 - x1 > 5 && y2 - y1 > 5 && imageSize) {
        setBoxes((prev) => [
          ...prev,
          { x1, y1, x2, y2, label: prev.length + 1 },
        ]);
      }
      setDrawingBox(null);
    }
    if (drag) {
      setDrag(null);
    }
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const onBoxPointerDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    idx: number,
    mode: "move" | "resize-nw" | "resize-ne" | "resize-sw" | "resize-se"
  ) => {
    if (disabled) return;
    e.stopPropagation();
    const coords = toImageCoords(e.clientX, e.clientY);
    if (!coords) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ boxIdx: idx, mode, _lastX: coords.x, _lastY: coords.y } as any);
  };

  const removeBox = (idx: number) => {
    setBoxes((prev) => prev.filter((_, i) => i !== idx));
  };

  const clearAll = () => setBoxes([]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <MousePointer className="h-4 w-4" />
            Annotate Watermark Regions
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Drag on the first frame to draw boxes. Each box is tracked across
            all frames by SAM 2.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={boxes.length > 0 ? "success" : "secondary"}>
            {boxes.length} box{boxes.length !== 1 ? "es" : ""}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={clearAll}
            disabled={disabled || boxes.length === 0}
          >
            <Trash2 className="mr-1 h-3 w-3" /> Clear
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div
          ref={containerRef}
          className={cn(
            "relative w-full select-none overflow-hidden rounded-md border bg-black/40",
            disabled ? "cursor-not-allowed" : "cursor-crosshair"
          )}
          style={{ aspectRatio: imageSize ? `${imageSize.w} / ${imageSize.h}` : "16 / 9" }}
          onPointerDown={onContainerPointerDown}
          onPointerMove={onContainerPointerMove}
          onPointerUp={onContainerPointerUp}
          onPointerCancel={onContainerPointerUp}
        >
          {/* The actual first frame */}
          <img
            ref={imageRef}
            src={imageUrl}
            alt="Video first frame"
            onLoad={onImageLoad}
            className="absolute inset-0 h-full w-full object-contain"
            draggable={false}
            crossOrigin="anonymous"
          />

          {/* Existing boxes (in image-space) */}
          {imageSize &&
            boxes.map((b, i) => (
              <BoxOverlay
                key={i}
                box={b}
                imageSize={imageSize}
                containerRect={containerRef.current?.getBoundingClientRect() ?? null}
                colorIndex={i}
                disabled={disabled}
                onPointerDown={(e, mode) => onBoxPointerDown(e, i, mode)}
                onRemove={() => removeBox(i)}
                label={b.label ?? i + 1}
              />
            ))}

          {/* Drawing box (in-progress) */}
          {imageSize && drawingBox && containerRef.current && (
            <BoxOverlay
              box={drawingBox}
              imageSize={imageSize}
              containerRect={containerRef.current.getBoundingClientRect()}
              colorIndex={-1}
              disabled
              onPointerDown={() => {}}
              onRemove={() => {}}
              label=""
            />
          )}
        </div>

        <p className="mt-2 text-xs text-muted-foreground">
          Tip: For most logos/text watermarks, one box covering them is enough.
          For moving subtitles, you may need one box per region.
        </p>
      </CardContent>
    </Card>
  );
}

interface BoxOverlayProps {
  box: AnnotationBox;
  imageSize: { w: number; h: number };
  containerRect: DOMRect | null;
  colorIndex: number;
  disabled?: boolean;
  label: string | number;
  onPointerDown: (
    e: ReactPointerEvent<HTMLDivElement>,
    mode: "move" | "resize-nw" | "resize-ne" | "resize-sw" | "resize-se"
  ) => void;
  onRemove: () => void;
}

function BoxOverlay({
  box,
  imageSize,
  containerRect,
  colorIndex,
  disabled,
  label,
  onPointerDown,
  onRemove,
}: BoxOverlayProps) {
  if (!containerRect) return null;
  // image-space → container-percent
  const leftPct = (box.x1 / imageSize.w) * 100;
  const topPct = (box.y1 / imageSize.h) * 100;
  const widthPct = ((box.x2 - box.x1) / imageSize.w) * 100;
  const heightPct = ((box.y2 - box.y1) / imageSize.h) * 100;

  const colorHues = [
    "hsl(0 90% 60%)",
    "hsl(45 90% 60%)",
    "hsl(110 80% 55%)",
    "hsl(200 80% 60%)",
    "hsl(280 80% 65%)",
  ];
  const color = colorIndex < 0 ? "hsl(0 0% 90%)" : colorHues[colorIndex % colorHues.length];

  return (
    <div
      className={cn(
        "watermark-box absolute border-2",
        disabled ? "border-dashed" : "border-solid"
      )}
      style={{
        left: `${leftPct}%`,
        top: `${topPct}%`,
        width: `${widthPct}%`,
        height: `${heightPct}%`,
        borderColor: color,
        background: `${color.replace(")", " / 12%)").replace("hsl", "hsla")}`,
      }}
      onPointerDown={(e) => onPointerDown(e, "move")}
    >
      <div
        className="absolute -top-6 left-0 flex items-center gap-1 text-xs font-bold"
        style={{ color }}
      >
        <span className="rounded bg-black/60 px-1.5 py-0.5">{label}</span>
        {!disabled && (
          <button
            className="rounded bg-black/60 p-0.5 hover:bg-black/80"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            title="Remove box"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>

      {!disabled && (
        <>
          <Handle pos="nw" onDown={(e) => onPointerDown(e, "resize-nw")} />
          <Handle pos="ne" onDown={(e) => onPointerDown(e, "resize-ne")} />
          <Handle pos="sw" onDown={(e) => onPointerDown(e, "resize-sw")} />
          <Handle pos="se" onDown={(e) => onPointerDown(e, "resize-se")} />
        </>
      )}
    </div>
  );
}

function Handle({
  pos,
  onDown,
}: {
  pos: "nw" | "ne" | "sw" | "se";
  onDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const style: React.CSSProperties = {
    position: "absolute",
    width: 12,
    height: 12,
    background: "white",
    border: "2px solid currentColor",
    borderRadius: 2,
  };
  if (pos === "nw") Object.assign(style, { left: -6, top: -6 });
  if (pos === "ne") Object.assign(style, { right: -6, top: -6 });
  if (pos === "sw") Object.assign(style, { left: -6, bottom: -6 });
  if (pos === "se") Object.assign(style, { right: -6, bottom: -6 });
  return (
    <div
      className="watermark-box-handle"
      style={{ ...style, color: "hsl(0 90% 60%)" }}
      onPointerDown={onDown}
    />
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}