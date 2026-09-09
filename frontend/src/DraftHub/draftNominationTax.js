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

function holePositions(rules, roster, { draftCompleted = false } = {}) {
  return unmetMinPositions(buildRosterCapacity(rules, roster, { draftCompleted }));
}

export function nominationTaxForPlayer({
  row,
  teams = [],
  rosters = {},
  viewerTeamId,
  rules,
  minBid = 1,
  draftCompleted = false,
} = {}) {
  const pos = normalizeHubPosition(row?.position);
  if (!pos) return null;
  const bid = suggestedNominationBid(row);
  let best = null;
  for (const team of teams || []) {
    const id = String(team?.id || "");
    if (!id || id === String(viewerTeamId || "")) continue;
    const leftover = teamLeftover(team);
    if (leftover < Number(minBid || 1)) continue;
    const holes = holePositions(rules, rosters?.[id] || [], { draftCompleted });
    if (!holes.includes(pos)) continue;
    const candidate = {
      rival_team_id: id,
      rival_owner_name: hubTeamLabel(team),
      rival_budget_remaining: leftover,
      rival_hole_position: pos,
      suggested_bid: bid,
    };
    if (
      !best
      || leftover > best.rival_budget_remaining
      || (leftover === best.rival_budget_remaining
        && Number(bid || 0) > Number(best.suggested_bid || 0))
    ) {
      best = candidate;
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
  for (const row of rows || []) {
    const id = String(row?.player_id || "");
    if (!id) continue;
    const tax = nominationTaxForPlayer({
      row,
      teams,
      rosters,
      viewerTeamId,
      rules,
      minBid,
      draftCompleted,
    });
    if (tax) map[id] = tax;
  }
  return map;
}

export function sortRowsByTax(rows, taxById) {
  return [...(rows || [])].sort((left, right) => {
    const a = taxById?.[String(left?.player_id || "")];
    const b = taxById?.[String(right?.player_id || "")];
    const aLeft = a ? Number(a.rival_budget_remaining) : -1;
    const bLeft = b ? Number(b.rival_budget_remaining) : -1;
    if (bLeft !== aLeft) return bLeft - aLeft;
    const aBid = Number(a?.suggested_bid);
    const bBid = Number(b?.suggested_bid);
    const aOk = Number.isFinite(aBid);
    const bOk = Number.isFinite(bBid);
    if (aOk && bOk && bBid !== aBid) return bBid - aBid;
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
