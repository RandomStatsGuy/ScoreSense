import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "./auth";
import { isAbortError } from "./fetchAbort";
import { connectionErrorMessage, parseApiError } from "./format";
import { indexPlayersContext } from "./playerContextDisplay";

/**
 * Batch-load the SCORE-23/30 cached player-context list for a slate.
 * One GET /api/players/context?compact=true per season/week — table-safe fields only.
 * Heavy excerpts/sources/summaries/drivers lazy-load via PlayerContextPanel detail.
 */
export default function usePlayersContext(
  season,
  week,
  { enabled = true, refreshToken = 0 } = {},
) {
  const [byId, setById] = useState(() => new Map());
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!enabled || season == null || week == null) {
      setById(new Map());
      setMeta(null);
      setError("");
      setUnavailable(false);
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setLoading(true);
    setError("");
    setUnavailable(false);

    const params = new URLSearchParams();
    params.set("season", String(season));
    params.set("week", String(week));
    // SCORE-30: always request compact list; never pull narrative bodies for tables.
    params.set("compact", "true");
    const q = `?${params.toString()}`;

    (async () => {
      try {
        const res = await apiFetch(`/api/players/context${q}`, {
          signal: controller.signal,
        });
        if (res.status === 503) {
          setById(new Map());
          setMeta(null);
          setUnavailable(true);
          setError("");
          return;
        }
        if (!res.ok) {
          throw new Error(await parseApiError(res, "Failed to load player context"));
        }
        const payload = await res.json();
        setById(indexPlayersContext(payload));
        setMeta(payload.meta || null);
        setUnavailable(false);
      } catch (err) {
        if (isAbortError(err)) return;
        setById(new Map());
        setMeta(null);
        setError(connectionErrorMessage(err, "Failed to load player context"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [enabled, season, week, refreshToken]);

  return useMemo(
    () => ({ byId, meta, loading, error, unavailable }),
    [byId, meta, loading, error, unavailable],
  );
}
