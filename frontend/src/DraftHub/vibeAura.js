/** Personal aura + start-slate math for Fantasy → Vibes. */

import { FLEX_ELIGIBLE, buildStarterSlotPlan, fillStarterSlots } from "./weekBoard.js";

export const AURA_BASE = 50;
export const AURA_MIN = 0;
export const AURA_MAX = 99;

export const VIBE_DELTA = Object.freeze({
  start: 14,
  sit: -14,
});

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function posOf(player) {
  return String(player?.position || "").toUpperCase();
}

export function playerKey(player) {
  return String(player?.player_id || "");
}

export function readAura(auraById, playerId) {
  const n = Number(auraById?.[String(playerId)]);
  return Number.isFinite(n) ? clamp(n, AURA_MIN, AURA_MAX) : AURA_BASE;
}

export function applyVibe(auraById, playerId, vibe) {
  const id = String(playerId || "");
  if (!id || !VIBE_DELTA[vibe]) return { ...(auraById || {}) };
  const next = clamp(readAura(auraById, id) + VIBE_DELTA[vibe], AURA_MIN, AURA_MAX);
  return { ...(auraById || {}), [id]: next };
}

export function auraTone(aura) {
  const n = Number(aura);
  if (n >= 70) return "hot";
  if (n <= 35) return "cold";
  return "even";
}

/** Aura scales the week projection. 50 = 1.0×, 0 = 0.6×, 99 ≈ 1.39×. */
export function vibeScore(player, aura) {
  const p50 = Number(player?.p50);
  const proj = Number.isFinite(p50) ? Math.max(0, p50) : 0;
  const a = Number.isFinite(Number(aura)) ? Number(aura) : AURA_BASE;
  return proj * (0.6 + 0.4 * (a / AURA_BASE));
}

export function eligibleToStart(player) {
  if (!player?.player_id) return false;
  if (player.on_bye || player.injured) return false;
  return true;
}

export function fillSlotsByScore(plan, players, scoreOf) {
  const remaining = [...(players || [])].sort((a, b) => {
    const delta = scoreOf(b) - scoreOf(a);
    if (delta !== 0) return delta;
    return playerKey(a).localeCompare(playerKey(b));
  });
  const used = new Set();

  const take = (pred) => {
    const hit = remaining.find((player) => (
      Boolean(player?.player_id)
      && !used.has(player.player_id)
      && eligibleToStart(player)
      && pred(player)
    ));
    if (!hit) return null;
    used.add(hit.player_id);
    return hit;
  };

  return (plan || []).map((slot) => {
    const player = take((row) => {
      if (slot.position === "FLEX") return FLEX_ELIGIBLE.includes(posOf(row));
      return posOf(row) === slot.position;
    });
    return { ...slot, player };
  });
}

export function projectionStarts(players, rules) {
  const plan = buildStarterSlotPlan(rules);
  const ranked = [...(players || [])]
    .filter(eligibleToStart)
    .sort((a, b) => (Number(b.p50) || 0) - (Number(a.p50) || 0));
  return fillStarterSlots(plan, ranked);
}

export function vibeStarts(players, auraById, rules) {
  const plan = buildStarterSlotPlan(rules);
  return fillSlotsByScore(plan, players, (player) => (
    vibeScore(player, readAura(auraById, player.player_id))
  ));
}

export function startIds(slots) {
  return new Set(
    (slots || [])
      .map((slot) => slot?.player?.player_id)
      .filter(Boolean)
      .map(String),
  );
}

export function vibeDivergences(projSlots, vibeSlots) {
  const proj = startIds(projSlots);
  const vibe = startIds(vibeSlots);
  const inVibe = (vibeSlots || [])
    .map((slot) => slot.player)
    .filter((player) => player && !proj.has(String(player.player_id)));
  const inProj = (projSlots || [])
    .map((slot) => slot.player)
    .filter((player) => player && !vibe.has(String(player.player_id)));
  const pairs = [];
  const n = Math.min(inVibe.length, inProj.length);
  for (let i = 0; i < n; i += 1) {
    pairs.push({ start: inVibe[i], sit: inProj[i] });
  }
  return { inVibe, inProj, pairs };
}

export function auraLeaders(players, auraById, limit = 3) {
  return [...(players || [])]
    .map((player) => ({ player, aura: readAura(auraById, player.player_id) }))
    .sort((a, b) => b.aura - a.aura || (Number(b.player.p50) || 0) - (Number(a.player.p50) || 0))
    .slice(0, limit);
}

export function ratedCount(players, auraById) {
  return (players || []).filter((player) => {
    const id = playerKey(player);
    return id && auraById && Object.prototype.hasOwnProperty.call(auraById, id);
  }).length;
}

export function formatAura(aura) {
  const n = Number(aura);
  return String(Math.round(Number.isFinite(n) ? clamp(n, AURA_MIN, AURA_MAX) : AURA_BASE));
}

export function formatPts(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(1);
}

export function formatPtsDelta(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n).toFixed(1);
  if (n > 0) return `+${abs}`;
  if (n < 0) return `−${abs}`;
  return abs;
}

export function storageKey({ leagueId, season, week } = {}) {
  const league = String(leagueId || "solo");
  const yr = season == null ? "na" : String(season);
  const wk = week == null ? "na" : String(week);
  return `ss_vibe_aura_${league}_${yr}_${wk}`;
}

export function loadAura(key) {
  if (typeof window === "undefined" || !key) return {};
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveAura(key, auraById) {
  if (typeof window === "undefined" || !key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(auraById || {}));
  } catch {
    /* ignore quota */
  }
}

export function calendarDay(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function dayStorageKey(opts) {
  return storageKey(opts).replace("ss_vibe_aura_", "ss_vibe_day_");
}

export function emptyDayVotes(now = new Date()) {
  return { date: calendarDay(now), votes: {} };
}

export function normalizeDayVotes(raw, now = new Date()) {
  const today = calendarDay(now);
  if (!raw || typeof raw !== "object" || raw.date !== today) {
    return emptyDayVotes(now);
  }
  const votes = raw.votes && typeof raw.votes === "object" ? raw.votes : {};
  return { date: today, votes: { ...votes } };
}

export function loadDayVotes(key, now = new Date()) {
  if (typeof window === "undefined" || !key) return emptyDayVotes(now);
  try {
    const raw = window.localStorage.getItem(key);
    return normalizeDayVotes(raw ? JSON.parse(raw) : null, now);
  } catch {
    return emptyDayVotes(now);
  }
}

export function saveDayVotes(key, state) {
  if (typeof window === "undefined" || !key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(state || emptyDayVotes()));
  } catch {
    /* ignore quota */
  }
}

export function recordDayVote(state, playerId, vibe, now = new Date()) {
  const date = calendarDay(now);
  const prior = state?.date === date ? state.votes : {};
  const id = String(playerId || "");
  if (!id || !VIBE_DELTA[vibe]) return { date, votes: { ...prior } };
  return { date, votes: { ...prior, [id]: vibe } };
}

export function clearDayVote(state, playerId, now = new Date()) {
  const date = calendarDay(now);
  const votes = { ...((state?.date === date && state.votes) || {}) };
  delete votes[String(playerId || "")];
  return { date, votes };
}

export function playersLeftToday(players, votes) {
  const rated = votes && typeof votes === "object" ? votes : {};
  return (players || []).filter((player) => {
    const id = playerKey(player);
    return Boolean(id) && !Object.prototype.hasOwnProperty.call(rated, id);
  });
}

export function todayRatedCount(players, votes) {
  return (players || []).length - playersLeftToday(players, votes).length;
}
