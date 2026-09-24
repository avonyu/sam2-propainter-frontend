import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, Loader2, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VideoFrameAnnotator } from "@/components/video-frame-annotator";
import { api, type AnnotationBox, type JobInfo } from "@/lib/api";
import { formatDuration } from "@/lib/utils";

export function AnnotatePage() {
  const { jobId } = useParams<{ jobId: string }>();
  const nav = useNavigate();
  const [job, setJob] = useState<JobInfo | null>(null);
  const [boxes, setBoxes] = useState<AnnotationBox[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    api
      .getJob(jobId)
      .then(setJob)
      .catch((e) => setError(e.message));
  }, [jobId]);

  const submit = async () => {
    if (!jobId || boxes.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.annotate(jobId, boxes);
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

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Annotate</h1>
          <p className="mt-2 text-muted-foreground">
            Draw one or more bounding boxes around every watermark region in the
            first frame. SAM 2 will propagate these masks to every frame.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
          <RefreshCcw className="mr-2 h-3 w-3" /> Re-fetch preview
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
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
      </div>

      <VideoFrameAnnotator
        imageUrl={api.previewUrl(jobId!)}
        onChange={setBoxes}
        disabled={submitting}
      />

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <Badge variant={boxes.length > 0 ? "success" : "secondary"}>
          {boxes.length} annotation{boxes.length !== 1 ? "s" : ""} ready
        </Badge>
        <Button
          onClick={submit}
          disabled={boxes.length === 0 || submitting}
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