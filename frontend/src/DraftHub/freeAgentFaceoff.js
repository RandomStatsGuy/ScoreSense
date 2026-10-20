/** Free agents Face-off: your starters beside the pool, and what each free agent does to your lineup.
 *
 * Per-game pace for roster players comes from the same pool rows the list reads, so both sides of
 * every comparison share one season outlook. Slots come from the saved weekly lineup when it is
 * known; otherwise the best eligible player by pace fills each slot. Missing forecasts stay null —
 * they are never treated as zero.
 */

import { buildStarterSlotPlan, slotAcceptsPosition } from "./weekBoard.js";

export const FACEOFF_GAMES = 17;
const SPECIALISTS = new Set(["K", "DEF"]);
const ACTIVE_STATUSES = new Set(["", "active"]);

const num = (value) => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const round1 = (n) => Math.round(n * 10) / 10;
const slotBase = (slot) => String(slot || "").toUpperCase().replace(/\d+$/, "");
const posOf = (value) => String(value || "").toUpperCase();

export function faceoffSurname(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const last = parts[parts.length - 1];
  return /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(last) && parts.length > 1 ? parts[parts.length - 2] : last;
}

export function isSpecialistSlot(slot) {
  return SPECIALISTS.has(slotBase(slot?.slot ?? slot));
}

/** Total roster cap from Rules: explicit max, else the sum of position maxes, else unknown. */
export function faceoffRosterLimit(rules) {
  const explicit = num(rules?.roster_size_max);
  if (explicit != null && explicit > 0) return explicit;
  const roster = rules?.roster;
  if (!roster || typeof roster !== "object") return null;
  let sum = 0;
  let found = false;
  for (const entry of Object.values(roster)) {
    const max = num(entry?.max);
    if (max != null) { sum += max; found = true; }
  }
  return found && sum > 0 ? sum : null;
}

function activeRoster(roster = []) {
  return (roster || []).filter((row) => row?.player_id && ACTIVE_STATUSES.has(String(row.roster_status || "").toLowerCase()));
}

const identityKey = (id) => String(id || "").replace(/^sleeper-/, "");

export function faceoffSlotAccepts(slot, position, rules) {
  return slot?.bench
    ? posOf(position) === slot.player.position
    : slotAcceptsPosition(slot?.slot, position, rules);
}

/** Starter slots with players, the bench, and open roster spots. */
export function buildFaceoffRoster({ roster = [], rows = [], rules = null, weekRoster = null } = {}) {
  const pace = new Map();
  const projectionIds = new Map();
  for (const row of rows || []) {
    const id = String(row?.player_id || "");
    for (const alias of [id, row.roster_player_id, row.sleeper_player_id]) {
      if (alias) {
        pace.set(identityKey(alias), num(row.per_game_proj));
        projectionIds.set(identityKey(alias), identityKey(id));
      }
    }
  }
  const players = activeRoster(roster).map((row) => {
    const id = String(row.player_id);
    return {
      player_id: id,
      name: row.player_name || row.player || id,
      position: posOf(row.position),
      team: row.team || row.nfl_team || "",
      pg: pace.get(identityKey(id)) ?? pace.get(identityKey(row.sleeper_player_id)) ?? num(row.per_game_proj),
    };
  });
  const plan = buildStarterSlotPlan(rules);
  const lineupId = (id) => projectionIds.get(identityKey(id)) || identityKey(id);
  const savedSlots = new Map();
  for (const entry of weekRoster?.starters || []) {
    const id = String(entry?.player_id || "");
    const slot = String(entry?.slot || "");
    if (id && slot && slotBase(slot) !== "BN") savedSlots.set(lineupId(id), slot);
  }
  const used = new Set();
  const starters = plan.map((slot) => {
    const hit = players.find((p) => !used.has(p.player_id) && savedSlots.get(lineupId(p.player_id)) === slot.slot) || null;
    if (hit) used.add(hit.player_id);
    return { key: slot.key, slot: slot.slot, position: slot.position, player: hit };
  });
  // Empty slots take the best remaining eligible player by pace; FLEX fills last so it does not steal a position's starter.
  const open = starters.filter((s) => !s.player).sort((a, b) => Number(a.position === "FLEX") - Number(b.position === "FLEX"));
  for (const slot of open) {
    const best = players
      .filter((p) => !used.has(p.player_id) && slotAcceptsPosition(slot.slot, p.position, rules))
      .sort((a, b) => (b.pg ?? -Infinity) - (a.pg ?? -Infinity))[0];
    if (best) { used.add(best.player_id); slot.player = best; }
  }
  const bench = players.filter((p) => !used.has(p.player_id)).sort((a, b) => (b.pg ?? -Infinity) - (a.pg ?? -Infinity));
  const limit = faceoffRosterLimit(rules);
  return {
    starters,
    bench,
    limit,
    openSpots: limit == null ? null : Math.max(0, limit - players.length),
    savedLineup: savedSlots.size > 0,
  };
}

