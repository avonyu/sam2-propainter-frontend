import { useEffect, useRef, useState } from "react";
import type { JobInfo } from "@/lib/api";
import { api } from "@/lib/api";

export interface ProgressEvent {
  job_id: string;
  status: JobInfo["status"];
  progress: number;
  stage: string;
  message?: string;
  timestamp: number;
}

export function useJobSocket(jobId: string | null, enabled = true) {
  const [latest, setLatest] = useState<ProgressEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!jobId || !enabled) return;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const ws = new WebSocket(api.wsUrl(jobId));
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectRef.current = 0;
      };

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          setLatest({ ...data, timestamp: Date.now() });
        } catch {
          // ignore malformed frames
        }
      };

      ws.onerror = () => {
        // Will trigger onclose
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (cancelled) return;

        // Reconnect with backoff (poll fallback handled by setInterval too)
        reconnectRef.current = Math.min(reconnectRef.current + 1, 6);
        const delay = Math.min(1000 * 2 ** reconnectRef.current, 15000);
        timerRef.current = window.setTimeout(connect, delay);
      };
    };

    connect();

    // Fallback poll every 3s in case WS is blocked by proxy
    const poll = window.setInterval(async () => {
      if (cancelled) return;
      try {
        const job = await api.getJob(jobId);
        setLatest({
          job_id: job.job_id,
          status: job.status,
          progress: job.progress,
          stage: job.stage,
          message: job.message,
          timestamp: Date.now(),
        });
      } catch {
        // ignore
      }
    }, 3000);

    return () => {
      cancelled = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      window.clearInterval(poll);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [jobId, enabled]);

  return { latest, connected };
}