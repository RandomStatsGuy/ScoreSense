/** One in-flight freshness GET per league — shared by the strip and overflow. */

import { apiFetch } from "../auth.js";
import { getFreshnessCache, invalidateFreshnessCache, setFreshnessCache } from "./hubDataCache.js";

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

export function ensureLeagueFreshness(leagueId, { demo = false } = {}) {
  if (!leagueId) return Promise.resolve(null);
  const cached = getFreshnessCache(leagueId);
  if (cached?.data && Date.now() - (cached.at || 0) < FRESHNESS_TTL_MS) {
    return Promise.resolve(cached.data);
  }
  const existing = inflight.get(leagueId);
  if (existing) return existing;

  const request = (async () => {
    const res = await apiFetch(freshnessUrl(leagueId, { demo }));
    if (!res.ok) {
      const err = new Error(`freshness ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const payload = await res.json();
    setFreshnessCache(leagueId, payload);
    return payload;
  })();

  inflight.set(leagueId, request);
  request.finally(() => {
    if (inflight.get(leagueId) === request) inflight.delete(leagueId);
  });
  return request;
}

export function peekLeagueFreshness(leagueId) {
  return getFreshnessCache(leagueId)?.data || null;
}
