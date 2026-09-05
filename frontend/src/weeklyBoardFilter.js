/**
 * Shared weekly-board list filtering so the page, sticky bar, and filter sheet
 * read one result count from one function.
 */

import {
  matchesMovementFilter,
  mergeRowsForMovementFilter,
} from "./projectionMovement.js";

export const WEEKLY_WINDOW_ROW_PX = 108;
export const WEEKLY_WINDOW_OVERSCAN = 8;
export const WEEKLY_WINDOW_INITIAL = 16;

export function filterWeeklyBoardRows(
  rows,
  {
    search = "",
    teamsFilter = [],
    movementFilter = "all",
    showFilters = false,
    leftSlateRows = null,
    attentionPlayerIds = null,
  } = {},
) {
  let list = rows || [];
  const q = String(search || "").trim().toLowerCase();
  if (q) {
    list = list.filter((row) => rowMatchesQuery(row, q));
  }
  if (teamsFilter?.length) {
    const set = new Set(teamsFilter.map((team) => String(team).toUpperCase()));
    list = list.filter((row) => set.has(String(row.Team || "").toUpperCase()));
  }
  if (showFilters && movementFilter && movementFilter !== "all") {
    list = list.filter((row) => (
      matchesMovementFilter(row, movementFilter, { attentionIds: attentionPlayerIds })
    ));
    list = mergeRowsForMovementFilter(list, leftSlateRows, movementFilter);
    if (q) {
      list = list.filter((row) => rowMatchesQuery(row, q));
    }
    if (teamsFilter?.length) {
      const set = new Set(teamsFilter.map((team) => String(team).toUpperCase()));
      list = list.filter((row) => set.has(String(row.Team || "").toUpperCase()));
    }
  }
  return list;
}

function rowMatchesQuery(row, q) {
  return (
    String(row.Player || "").toLowerCase().includes(q)
    || String(row.Team || "").toLowerCase().includes(q)
  );
}

export function weeklyResultLabel(count, selectedCount = 0) {
  const n = Number(count) || 0;
  if (selectedCount > 0) {
    return `${n} result${n === 1 ? "" : "s"} · ${selectedCount} selected`;
  }
  return `${n} player${n === 1 ? "" : "s"}`;
}

export function weeklyActiveFilterChips({
  search = "",
  teams = [],
  movementFilter = "all",
  movementFilters = [],
} = {}) {
  const chips = [];
  const q = String(search || "").trim();
  if (q) chips.push({ id: "search", label: q, kind: "search" });
  for (const team of teams || []) {
    chips.push({ id: `team:${team}`, label: String(team), kind: "team" });
  }
  if (movementFilter && movementFilter !== "all") {
    const hit = (movementFilters || []).find((item) => item.id === movementFilter);
    chips.push({
      id: "movement",
      label: hit?.label || movementFilter,
      kind: "movement",
    });
  }
  return chips;
}

/**
 * Visible slice for a windowed ranking list. Uses a reserved row height so
 * collapsed cards stay even; overscan covers expand / scroll jitter.
 */
export function weeklyWindowRange({
  count,
  scrollTop = 0,
  viewportHeight = 720,
  rowHeight = WEEKLY_WINDOW_ROW_PX,
  overscan = WEEKLY_WINDOW_OVERSCAN,
} = {}) {
  const n = Math.max(0, Number(count) || 0);
  if (n === 0) return { start: 0, end: 0 };
  const height = Math.max(1, Number(rowHeight) || WEEKLY_WINDOW_ROW_PX);
  const view = Math.max(1, Number(viewportHeight) || 720);
  const extra = Math.max(0, Number(overscan) || 0);
  const first = Math.max(0, Math.floor(Math.max(0, scrollTop) / height) - extra);
  const visible = Math.ceil(view / height) + extra * 2;
  const start = Math.min(first, n);
  const end = Math.min(n, start + visible);
  return { start, end };
}