export function eligibleFaceoffStarters(position, starters = [], rules) {
  return (starters || []).filter((slot) => slotAcceptsPosition(slot.slot, position, rules));
}

/** The starter a free agent at this position would push out: an empty slot first, then the lowest pace. */
export function weakestFaceoffStarter(position, starters = [], rules) {
  const eligible = eligibleFaceoffStarters(position, starters, rules);
  const empty = eligible.find((slot) => !slot.player);
  if (empty) return empty;
  const known = eligible.filter((slot) => slot.player?.pg != null).sort((a, b) => a.player.pg - b.player.pg);
  return known[0] || eligible[0] || null;
}

/** Per-game change if the free agent started instead of the slot he would take. */
export function faceoffCompare(row, { starters = [], target = null, rules = null } = {}) {
  const pg = num(row?.per_game_proj);
  const position = posOf(row?.position);
  const against = target && target !== "open" && faceoffSlotAccepts(target, position, rules)
    ? target
    : weakestFaceoffStarter(position, starters, rules);
  if (!against) return { against: null, delta: null };
  if (pg == null) return { against, delta: null };
  if (!against.player) return { against, delta: round1(pg) };
  if (against.player.pg == null) return { against, delta: null };
  return { against, delta: round1(pg - against.player.pg) };
}

/** Your softest starting spots: empty slots, then the lowest pace, one per position group, no K/DEF. */
export function faceoffWeakSpots(starters = [], { limit = 3 } = {}) {
  const seen = new Set();
  const out = [];
  const ordered = [...(starters || [])].filter((slot) => !isSpecialistSlot(slot)).sort((a, b) => {
    const ap = a.player ? (a.player.pg ?? Infinity) : -Infinity;
    const bp = b.player ? (b.player.pg ?? Infinity) : -Infinity;
    return ap - bp;
  });
  for (const slot of ordered) {
    if (seen.has(slot.position)) continue;
    seen.add(slot.position);
    out.push(slot);
    if (out.length >= limit) break;
  }
  return out;
}

/** Free agents in the pool who would start over this slot. */
export function faceoffBeats(slot, rows = [], { exclude = new Set(), rules = null } = {}) {
  if (!slot) return 0;
  let n = 0;
  for (const row of rows || []) {
    if (exclude.has(String(row?.player_id))) continue;
    const pg = num(row?.per_game_proj);
    if (pg == null || !faceoffSlotAccepts(slot, row.position, rules)) continue;
    if (!slot.player || (slot.player.pg != null && pg > slot.player.pg)) n += 1;
  }
  return n;
}

/** Projected lineup per game. Unknown when any filled starter lacks a forecast. */
export function faceoffLineupTotal(starters = []) {
  let total = 0;
  let missing = 0;
  let filled = 0;
  for (const slot of starters || []) {
    if (!slot.player) continue;
    filled += 1;
    if (slot.player.pg == null) missing += 1;
    else total += slot.player.pg;
  }
  return { total: filled && !missing ? round1(total) : null, missing, filled };
}

