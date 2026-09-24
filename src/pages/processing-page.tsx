import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useJobSocket } from "@/hooks/use-job-socket";
import { api, type JobInfo, type JobStatus } from "@/lib/api";

const STAGE_LABEL: Record<JobStatus, string> = {
  PENDING: "Waiting…",
  UPLOADED: "Uploaded",
  ANNOTATED: "Annotations saved",
  SEGMENTING: "Tracking watermark with SAM 2…",
  INPAINTING: "Filling masked regions with ProPainter…",
  ENCODING: "Encoding output video…",
  DONE: "Complete",
  FAILED: "Failed",
};

export function ProcessingPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const nav = useNavigate();
  const [job, setJob] = useState<JobInfo | null>(null);
  const { latest, connected } = useJobSocket(jobId ?? null);

  // Keep the job metadata in sync (polled via WS hook fallback too)
  useEffect(() => {
    if (!jobId) return;
    api.getJob(jobId).then(setJob).catch(() => {});
  }, [jobId]);

  // Auto-navigate to result on DONE
  useEffect(() => {
    if (latest?.status === "DONE" && jobId) {
      const t = setTimeout(() => nav(`/jobs/${jobId}/result`), 800);
      return () => clearTimeout(t);
    }
  }, [latest?.status, jobId, nav]);

  // Re-fetch metadata on every progress event
  useEffect(() => {
    if (!jobId || !latest) return;
    api.getJob(jobId).then(setJob).catch(() => {});
  }, [latest, jobId]);

  const status: JobStatus = latest?.status ?? job?.status ?? "PENDING";
  const progress = latest?.progress ?? job?.progress ?? 0;
  const stage = latest?.stage ?? STAGE_LABEL[status];

  const done = status === "DONE";
  const failed = status === "FAILED";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Processing</h1>
        <p className="mt-2 text-muted-foreground">
          Live progress of SAM 2 segmentation + ProPainter inpainting.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2">
            {failed ? (
              <XCircle className="h-5 w-5 text-destructive" />
            ) : done ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            )}
            {STAGE_LABEL[status]}
          </CardTitle>
          <Badge variant={connected ? "success" : "secondary"}>
            {connected ? "live" : "polling"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <Progress value={progress} />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{stage}</span>
            <span>{Math.round(progress)}%</span>
          </div>

          {latest?.message && (
            <div className="rounded-md border bg-muted/30 p-2 text-xs">
              {latest.message}
            </div>
          )}

          {failed && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {job?.error ?? "Processing failed."}
              <div className="mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => jobId && api.startProcessing(jobId)}
                >
                  Retry
                </Button>
              </div>
            </div>
          )}

          {done && (
            <Button onClick={() => jobId && nav(`/jobs/${jobId}/result`)}>
              View Result →
            </Button>
          )}
        </CardContent>
      </Card>

      <PipelineSteps status={status} />
    </div>
  );
}

const PIPELINE: JobStatus[] = [
  "ANNOTATED",
  "SEGMENTING",
  "INPAINTING",
  "ENCODING",
  "DONE",
];
const PIPELINE_LABEL: Record<JobStatus, string> = {
  ANNOTATED: "Annotations submitted",
  SEGMENTING: "SAM 2 propagates mask",
  INPAINTING: "ProPainter fills regions",
  ENCODING: "Encoding MP4",
  DONE: "Result ready",
  PENDING: "Pending",
  UPLOADED: "Uploaded",
  FAILED: "Failed",
};

function PipelineSteps({ status }: { status: JobStatus }) {
  const currentIdx = PIPELINE.indexOf(status);
  return (
    <Card>
      <CardContent className="pt-6">
        <ol className="grid grid-cols-5 gap-2">
          {PIPELINE.map((s, i) => {
            const reached = i <= currentIdx || status === "DONE";
            const active = i === currentIdx && status !== "DONE";
            return (
              <li
                key={s}
                className={
                  "rounded-md border p-3 text-center text-xs transition " +
                  (active
                    ? "border-primary bg-primary/10 text-primary"
                    : reached
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : "border-border text-muted-foreground")
                }
              >
                <p className="text-sm font-semibold">{i + 1}</p>
                <p className="mt-1 leading-tight">{PIPELINE_LABEL[s]}</p>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}