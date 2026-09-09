/** Private Need vs Tax sort for the live nomination rail. */

import { hubTeamLabel } from "./hubTeamLabel.js";
import { normalizeHubPosition } from "./hubPositions.js";
import { buildRosterCapacity, unmetMinPositions } from "./draftRoomHelpers.js";

export function suggestedNominationBid(row) {
  const n = Number(row?.risk_adjusted_value ?? row?.fair_value ?? row?.model_bid_hint);
  return Number.isFinite(n) ? n : null;
}

export function teamLeftover(team) {
  const n = Number(team?.budget_remaining);
  return Number.isFinite(n) ? n : 0;
}

export function auctionFloor(minBid) {
  const n = Number(minBid ?? 1);
  return Number.isFinite(n) ? n : 1;
}

function holePositions(rules, roster, { draftCompleted = false } = {}) {
  return unmetMinPositions(buildRosterCapacity(rules, roster, { draftCompleted }));
}

export function buildTeamHolesMap({
  teams = [],
  rosters = {},
  viewerTeamId,
  rules,
  minBid = 1,
  draftCompleted = false,
} = {}) {
  const map = {};
  const floor = auctionFloor(minBid);
  for (const team of teams || []) {
    const id = String(team?.id || "");
    if (!id || id === String(viewerTeamId || "")) continue;
    if (teamLeftover(team) < floor) continue;
    map[id] = holePositions(rules, rosters?.[id] || [], { draftCompleted });
  }
  return map;
}

export function nominationTaxForPlayer({
  row,
  teams = [],
  viewerTeamId,
  minBid = 1,
  teamHolesMap = {},
} = {}) {
  const pos = normalizeHubPosition(row?.position);
  if (!pos) return null;
  const bid = suggestedNominationBid(row);
  const floor = auctionFloor(minBid);
  let best = null;
  for (const team of teams || []) {
    const id = String(team?.id || "");
    if (!id || id === String(viewerTeamId || "")) continue;
    const leftover = teamLeftover(team);
    if (leftover < floor) continue;
    const holes = teamHolesMap[id] || [];
    if (!holes.includes(pos)) continue;
    if (!best || leftover > best.rival_budget_remaining) {
      best = {
        rival_team_id: id,
        rival_owner_name: hubTeamLabel(team),
        rival_budget_remaining: leftover,
        rival_hole_position: pos,
        suggested_bid: bid,
      };
    }
  }
  return best;
}

export function buildNominationTaxMap({
  rows = [],
  teams = [],
  rosters = {},
  viewerTeamId,
  rules,
  minBid = 1,
  draftCompleted = false,
} = {}) {
  const map = {};
  const teamHolesMap = buildTeamHolesMap({
    teams,
    rosters,
    viewerTeamId,
    rules,
    minBid,
    draftCompleted,
  });
  for (const row of rows || []) {
    const id = String(row?.player_id || "");
    if (!id) continue;
    const tax = nominationTaxForPlayer({
      row,
      teams,
      viewerTeamId,
      minBid,
      teamHolesMap,
    });
    if (tax) map[id] = tax;
  }
  return map;
}

function taxBidIsSet(value) {
  return value != null && Number.isFinite(Number(value));
}

export function sortRowsByTax(rows, taxById) {
  return [...(rows || [])].sort((left, right) => {
    const a = taxById?.[String(left?.player_id || "")];
    const b = taxById?.[String(right?.player_id || "")];
    const aLeft = a ? Number(a.rival_budget_remaining) : -1;
    const bLeft = b ? Number(b.rival_budget_remaining) : -1;
    if (bLeft !== aLeft) return bLeft - aLeft;
    const aBid = a?.suggested_bid;
    const bBid = b?.suggested_bid;
    const aOk = taxBidIsSet(aBid);
    const bOk = taxBidIsSet(bBid);
    if (aOk && bOk && Number(bBid) !== Number(aBid)) return Number(bBid) - Number(aBid);
    if (aOk !== bOk) return aOk ? -1 : 1;
    return String(left?.player || left?.player_name || "")
      .localeCompare(String(right?.player || right?.player_name || ""), undefined, { sensitivity: "base" });
  });
}

export function playerFitsNeed({
  row,
  needPositions = [],
  leftover,
} = {}) {
  const pos = normalizeHubPosition(row?.position);
  if (!needPositions.includes(pos)) return false;
  const bid = suggestedNominationBid(row);
  if (leftover == null || !Number.isFinite(Number(leftover))) return true;
  if (bid == null) return true;
  return bid <= Number(leftover);
}

export function needExistsInSlice(rows, {
  needPositions = [],
  position = "ALL",
  search = "",
} = {}) {
  const needs = [...new Set((needPositions || []).map(normalizeHubPosition).filter(Boolean))];
  if (!needs.length) return false;
  const query = String(search || "").trim().toLowerCase();
  return (rows || []).some((row) => {
    if (position !== "ALL" && normalizeHubPosition(row.position) !== position) return false;
    if (query) {
      const name = String(row.player || row.player_name || "").toLowerCase();
      const team = String(row.team || "").toLowerCase();
      if (!name.includes(query) && !team.includes(query)) return false;
    }
    return playerFitsNeed({ row, needPositions: needs, leftover: null });
  });
}
