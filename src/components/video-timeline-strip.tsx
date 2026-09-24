import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ChevronLeft, ChevronRight, Frame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import type { PointAnnotationGroup } from "@/lib/api";
import { cn } from "@/lib/utils";

interface VideoTimelineStripProps {
  jobId: string;
  numFrames: number;
  currentFrame: number;
  onFrameSelect: (frameIdx: number) => void;
  groups: PointAnnotationGroup[];
  /**
   * How many thumbnails to sample across the strip. The rest will be
   * filled by repeating these evenly.
   */
  samples?: number;
  /**
   * Thumbnail pixel width (passed to the backend).
   */
  thumbWidth?: number;
}

interface ThumbState {
  url: string;
  loaded: boolean;
  failed: boolean;
}

/**
 * A horizontal scrolling strip of video frame previews. Lets users jump to
 * any frame by clicking its thumbnail. Shows a heat-map of annotation
 * density so the user can see at a glance which frames they have
 * annotated.
 *
 * Layout:
 *   ┌────────────────────────────────────────────────────────┐
 *   │  [thumb0] [thumb1] [thumb2] ... [thumbN-1]            │
 *   │  (current frame highlighted, points overlaid)         │
 *   └────────────────────────────────────────────────────────┘
 */
export function VideoTimelineStrip({
  jobId,
  numFrames,
  currentFrame,
  onFrameSelect,
  groups,
  samples = 24,
  thumbWidth = 160,
}: VideoTimelineStripProps) {
  // Which frames to display. We sample evenly across the video, but always
  // include frame 0 and currentFrame so the user can find them.
  const displayFrames = useMemo(() => {
    if (numFrames <= 0) return [];
    if (numFrames <= samples) {
      return Array.from({ length: numFrames }, (_, i) => i);
    }
    const step = numFrames / samples;
    const set = new Set<number>([0, currentFrame]);
    for (let i = 0; i < samples; i++) {
      set.add(Math.min(numFrames - 1, Math.floor(i * step)));
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [numFrames, samples, currentFrame]);

  // Track per-frame thumbnail load state
  const [thumbState, setThumbState] = useState<Record<number, ThumbState>>(
    {}
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // Lazy-load: request thumbnail only when scrolled into view
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          const frame = Number(el.dataset.frame);
          if (Number.isNaN(frame)) continue;
          setThumbState((prev) => {
            if (prev[frame]?.loaded || prev[frame]?.failed) return prev;
            return {
              ...prev,
              [frame]: {
                url: api.thumbnailUrl(jobId, frame, thumbWidth),
                loaded: false,
                failed: false,
              },
            };
          });
        }
      },
      { root: containerRef.current, rootMargin: "200px" }
    );
    const items = containerRef.current.querySelectorAll("[data-thumb-anchor]");
    items.forEach((it) => observer.observe(it));
    return () => observer.disconnect();
  }, [jobId, thumbWidth, displayFrames.length]);

  // Scroll active frame into view
  useEffect(() => {
    activeRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [currentFrame]);

  const onThumbError = (frame: number) => {
    // Fallback to previewUrl (the larger preview image). Backend may serve
    // the same JPEG at /preview?frame=N.
    setThumbState((prev) => ({
      ...prev,
      [frame]: {
        url: `${api.previewUrl(jobId)}?frame=${frame}`,
        loaded: false,
        failed: false,
      },
    }));
  };

  const onThumbLoaded = (frame: number) => {
    setThumbState((prev) => ({
      ...prev,
      [frame]: { ...(prev[frame] ?? { url: "" }), loaded: true },
    }));
  };

  // Build density map for heat-map overlay
  const density = useMemo(() => {
    const map: Record<number, number> = {};
    groups.forEach((g) => {
      map[g.frame_idx] = (map[g.frame_idx] ?? 0) + g.points.length;
    });
    return map;
  }, [groups]);
  const maxDensity = Math.max(1, ...Object.values(density));

  const stepPrev = () => onFrameSelect(Math.max(0, currentFrame - 1));
  const stepNext = () =>
    onFrameSelect(Math.min(numFrames - 1, currentFrame + 1));

  // Keyboard navigation when strip has focus
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      stepPrev();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      stepNext();
    } else if (e.key === "Home") {
      e.preventDefault();
      onFrameSelect(0);
    } else if (e.key === "End") {
      e.preventDefault();
      onFrameSelect(numFrames - 1);
    }
  };

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <Frame className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">Timeline</span>
          <Badge variant="secondary" className="ml-1">
            {numFrames} frames
          </Badge>
          <Badge variant={groups.length > 0 ? "success" : "secondary"}>
            {groups.reduce((s, g) => s + g.points.length, 0)} points across{" "}
            {Object.keys(density).length} frames
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={stepPrev}
            disabled={currentFrame === 0}
            aria-label="Previous frame"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={stepNext}
            disabled={currentFrame >= numFrames - 1}
            aria-label="Next frame"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="relative flex max-w-full gap-2 overflow-x-auto pb-1 focus:outline-none focus:ring-2 focus:ring-ring"
        style={{ scrollBehavior: "smooth" }}
      >
        {displayFrames.map((frame) => {
          const ts = thumbState[frame];
          const isCurrent = frame === currentFrame;
          const pts = density[frame] ?? 0;
          const heat = pts / maxDensity;
          return (
            <button
              key={frame}
              ref={isCurrent ? activeRef : undefined}
              data-thumb-anchor
              data-frame={frame}
              onClick={() => onFrameSelect(frame)}
              className={cn(
                "group relative flex shrink-0 flex-col items-stretch overflow-hidden rounded-md border-2 transition",
                isCurrent
                  ? "border-primary shadow-md shadow-primary/20"
                  : "border-border hover:border-primary/50"
              )}
              style={{ width: thumbWidth }}
              aria-label={`Jump to frame ${frame}`}
              aria-current={isCurrent ? "true" : undefined}
            >
              {/* Thumbnail */}
              <div
                className="relative aspect-video bg-black/40"
                style={{ width: thumbWidth, height: Math.round(thumbWidth * 9 / 16) }}
              >
                {ts && !ts.failed && (
                  <img
                    src={ts.url}
                    alt={`Frame ${frame}`}
                    loading="lazy"
                    onLoad={() => onThumbLoaded(frame)}
                    onError={() => onThumbError(frame)}
                    className={cn(
                      "absolute inset-0 h-full w-full object-cover transition-opacity",
                      ts.loaded ? "opacity-100" : "opacity-0"
                    )}
                  />
                )}
                {!ts?.loaded && (
                  <div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
                    #{frame}
                  </div>
                )}
                {/* Density heat-map overlay (green, by point count) */}
                {pts > 0 && (
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background: `linear-gradient(180deg, hsla(140 80% 50% / ${
                        0.15 + heat * 0.55
                      }), hsla(140 80% 50% / ${0.05 + heat * 0.35}))`,
                    }}
                  />
                )}
                {/* Current frame marker */}
                {isCurrent && (
                  <div className="pointer-events-none absolute inset-0 ring-2 ring-primary ring-inset" />
                )}
              </div>
              {/* Caption */}
              <div
                className={cn(
                  "flex items-center justify-between px-1.5 py-1 text-[10px]",
                  isCurrent ? "bg-primary text-primary-foreground" : "bg-muted/50"
                )}
              >
                <span className="font-mono">#{frame}</span>
                {pts > 0 && (
                  <span className="rounded bg-black/30 px-1 font-mono">
                    {pts}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Click any frame to jump. Use ← / → when the strip is focused.
        Brighter thumbnails have more annotations.
      </p>
    </div>
  );
}