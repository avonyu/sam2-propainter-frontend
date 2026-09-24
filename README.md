# SAM 2 + ProPainter — Video Watermark Removal Frontend

A React + Vite + TypeScript frontend for a backend pipeline that:

1. Tracks a watermark across every video frame with **SAM 2**.
2. Fills the masked regions with **ProPainter**.

The frontend lets users upload a local video, draw bounding boxes on the first
frame, watch the pipeline run live via WebSocket, preview the result, and
download the cleaned `.mp4`.

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | React 18 + Vite 5 |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 3 (shadcn-style components) |
| Routing | react-router-dom 6 |
| Icons | lucide-react |
| Networking | Native `fetch` + `XMLHttpRequest` (upload progress) + `WebSocket` |

## Project Layout

```
src/
├── app.tsx                        # Root with router & layout
├── main.tsx                       # ReactDOM bootstrap
├── index.css                      # Tailwind base + theme
├── lib/
│   ├── api.ts                     # Typed REST + WS client
│   └── utils.ts                   # cn(), formatBytes(), formatDuration()
├── hooks/
│   └── use-job-socket.ts          # WS live progress + polling fallback
├── components/
│   ├── ui/
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── badge.tsx
│   │   └── progress.tsx
│   └── video-frame-annotator.tsx  # ⭐ Drag-to-draw + move + resize boxes
└── pages/
    ├── upload-page.tsx            # Step 1 — drag-drop upload
    ├── annotate-page.tsx          # Step 2 — box the watermark(s)
    ├── processing-page.tsx        # Step 3 — live progress + pipeline status
    └── result-page.tsx            # Step 4 — compare & download
```

## Backend Contract

The frontend assumes the following **FastAPI** endpoints (see
`src/lib/api.ts`). The backend is **not included** in this repo — it lives in
[`sam2-propainter-backend`](https://github.com/avonyu/sam2-propainter-backend).

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Health check |
| `/api/upload` | POST (multipart) | Upload video, returns `{job_id}` |
| `/api/job/{job_id}` | GET | Job status, progress, metadata |
| `/api/job/{job_id}/preview` | GET | First-frame JPEG poster |
| `/api/job/{job_id}/annotate` | POST (JSON) | Submit bounding boxes |
| `/api/job/{job_id}/start` | POST | Kick off processing |
| `/api/job/{job_id}/result` | GET | Final MP4 download |
| `/api/job/{job_id}/mask` | GET | Mask MP4 download |
| `/api/ws/{job_id}` | WebSocket | Live progress stream |

### JobInfo schema

```typescript
interface JobInfo {
  job_id: string;
  status:
    | "PENDING" | "UPLOADED" | "ANNOTATED"
    | "SEGMENTING" | "INPAINTING" | "ENCODING"
    | "DONE" | "FAILED";
  progress: number;            // 0..100
  stage: string;               // human-readable
  message?: string;
  created_at: string;          // ISO
  updated_at: string;          // ISO
  video_meta?: {
    filename: string;
    width: number;
    height: number;
    fps: number;
    num_frames: number;
    duration: number;          // seconds
  };
  result?: {
    download_url: string;
    mask_url: string;
    preview_url: string;
  };
  error?: string;
}
```

### ProgressEvent (WebSocket)

```typescript
interface ProgressEvent {
  job_id: string;
  status: JobInfo["status"];
  progress: number;
  stage: string;
  message?: string;
}
```

## Local Development

### 1. Install dependencies

```bash
# Recommended: pnpm
pnpm install
# Or: npm
npm install
# Or: yarn
yarn install
```

### 2. Configure the backend URL

```bash
cp .env.example .env.development
# Edit .env.development to point at your backend
# For local FastAPI: VITE_API_URL=http://localhost:7263
```

### 3. Start dev server

```bash
pnpm dev
# → open http://localhost:7262
```

The dev server binds `0.0.0.0:7262` and accepts all `Host` headers so it works
behind the AutoDL proxy / ngrok without `allowedHosts` errors.

## AutoDL Deployment

1. In AutoDL console → your container → **Custom Services** (自定义服务):
   - Port `7262` (frontend)
   - Port `7263` (backend)

2. SSH into the container, then:
   ```bash
   cd /workspace
   git clone https://github.com/avonyu/sam2-propainter-frontend.git
   cd sam2-propainter-frontend
   pnpm install
   echo 'VITE_API_URL=https://<your-container>-7263.container.autodl.com' > .env.production
   pnpm dev --host 0.0.0.0 --port 7262 &   # for development
   # or, for production:
   pnpm build && pnpm preview --host 0.0.0.0 --port 7262 &
   ```

3. Open the AutoDL-provided link for port 7262.

### Why build, not just dev?

`pnpm build` produces a static bundle in `dist/` that you can serve with any
static server (nginx, Caddy, even Python's `http.server`). It is much more
robust for long-running sessions than the Vite dev server.

```bash
pnpm build
npx serve -s dist -l 0.0.0.0:7262
```

## Browser Support

- Chrome / Edge / Firefox / Safari (latest 2 versions)
- WebSocket required for live progress (a 3-second HTTP polling fallback is
  included as a safety net).

## License

MIT. The actual watermark-removal pipeline uses
[SAM 2](https://github.com/facebookresearch/sam2) (Apache 2.0) and
[ProPainter](https://github.com/sczhou/ProPainter) (check their respective
repositories for their licenses).