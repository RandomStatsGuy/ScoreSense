import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../auth";
import { loadAura, loadDayVotes, saveAura, saveDayVotes, recordPlayerVibe, undoPlayerVibe, replayPendingVibes } from "./vibeAura";

function initial(key, dayKey) {
  return { key, auraById: loadAura(key), dayVotes: loadDayVotes(dayKey), history: [], status: "device" };
}

/** Optimistic ratings; late reads rebase pending actions, and writes stay ordered. */
export default function useVibeRatings({ key, dayKey, leagueId, season, week }) {
  const [state, setState] = useState(() => initial(key, dayKey));
  const shown = state.key === key ? state : initial(key, dayKey);
  const current = useRef(shown); current.current = shown;
  const syncRef = useRef(null);
  const activeKey = useRef(key); activeKey.current = key;
  const publish = useCallback((next) => { current.current = next; setState(next); }, []);

  const flush = useCallback(async (sync) => {
    if (!sync?.ready || sync.running || sync.controller.signal.aborted || activeKey.current !== sync.key) return;
    sync.running = true;
    try {
      while (sync.pending && !sync.controller.signal.aborted && activeKey.current === sync.key) {
        const aura = sync.pending; sync.pending = null;
        const res = await apiFetch("/api/hub/vibes", { method: "PUT", signal: sync.controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aura_by_id: aura, season: sync.season, week: sync.week }) });
        if (!res.ok) throw new Error("Rating save failed");
        if (sync.controller.signal.aborted || activeKey.current !== sync.key) return;
      }
      if (!sync.controller.signal.aborted && activeKey.current === sync.key) publish({ ...current.current, status: "saved" });
    } catch {
      if (!sync.controller.signal.aborted && activeKey.current === sync.key) { sync.pending = current.current.auraById; publish({ ...current.current, status: "error" }); }
    } finally { sync.running = false; }
  }, [publish]);

  useEffect(() => {
    const local = initial(key, dayKey); publish(local);
    const controller = new AbortController();
    const sync = { key, controller, season, week, initial: local, operations: [], ready: false, running: false, pending: null };
    syncRef.current = sync;
    if (leagueId && season != null && week != null) (async () => {
      try {
        const params = new URLSearchParams({ season: String(season), week: String(week) });
        const res = await apiFetch(`/api/hub/vibes?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error("Rating read failed");
        const payload = await res.json();
        if (controller.signal.aborted || activeKey.current !== key) return;
        const remote = payload?.aura_by_id;
        if (remote && typeof remote === "object" && !Array.isArray(remote)) {
          const rebased = replayPendingVibes(sync.initial, remote, sync.operations);
          if (sync.pending || (!Object.keys(remote).length && Object.keys(rebased.auraById).length)) sync.pending = rebased.auraById;
          publish({ ...current.current, auraById: rebased.auraById, dayVotes: rebased.dayVotes, history: rebased.history, status: sync.pending ? "saving" : "saved" });
          saveAura(key, rebased.auraById);
        }
      } catch { /* Local ratings stay available if the optional read fails. */ }
      finally {
        if (!controller.signal.aborted && activeKey.current === key) { sync.ready = true; if (sync.pending) void flush(sync); }
      }
    })();
    const midnight = new Date(); midnight.setHours(24, 0, 0, 50);
    const dayTimer = setTimeout(() => { if (activeKey.current === key) publish({ ...current.current, dayVotes: loadDayVotes(dayKey), history: [] }); }, midnight.getTime() - Date.now());
    return () => { controller.abort(); clearTimeout(dayTimer); };
  }, [key, dayKey, leagueId, season, week, flush, publish, shown.dayVotes.date]);

  const persist = useCallback((next, operation) => {
    saveAura(key, next.auraById); saveDayVotes(dayKey, next.dayVotes);
    const sync = syncRef.current;
    const remote = Boolean(leagueId && season != null && week != null);
    publish({ ...next, status: remote ? "saving" : "device" });
    if (remote && sync?.key === key) { if (!sync.ready) sync.operations.push(operation); sync.pending = next.auraById; void flush(sync); }
  }, [key, dayKey, leagueId, season, week, flush, publish]);
  const rate = useCallback((vibe, player) => {
    if (activeKey.current !== key || !player?.player_id) return;
    const next = recordPlayerVibe(current.current, player.player_id, vibe);
    if (next !== current.current) persist(next, { id: String(player.player_id), vibe, now: new Date() });
  }, [key, persist]);
  const undo = useCallback(() => {
    if (activeKey.current !== key) return;
    const prior = current.current, id = prior.history.at(-1)?.playerId;
    if (id) persist(undoPlayerVibe(prior), { undo: true, now: new Date() });
  }, [key, persist]);
  const retry = useCallback(() => { if (syncRef.current?.key === key) { publish({ ...current.current, status: "saving" }); void flush(syncRef.current); } }, [key, flush, publish]);
  return { ...shown, rate, undo, retry };
}
