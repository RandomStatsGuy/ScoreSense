import { apiFetch } from "../auth";
import { parseApiError } from "../format";

/** @typedef {{ league_id: string, league_name: string, room_code: string, league_season: number, is_commissioner: boolean, team: { id: string, name: string } }} HubMembership */

export function membershipFromContext(hubContext) {
  if (hubContext?.mode !== "league" || !hubContext?.league_id) return null;
  return {
    league_id: hubContext.league_id,
    league_name: hubContext.league_name || "League",
    room_code: hubContext.league_room_code || "",
    league_season: hubContext.season,
    is_commissioner: Boolean(hubContext.is_commissioner),
    team: {
      id: hubContext.team_id,
      name: hubContext.team_name || "Team",
    },
  };
}

/** Merge API list with active league from hub context (covers stale API / failed fetch). */
export function effectiveMemberships(memberships, hubContext) {
  const list = [...(memberships || [])];
  const fromCtx = membershipFromContext(hubContext);
  if (fromCtx && !list.some((m) => m.league_id === fromCtx.league_id)) {
    list.unshift(fromCtx);
  }
  const seen = new Set();
  return list.filter((m) => {
    if (!m?.league_id || seen.has(m.league_id)) return false;
    seen.add(m.league_id);
    return true;
  });
}

export async function fetchHubMemberships() {
  const res = await apiFetch("/api/hub/memberships");
  if (res.status === 404) {
    return { memberships: [], legacyApi: true };
  }
  if (!res.ok) throw new Error(await parseApiError(res));
  return res.json();
}

async function requestActiveLeague(body) {
  const init = {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
  let res = await apiFetch("/api/hub/active-league", init);
  if (res.status === 405 || res.status === 404) {
    res = await apiFetch("/api/hub/active-league", { ...init, method: "POST" });
  }
  return res;
}

/**
 * @param {{ leagueId?: string | null, solo?: boolean }} opts
 */
export async function setHubFocus({ leagueId = null, solo = false } = {}) {
  const body = {
    league_id: solo ? null : leagueId,
    solo: Boolean(solo),
  };
  const res = await requestActiveLeague(body);
  if (res.status === 405 || res.status === 404) {
    throw new Error(
      "League switching is temporarily unavailable. Please refresh the page and try again.",
    );
  }
  if (!res.ok) throw new Error(await parseApiError(res));
  return res.json();
}

export function membershipLabel(m) {
  const team = m?.team?.name || "Team";
  const league = m?.league_name || "League";
  return `${league} · ${team}`;
}

export function isSoloContext(hubContext) {
  return hubContext?.mode !== "league" || !hubContext?.league_id;
}

export function isActiveMembership(m, hubContext) {
  return !isSoloContext(hubContext) && m.league_id === hubContext?.league_id;
}
