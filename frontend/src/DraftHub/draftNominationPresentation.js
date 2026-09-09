/** Copy for live-draft Need vs Tax nomination chips. */

import { fmtSal } from "./rosterFormat.js";

export const NOMINATION_COPY = Object.freeze({
  modeGroup: "Who to put up",
  need: "Need",
  tax: "Tax",
  needFilled: "Needs filled",
  taxEmpty: "No rival holes",
  loading: "Loading players…",
  emptyFilter: "No players match these filters.",
  emptyNeed: "Needs filled. Switch to Tax.",
  emptyNeedBroke: "Nothing in this hole still fits leftover. Switch to Tax.",
  emptyTaxNone: "No rival leftover at a hole. Switch to Need.",
  emptyTaxSlice: "No tax targets in this slice.",
  taxLine: ({ owner, leftover, pos } = {}) => {
    const name = String(owner || "A rival").trim() || "A rival";
    const hole = String(pos || "").toUpperCase() || "a slot";
    return `${name} has ${fmtSal(leftover)} at ${hole}`;
  },
});

export function nominationModeLabel(mode) {
  return mode === "tax" ? NOMINATION_COPY.tax : NOMINATION_COPY.need;
}

function hasActiveSlice({ search = "", position = "ALL" } = {}) {
  return Boolean(String(search || "").trim()) || (position && position !== "ALL");
}

export function nominationRailEmpty({
  loading = false,
  rowCount = 0,
  mode = "need",
  leftover = null,
  hasTaxTargets = false,
  needPositions = [],
  search = "",
  position = "ALL",
  hasNeedWithoutLeftover = false,
  minBid = 1,
} = {}) {
  if (loading && rowCount === 0) return NOMINATION_COPY.loading;
  if (rowCount > 0) return "";
  if (mode === "tax" && !hasTaxTargets) return NOMINATION_COPY.emptyTaxNone;
  if (mode === "tax") return NOMINATION_COPY.emptyTaxSlice;
  if (hasActiveSlice({ search, position })) return NOMINATION_COPY.emptyFilter;
  if (mode === "need" && needPositions.length) {
    const purse = leftover == null ? null : Number(leftover);
    const floor = Number(minBid ?? 1);
    const broke = Number.isFinite(purse) && (
      (Number.isFinite(floor) && purse < floor) || hasNeedWithoutLeftover
    );
    if (broke) return NOMINATION_COPY.emptyNeedBroke;
    return NOMINATION_COPY.emptyNeed;
  }
  return NOMINATION_COPY.emptyFilter;
}
