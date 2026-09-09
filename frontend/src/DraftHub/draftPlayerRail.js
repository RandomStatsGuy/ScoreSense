import { normalizeHubPosition } from "./hubPositions.js";
import { pinNeedPositions } from "./draftRoomHelpers.js";
import { playerFitsNeed, sortRowsByTax } from "./draftNominationTax.js";

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
  mode = "need",
  taxById = {},
  leftover = null,
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
  if (mode === "tax") {
    list = sortRowsByTax(list, taxById);
    return maxRows ? list.slice(0, maxRows) : list;
  }
  if ((needsOnly || mode === "need") && needs.length) {
    list = list.filter((row) => playerFitsNeed({
      row,
      needPositions: needs,
      leftover,
    }));
  }
  return pinNeedPositions(list, needsOnly || mode === "need" ? [] : needs, maxRows);
}

export function draftPlayerRailValue(row, pickDraft) {
  if (pickDraft) {
    return row?.season_p50 ?? row?.season_proj ?? null;
  }
  return row?.risk_adjusted_value ?? row?.fair_value ?? row?.model_bid_hint ?? null;
}
