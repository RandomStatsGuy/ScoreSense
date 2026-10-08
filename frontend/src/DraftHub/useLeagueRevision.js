import { useEffect, useRef } from "react";
import { apiFetch } from "../auth";
import { LEAGUE_REVISION_POLL_MS, nextLeagueRevision } from "./leagueRevision";

/** Calls onChange when the league's saved rosters or contracts change on the server. */
export default function useLeagueRevision(leagueId, onChange, { enabled = true, intervalMs = LEAGUE_REVISION_POLL_MS } = {}) {
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    if (!enabled || !leagueId) return undefined;
    const ctrl = new AbortController();
    let known = null;
    let pending = false;
    const check = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/revision`, { signal: ctrl.signal });
        if (!res.ok || ctrl.signal.aborted) return;
        const next = nextLeagueRevision(known, await res.json());
        known = next.known;
        if (next.changed && !ctrl.signal.aborted) latest.current?.();
      } catch {
        /* The next tick retries. */
      } finally {
        pending = false;
      }
    };
    check();
    const timer = window.setInterval(check, intervalMs);
    document.addEventListener("visibilitychange", check);
    return () => {
      ctrl.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [leagueId, enabled, intervalMs]);
}
