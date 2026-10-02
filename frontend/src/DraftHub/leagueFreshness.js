/** One in-flight freshness GET per league — shared by the strip and overflow. */

import { apiFetch } from "../auth.js";
import { parseApiError } from "../format.js";
import { getFreshnessCache, invalidateFreshnessCache, setFreshnessCache } from "./hubDataCache.js";
import { PROJECTION_SYNC_COPY } from "./leagueAccessCopy.js";

const inflight = new Map();
const FRESHNESS_TTL_MS = 30_000;

export function resetLeagueFreshnessForTests() {
  inflight.clear();
  invalidateFreshnessCache();
}

export function freshnessInflightCount() {
  return inflight.size;
}

export function freshnessUrl(leagueId, { demo = false } = {}) {
  const root = demo ? "/api/hub/demo" : "/api/hub";
  return `${root}/league/${encodeURIComponent(leagueId)}/freshness`;
}

export function ensureLeagueFreshness(leagueId, { demo = false, force = false } = {}) {
  if (!leagueId) return Promise.resolve(null);
  const cached = getFreshnessCache(leagueId);
  if (!force && cached?.data && Date.now() - (cached.at || 0) < FRESHNESS_TTL_MS) {
    return Promise.resolve(cached.data);
  }
  const existing = inflight.get(leagueId);
  if (existing) return existing;

  const request = (async () => {
    const res = await apiFetch(freshnessUrl(leagueId, { demo }));
    if (!res.ok) {
      const err = new Error(await parseApiError(res, PROJECTION_SYNC_COPY.failed));
      err.status = res.status;
      throw err;
    }
    const payload = await res.json();
    setFreshnessCache(leagueId, payload);
    return payload;
  })();

  inflight.set(leagueId, request);
  const settled = () => {
    if (inflight.get(leagueId) === request) inflight.delete(leagueId);
  };
  request.then(settled, settled);
  return request;
}

function checkSyncAbort(signal) {
  if (signal?.aborted) throw new DOMException("Projection sync canceled", "AbortError");
}

function waitForSyncPoll(ms, signal) {
  return new Promise((resolve, reject) => {
    checkSyncAbort(signal);
    const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("Projection sync canceled", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** Wait for actual current forecasts, then replace the displayed saved values. */
export async function syncLeagueProjections(leagueId, {
  refresh, signal, onUpdate = () => {}, demo = false,
  wait = waitForSyncPoll, now = Date.now, timeoutMs = 10 * 60_000, pollMs = 5_000,
} = {}) {
  const started = now();
  const reload = async () => {
    checkSyncAbort(signal);
    const result = await refresh({ signal });
    checkSyncAbort(signal);
    if (!result) throw new Error(PROJECTION_SYNC_COPY.failed);
    return result;
  };
  await reload();
  while (now() - started < timeoutMs) {
    checkSyncAbort(signal);
    const payload = await ensureLeagueFreshness(leagueId, { demo, force: true });
    checkSyncAbort(signal);
    onUpdate(payload);
    const projections = payload?.projections;
    if (projections?.available && !projections.stale) {
      const latest = await reload();
      if (!latest.projection_stale) return {
        ...payload,
        projections: { ...projections, built_at: latest.projection_built_at || projections.built_at },
      };
    } else {
      const recovery = projections?.recovery;
      if (recovery?.status === "error") throw new Error(PROJECTION_SYNC_COPY.failed);
      if (["idle", "ok", "busy"].includes(recovery?.status)
          && !(recovery.retry_after_seconds > 0)) await reload();
    }
    await wait(Math.min(pollMs, Math.max(0, timeoutMs - (now() - started))), signal);
  }
  checkSyncAbort(signal);
  throw new Error(PROJECTION_SYNC_COPY.timeout);
}

export function peekLeagueFreshness(leagueId) {
  return getFreshnessCache(leagueId)?.data || null;
}