/** Where pending moves land if they all clear: one swap per starter, taken in order. */
export function faceoffPending(starters = [], pendingRows = [], rules = null) {
  const clone = (starters || []).map((slot) => ({ ...slot, player: slot.player ? { ...slot.player } : null }));
  const swaps = new Map();
  for (const row of pendingRows || []) {
    const pg = num(row?.per_game_proj);
    if (pg == null) continue;
    const out = weakestFaceoffStarter(posOf(row.position), clone, rules);
    if (!out) continue;
    const gain = !out.player ? pg : out.player.pg == null ? null : pg - out.player.pg;
    if (gain == null || gain <= 0) continue;
    const from = (starters || []).find((slot) => slot.key === out.key) || null;
    swaps.set(out.key, { row, slot: out.slot, from: from?.player || null });
    out.player = { player_id: String(row.player_id), name: row.player || row.player_name || "", position: posOf(row.position), team: row.team || "", pg };
  }
  const before = faceoffLineupTotal(starters);
  const after = faceoffLineupTotal(clone);
  const delta = before.total != null && after.total != null ? round1(after.total - before.total) : null;
  return { swaps, before: before.total, after: after.total, delta, missing: before.missing };
}

/** The free agent who gains the most against the spot he would take. */
export function faceoffBestUpgrade(rows = [], { starters = [], target = null, rules = null, exclude = new Set() } = {}) {
  let best = null;
  for (const row of rows || []) {
    if (exclude.has(String(row?.player_id))) continue;
    if (target && target !== "open" && !faceoffSlotAccepts(target, row.position, rules)) continue;
    const { against, delta } = faceoffCompare(row, { starters, target, rules });
    if (against && delta != null && delta > 0 && (!best || delta > best.delta)) best = { row, against, delta };
  }
  return best;
}

/** Everything the Free agents page needs to read the pool against your lineup. */
export function buildFaceoffModel({
  roster = [], rows = [], availableRows = null, rules = null, weekRoster = null, pendingRows = [], target = null,
} = {}) {
  const lineup = buildFaceoffRoster({ roster, rows, rules, weekRoster });
  const pool = availableRows || rows || [];
  const pendingIds = new Set((pendingRows || []).map((row) => String(row?.player_id)));
  const benchSlots = lineup.bench.map((player) => ({ key: `bench:${player.player_id}`, slot: "BN", position: player.position, player, bench: true }));
  const selectableSlots = [...lineup.starters, ...benchSlots];
  const targetSlot = target && target !== "open" ? selectableSlots.find((slot) => slot.key === target) || null : null;
  const targetOpen = target === "open" && (lineup.openSpots ?? 0) > 0;
  const compare = (row) => faceoffCompare(row, { starters: lineup.starters, target: targetSlot, rules });
  const eligible = (row) => !targetSlot || faceoffSlotAccepts(targetSlot, row?.position, rules);
  const weak = faceoffWeakSpots(lineup.starters);
  const weakKeys = new Set(weak.map((slot) => slot.key));
  const beats = new Map();
  for (const slot of selectableSlots) {
    if (!isSpecialistSlot(slot)) beats.set(slot.key, faceoffBeats(slot, pool, { exclude: pendingIds, rules }));
  }
  const pending = faceoffPending(lineup.starters, pendingRows, rules);
  const total = faceoffLineupTotal(lineup.starters);
  const best = faceoffBestUpgrade(pool, { starters: lineup.starters, target: targetSlot, rules, exclude: pendingIds });
  return {
    lineup, benchSlots, targetSlot, targetOpen, target: targetSlot ? targetSlot.key : targetOpen ? "open" : null,
    compare, eligible, weakKeys, beats, pending, total, best, pendingIds,
    hasStarters: lineup.starters.some((slot) => slot.player),
  };
}

/** Range-bar marks: where the starter's season pace lands, and where the free agent's range starts beating him. */
export function faceoffRangeMarks(band, against, scale) {
  if (!against?.player || against.player.pg == null || !scale) return null;
  const season = against.player.pg * FACEOFF_GAMES;
  const tick = Math.max(0, Math.min(99, (season / scale) * 100));
  if (band?.p10 == null || band?.p90 == null) return { tick, beat: null };
  const low = Math.max(0, Math.min(100, (band.p10 / scale) * 100));
  const high = Math.max(0, Math.min(100, (band.p90 / scale) * 100));
  const beat = Math.max(low, tick);
  return { tick, beat: beat < high ? beat : null, high, season: Math.round(season) };
}
