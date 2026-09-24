import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Download, Eye, EyeOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, type JobInfo } from "@/lib/api";
import { formatBytes, formatDuration } from "@/lib/utils";

export function ResultPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [job, setJob] = useState<JobInfo | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [resultSize, setResultSize] = useState<number | null>(null);
  const originalRef = useRef<HTMLVideoElement>(null);
  const resultRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!jobId) return;
    api.getJob(jobId).then(setJob).catch(() => {});
  }, [jobId]);

  useEffect(() => {
    // Probe the size of the result file via HEAD
    if (!jobId || !job?.result) return;
    fetch(api.resultUrl(jobId), { method: "HEAD" })
      .then((r) => {
        const cl = r.headers.get("content-length");
        if (cl) setResultSize(parseInt(cl, 10));
      })
      .catch(() => {});
  }, [jobId, job?.result]);

  if (!job) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        Loading…
      </div>
    );
  }

  const origUrl = api.previewUrl(jobId!); // fallback poster
  const resultUrl = api.resultUrl(jobId!);
  const maskUrl = api.maskUrl(jobId!);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Result</h1>
          <p className="mt-2 text-muted-foreground">
            Compare original and processed videos, then download.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              const a = document.createElement("a");
              a.href = maskUrl;
              a.download = `${job.video_meta?.filename ?? "video"}_mask.mp4`;
              a.click();
            }}
          >
            Download Mask
          </Button>
          <Button
            onClick={() => {
              const a = document.createElement("a");
              a.href = resultUrl;
              a.download = `${(job.video_meta?.filename ?? "video").replace(/\.[^.]+$/, "")}_clean.mp4`;
              a.click();
            }}
          >
            <Download className="mr-2 h-4 w-4" />
            Download Result
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-center text-xs">
        <Stat label="Frames" value={String(job.video_meta?.num_frames ?? "—")} />
        <Stat label="Duration" value={formatDuration(job.video_meta?.duration ?? 0)} />
        <Stat
          label="Original"
          value={job.video_meta ? `${job.video_meta.width}×${job.video_meta.height}` : "—"}
        />
        <Stat label="Result Size" value={resultSize ? formatBytes(resultSize) : "—"} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle>
            {showOriginal ? "Original Video" : "Processed Video"}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="success">SAM 2 + ProPainter</Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowOriginal((s) => !s);
                // re-sync playback time
                const from = showOriginal ? originalRef.current : resultRef.current;
                const to = showOriginal ? resultRef.current : originalRef.current;
                if (from && to) {
                  to.currentTime = from.currentTime;
                  if (!from.paused) to.play();
                }
              }}
            >
              {showOriginal ? <Eye className="mr-1 h-3 w-3" /> : <EyeOff className="mr-1 h-3 w-3" />}
              {showOriginal ? "Show result" : "Show original"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <video
              ref={originalRef}
              src={`${api.previewUrl(jobId!)}/../source`}
              controls
              className="w-full rounded-md border bg-black"
              poster={origUrl}
              style={{ display: showOriginal ? "block" : "none" }}
            />
            <video
              ref={resultRef}
              src={resultUrl}
              controls
              autoPlay={!showOriginal}
              className="w-full rounded-md border bg-black"
              poster={maskUrl}
              style={{ display: showOriginal ? "none" : "block" }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}