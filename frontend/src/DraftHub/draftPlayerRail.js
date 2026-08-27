import { normalizeHubPosition } from "./hubPositions.js";
import { pinNeedPositions } from "./draftRoomHelpers.js";

export const DRAFT_PLAYER_RAIL_POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"];

export function defaultDraftPlayerRailSort(pickDraft) {
  return pickDraft ? "season_proj" : "fair_value";
}

export function draftPlayerRailRows(rows, {
  pickDraft = false,
  position = "ALL",
  search = "",
  sortKey,
  needsOnly = false,
  needPositions = [],
  maxRows = 60,
} = {}) {
  const needs = [...new Set(
    (needPositions || []).map(normalizeHubPosition).filter(Boolean),
  )];
  const activeSort = sortKey || defaultDraftPlayerRailSort(pickDraft);
  const query = String(search || "").trim().toLowerCase();
  let list = [...(rows || [])].filter((row) => (
    (position === "ALL" || normalizeHubPosition(row.position) === position)
    && (!query
      || String(row.player || row.player_name || "").toLowerCase().includes(query)
      || String(row.team || "").toLowerCase().includes(query))
  ));
  list.sort((left, right) => {
    if (activeSort === "player") {
      return String(left.player || left.player_name || "").localeCompare(
        String(right.player || right.player_name || ""),
        undefined,
        { sensitivity: "base" },
      );
    }
    const value = (row) => {
      if (activeSort === "fair_value") {
        return row.risk_adjusted_value ?? row.fair_value ?? row.model_bid_hint ?? null;
      }
      if (activeSort === "season_p90") return row.season_p90 ?? null;
      return row.season_p50 ?? row.season_proj ?? null;
    };
    const a = Number(value(left));
    const b = Number(value(right));
    if (!Number.isFinite(a) && !Number.isFinite(b)) return 0;
    if (!Number.isFinite(a)) return 1;
    if (!Number.isFinite(b)) return -1;
    return b - a;
  });
  if (needsOnly && needs.length) {
    const needSet = new Set(needs);
    list = list.filter((row) => needSet.has(normalizeHubPosition(row.position)));
  }
  return pinNeedPositions(list, needsOnly ? [] : needs, maxRows);
}

export function draftPlayerRailValue(row, pickDraft) {
  if (pickDraft) {
    return row?.season_p50 ?? row?.season_proj ?? null;
  }
  return row?.risk_adjusted_value ?? row?.fair_value ?? row?.model_bid_hint ?? null;
}
