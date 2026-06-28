/** Shared fantasy position ordering for Draft Hub UI. */
export const HUB_POS_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];

export const HUB_POSITION_FILTERS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"];

export function normalizeHubPosition(pos) {
  const p = String(pos || "").toUpperCase().trim();
  if (p === "DST" || p === "D/ST") return "DEF";
  if (p === "REC") return "WR";
  return p;
}

export function sortByHubPosition(a, b) {
  const ai = HUB_POS_ORDER.indexOf(normalizeHubPosition(a));
  const bi = HUB_POS_ORDER.indexOf(normalizeHubPosition(b));
  return (ai >= 0 ? ai : HUB_POS_ORDER.length) - (bi >= 0 ? bi : HUB_POS_ORDER.length);
}
