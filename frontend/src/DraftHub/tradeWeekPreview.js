/** Project This Week starter P50 before and after a trade package. */

import { buildStarterSlotPlan, fillStarterSlots } from "./weekBoard.js";

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function asPlayerId(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return String(value.player_id || "");
}

export function indexWeekCards(cards = {}) {
  const out = {};
  if (!cards || typeof cards !== "object" || Array.isArray(cards)) return out;
  for (const [key, card] of Object.entries(cards)) {
    if (!card) continue;
    const id = String(card.player_id || key || "").trim();
    if (!id) continue;
    out[id] = card;
    const bare = id.startsWith("sleeper-") ? id.slice("sleeper-".length) : "";
    if (bare && !out[bare]) out[bare] = card;
  }
  return out;
}

function cardFor(playerId, cards) {
  const id = String(playerId || "");
  if (!id) return null;
  if (cards[id]) return cards[id];
  if (id.startsWith("sleeper-")) return cards[id.slice("sleeper-".length)] || null;
  return cards[`sleeper-${id}`] || null;
}

function p50Of(playerId, cards, fallback) {
  const card = cardFor(playerId, cards);
  const raw = card?.p50 ?? fallback?.p50;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function partyTradeBundle(parties = [], myTeamId) {
  const mine = (parties || []).find((party) => party.team_id === myTeamId) || {
    sends: [],
    drops: [],
  };
  const sendIds = new Set((mine.sends || []).map(asPlayerId).filter(Boolean));
  const dropIds = new Set((mine.drops || []).map(asPlayerId).filter(Boolean));
  const receiveIds = [];
  for (const party of parties || []) {
    if (party.team_id === myTeamId) continue;
    for (const send of party.sends || []) {
      if (send?.to_team_id === myTeamId) {
        const id = asPlayerId(send);
        if (id) receiveIds.push(id);
      }
    }
  }
  return { sendIds, dropIds, receiveIds };
}

function findRosterRow(rosterByTeam, playerId) {
  for (const rows of Object.values(rosterByTeam || {})) {
    const hit = (rows || []).find((row) => asPlayerId(row) === playerId);
    if (hit) return hit;
  }
  return null;
}

function toPoolPlayer(row, cards, { keepSlot = false } = {}) {
  const playerId = asPlayerId(row);
  const card = cardFor(playerId, cards);
  return {
    player_id: playerId,
    player_name: row?.player_name || card?.player_name || playerId,
    position: row?.position || card?.position || "",
    p50: p50Of(playerId, cards, row),
    slot: keepSlot ? row?.slot : undefined,
    lineup_role: keepSlot
      ? (row?.lineup_role || (row?.slot ? "starter" : undefined))
      : "starter",
  };
}

function poolFromRows(rows, cards, options) {
  return (rows || [])
    .filter((row) => asPlayerId(row) && String(row.roster_status || "active") !== "cut")
    .map((row) => toPoolPlayer(row, cards, options));
}

function sumFilled(filled) {
  return (filled || []).reduce((sum, slot) => sum + (Number(slot.player?.p50) || 0), 0);
}

function starterMeta(slot) {
  return {
    player_id: slot.player.player_id,
    player_name: slot.player.player_name,
    position: slot.player.position,
    slot: slot.slot,
  };
}

const UNAVAILABLE = Object.freeze({
  available: false,
  before_p50: null,
  after_p50: null,
  delta: null,
  bumped_starters: [],
  lost_starters: [],
});

/**
 * Private This Week lineup preview for the viewer's team.
 * Before uses This Week starter slots when present; after re-fills by P50.
 */
export function projectTradeWeekLineup({
  rosterByTeam,
  parties,
  myTeamId,
  weekCards,
  weekStarters,
  rules,
  projectionsAvailable = true,
  emptyRoster = false,
} = {}) {
  if (!projectionsAvailable || emptyRoster || !myTeamId) return { ...UNAVAILABLE };

  const cards = indexWeekCards(weekCards);
  const plan = buildStarterSlotPlan(rules);
  if (!plan.length) return { ...UNAVAILABLE };

  const myRows = rosterByTeam?.[myTeamId] || [];
  const { sendIds, dropIds, receiveIds } = partyTradeBundle(parties, myTeamId);

  const beforeSource = Array.isArray(weekStarters) && weekStarters.length
    ? poolFromRows(weekStarters, cards, { keepSlot: true })
    : poolFromRows(myRows, cards).sort((a, b) => b.p50 - a.p50);

  const beforeFilled = fillStarterSlots(plan, beforeSource);
  const beforeStarters = beforeFilled.filter((slot) => slot.player);
  const anyPts = beforeSource.some((row) => row.p50 > 0)
    || Object.values(cards).some((card) => Number(card?.p50) > 0);
  if (!beforeStarters.length && !anyPts) return { ...UNAVAILABLE };

  const keep = myRows.filter((row) => {
    const id = asPlayerId(row);
    return id && !sendIds.has(id) && !dropIds.has(id);
  });
  const incoming = receiveIds.map((id) => {
    const row = findRosterRow(rosterByTeam, id) || cardFor(id, cards) || { player_id: id };
    return { ...row, player_id: id };
  });
  const afterSource = poolFromRows([...keep, ...incoming], cards)
    .sort((a, b) => b.p50 - a.p50);

  const afterFilled = fillStarterSlots(plan, afterSource);
  const afterAny = afterSource.some((row) => row.p50 > 0) || beforeSource.some((row) => row.p50 > 0);
  if (!afterAny) return { ...UNAVAILABLE };

  const before_p50 = round1(sumFilled(beforeFilled));
  const after_p50 = round1(sumFilled(afterFilled));
  const receiveSet = new Set(receiveIds);
  const beforeIds = new Set(beforeStarters.map((slot) => slot.player.player_id));

  return {
    available: true,
    before_p50,
    after_p50,
    delta: round1(after_p50 - before_p50),
    lost_starters: beforeStarters
      .filter((slot) => (
        sendIds.has(slot.player.player_id) || dropIds.has(slot.player.player_id)
      ))
      .map(starterMeta),
    bumped_starters: afterFilled
      .filter((slot) => (
        slot.player
        && receiveSet.has(slot.player.player_id)
        && !beforeIds.has(slot.player.player_id)
      ))
      .map(starterMeta),
  };
}
