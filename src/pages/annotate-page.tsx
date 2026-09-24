import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  Crosshair,
  Loader2,
  RefreshCcw,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { VideoFrameAnnotator } from "@/components/video-frame-annotator";
import { VideoFrameClickAnnotator } from "@/components/video-frame-click-annotator";
import {
  api,
  type AnnotationBox,
  type JobInfo,
  type PointAnnotationGroup,
} from "@/lib/api";
import { formatDuration } from "@/lib/utils";

type PromptMode = "click" | "box";

export function AnnotatePage() {
  const { jobId } = useParams<{ jobId: string }>();
  const nav = useNavigate();
  const [job, setJob] = useState<JobInfo | null>(null);
  const [mode, setMode] = useState<PromptMode>("click");

  // Box state
  const [boxes, setBoxes] = useState<AnnotationBox[]>([]);

  // Click state
  const [groups, setGroups] = useState<PointAnnotationGroup[]>([]);
  const [activeObjId, setActiveObjId] = useState(1);
  const [activeFrame, setActiveFrame] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    api
      .getJob(jobId)
      .then(setJob)
      .catch((e) => setError(e.message));
  }, [jobId]);

  const totalClickPoints = groups.reduce((s, g) => s + g.points.length, 0);
  const canSubmit =
    (mode === "box" && boxes.length > 0) ||
    (mode === "click" && totalClickPoints > 0);

  const submit = async () => {
    if (!jobId || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "box") {
        await api.annotate(jobId, boxes);
      } else {
        await api.annotatePoints(jobId, groups);
      }
      await api.startProcessing(jobId);
      nav(`/jobs/${jobId}/processing`);
    } catch (e: any) {
      setError(e.message ?? "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  if (!job) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading job…
      </div>
    );
  }

  const numFrames = job.video_meta?.num_frames ?? 1;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Annotate</h1>
          <p className="mt-2 text-muted-foreground">
            Choose a prompt style and tell SAM 2 what to track.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => window.location.reload()}
        >
          <RefreshCcw className="mr-2 h-3 w-3" /> Refresh
        </Button>
      </div>

      {/* Video meta */}
      <div className="grid grid-cols-4 gap-3 text-center">
        <Stat label="Filename" value={job.video_meta?.filename ?? "—"} />
        <Stat
          label="Resolution"
          value={
            job.video_meta
              ? `${job.video_meta.width}×${job.video_meta.height}`
              : "—"
          }
        />
        <Stat
          label="Duration / FPS"
          value={
            job.video_meta
              ? `${formatDuration(job.video_meta.duration)} · ${job.video_meta.fps.toFixed(1)} fps`
              : "—"
          }
        />
        <Stat label="Frames" value={String(numFrames)} />
      </div>

      {/* Mode switcher */}
      <Tabs
        value={mode}
        onValueChange={(v) => setMode(v as PromptMode)}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="click">
            <Crosshair className="mr-2 h-4 w-4" />
            Click prompt
            <Badge variant="secondary" className="ml-2">
              {totalClickPoints}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="box">
            <Square className="mr-2 h-4 w-4" />
            Box prompt
            <Badge variant="secondary" className="ml-2">
              {boxes.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="click" className="mt-4 space-y-4">
          {/* Object switcher for multi-object tracking */}
          <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3">
            <div className="text-sm">
              <p className="font-medium">Active object</p>
              <p className="text-xs text-muted-foreground">
                Each object is tracked independently across all frames.
              </p>
            </div>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4].map((id) => (
                <Button
                  key={id}
                  size="sm"
                  variant={id === activeObjId ? "default" : "outline"}
                  onClick={() => setActiveObjId(id)}
                  disabled={submitting}
                >
                  obj {id}
                </Button>
              ))}
            </div>
          </div>

          <VideoFrameClickAnnotator
            jobId={jobId!}
            numFrames={numFrames}
            imageUrlForFrame={(f) => `${api.previewUrl(jobId!)}?frame=${f}`}
            objId={activeObjId}
            frameIdx={activeFrame}
            onFrameChange={setActiveFrame}
            groups={groups}
            onChange={setGroups}
            disabled={submitting}
          />
        </TabsContent>

        <TabsContent value="box" className="mt-4">
          <VideoFrameAnnotator
            imageUrl={api.previewUrl(jobId!)}
            onChange={setBoxes}
            disabled={submitting}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Best for: logos, static text watermarks, fixed-size stamps.
            Single box usually suffices.
          </p>
        </TabsContent>
      </Tabs>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <Badge variant={canSubmit ? "success" : "secondary"}>
          Ready to process
        </Badge>
        <Button
          onClick={submit}
          disabled={!canSubmit || submitting}
          size="lg"
        >
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Start Processing
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-medium">{value}</p>
    </div>
  );
}