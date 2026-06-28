import { useCallback, useEffect, useRef } from "react";
import { apiFetch } from "./auth";

const POLL_MS = 12_000;

/**
 * Poll /api/accuracy/status while a rebuild is in flight.
 * Does not auto-fetch reports — calls onReady when outputs are updated.
 */
export default function useAccuracyRebuildPoll({ active, onReady, onError }) {
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onReadyRef.current = onReady;
    onErrorRef.current = onError;
  }, [onReady, onError]);

  const pollOnce = useCallback(async () => {
    const res = await apiFetch("/api/accuracy/status");
    if (!res.ok) return null;
    return res.json();
  }, []);

  useEffect(() => {
    if (!active) return undefined;

    let cancelled = false;

    const handleStatus = (data) => {
      if (!data || cancelled) return;
      if (data.error) {
        onErrorRef.current?.(data.error);
        return;
      }
      if (data.ready_to_load) {
        onReadyRef.current?.(data);
      }
    };

    pollOnce().then(handleStatus).catch(() => {});

    const id = window.setInterval(() => {
      pollOnce().then(handleStatus).catch(() => {});
    }, POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [active, pollOnce]);

  return { pollOnce };
}
