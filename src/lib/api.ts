/**
 * API client for the SAM 2 + ProPainter backend.
 * Configure `VITE_API_URL` in `.env` (defaults to http://localhost:7263).
 */

export type JobStatus =
  | "PENDING"
  | "UPLOADED"
  | "ANNOTATED"
  | "SEGMENTING"
  | "INPAINTING"
  | "ENCODING"
  | "DONE"
  | "FAILED";

export interface JobInfo {
  job_id: string;
  status: JobStatus;
  progress: number; // 0..100
  stage: string; // human-readable stage
  message?: string;
  created_at: string;
  updated_at: string;
  video_meta?: {
    filename: string;
    width: number;
    height: number;
    fps: number;
    num_frames: number;
    duration: number;
  };
  result?: {
    download_url: string;
    mask_url: string;
    preview_url: string;
  };
  error?: string;
}

export interface AnnotationBox {
  /** [x1, y1, x2, y2] in original video pixel coordinates */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** optional label, default 1 */
  label?: number;
}

/**
 * A single click annotation: 1 = foreground (positive), 0 = background (negative).
 */
export interface PointAnnotation {
  /** 1 = foreground (positive click), 0 = background (negative click) */
  label: 0 | 1;
  x: number;
  y: number;
  obj_id?: number;
}

/**
 * Group of point annotations belonging to one object on one frame.
 * SAM 2 can track multiple objects independently.
 */
export interface PointAnnotationGroup {
  obj_id: number;
  frame_idx: number;
  points: PointAnnotation[];
}

const BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:7263";
const API_PREFIX = "/api";

async function http<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE_URL}${API_PREFIX}${path}`, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  // Some endpoints return 204 (e.g. delete). Handle empty bodies.
  const ct = res.headers.get("content-type") ?? "";
  if (res.status === 204 || !ct.includes("application/json")) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export const api = {
  /** Health probe */
  health: () => http<{ status: "ok"; gpu?: string; models?: string[] }>("/health"),

  /** Upload a video file, returns a new job id */
  upload: (file: File, onProgress?: (pct: number) => void): Promise<{ job_id: string }> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE_URL}${API_PREFIX}/upload`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            reject(new Error("Invalid JSON response"));
          }
        } else {
          reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
        }
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      const fd = new FormData();
      fd.append("file", file);
      xhr.send(fd);
    }),

  /** Get a job's status & metadata */
  getJob: (jobId: string) => http<JobInfo>(`/job/${jobId}`),

  /** Get the first-frame preview (jpeg) */
  previewUrl: (jobId: string) =>
    `${BASE_URL}${API_PREFIX}/job/${jobId}/preview`,

  /** Submit one or more bounding-box annotations */
  annotate: (jobId: string, boxes: AnnotationBox[]) =>
    http<{ ok: true }>(`/job/${jobId}/annotate`, {
      method: "POST",
      body: JSON.stringify({ boxes }),
    }),

  /** Submit point annotations (multi-object, multi-frame) */
  annotatePoints: (jobId: string, groups: PointAnnotationGroup[]) =>
    http<{ ok: true; accepted: number }>(`/job/${jobId}/annotate/points`, {
      method: "POST",
      body: JSON.stringify({ groups }),
    }),

  /**
   * Run SAM 2 image predictor on a single frame with the given clicks,
   * returning a mask preview as a PNG URL. Used for the interactive
   * "click-to-preview" loop in the UI.
   */
  previewSegment: (
    jobId: string,
    frameIdx: number,
    points: PointAnnotation[]
  ): Promise<{ mask_url: string; score: number; png_url: string }> =>
    http(`/job/${jobId}/preview/segment`, {
      method: "POST",
      body: JSON.stringify({ frame_idx: frameIdx, points }),
    }),

  /** Kick off processing (returns immediately, progress via WebSocket) */
  startProcessing: (jobId: string) =>
    http<{ ok: true }>(`/job/${jobId}/start`, { method: "POST" }),

  /** Download the final mp4 */
  resultUrl: (jobId: string) =>
    `${BASE_URL}${API_PREFIX}/job/${jobId}/result`,

  /** Download the mask video (binary mp4) */
  maskUrl: (jobId: string) =>
    `${BASE_URL}${API_PREFIX}/job/${jobId}/mask`,

  /** WebSocket URL for live progress */
  wsUrl: (jobId: string) => {
    const wsProto = BASE_URL.startsWith("https") ? "wss" : "ws";
    const stripped = BASE_URL.replace(/^https?:\/\//, "");
    return `${wsProto}://${stripped}${API_PREFIX}/ws/${jobId}`;
  },
};