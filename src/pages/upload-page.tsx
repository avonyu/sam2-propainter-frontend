import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { UploadCloud, FileVideo, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/utils";

export function UploadPage() {
  const nav = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith("video/")) {
      setFile(f);
      setError(null);
    } else {
      setError("Please drop a video file");
    }
  }, []);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setError(null);
    }
  };

  const submit = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { job_id } = await api.upload(file, setProgress);
      nav(`/jobs/${job_id}/annotate`);
    } catch (e: any) {
      setError(e.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Upload Video</h1>
        <p className="mt-2 text-muted-foreground">
          Upload a video file containing the watermark you want to remove. SAM 2
          will track the watermark across frames, and ProPainter will fill in
          the masked regions.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div
            className={
              "relative flex min-h-[260px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition " +
              (dragging
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/60")
            }
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => document.getElementById("file-input")?.click()}
          >
            <UploadCloud className="mb-4 h-10 w-10 text-muted-foreground" />
            <p className="text-base font-medium">
              Drag & drop a video, or click to browse
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              MP4 / MOV / AVI · up to ~500 MB
            </p>
            <input
              id="file-input"
              type="file"
              accept="video/*"
              className="hidden"
              onChange={onPick}
            />
          </div>

          {file && (
            <div className="mt-4 flex items-center justify-between rounded-md border p-3">
              <div className="flex items-center gap-3">
                <FileVideo className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(file.size)}
                  </p>
                </div>
              </div>
              <Badge variant="secondary">ready</Badge>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {uploading && (
            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Uploading…</span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setFile(null)}
              disabled={uploading || !file}
            >
              Reset
            </Button>
            <Button
              onClick={submit}
              disabled={!file || uploading}
            >
              {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Next: Annotate Watermark
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-4 text-center text-xs text-muted-foreground">
        <div className="rounded-md border p-3">
          <p className="font-medium text-foreground">1 · Upload</p>
          <p>Send your video to the server</p>
        </div>
        <div className="rounded-md border p-3 bg-primary/5">
          <p className="font-medium text-foreground">2 · Annotate</p>
          <p>Draw boxes around the watermark</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="font-medium text-foreground">3 · Download</p>
          <p>Get the cleaned video back</p>
        </div>
      </div>
    </div>
  );
}