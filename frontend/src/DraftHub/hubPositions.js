/** Shared fantasy position ordering for Draft Hub UI. */
export const HUB_POS_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];

export const HUB_POSITION_FILTERS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"];

export function normalizeHubPosition(pos) {
  const p = String(pos || "").toUpperCase().trim();
  if (p === "DST" || p === "D/ST" || p === "D") return "DEF";
  if (p === "REC") return "WR";
  return p;
}

export function filterRowsByHubPosition(rows, posFilter) {
  if (!posFilter || posFilter === "ALL") return [...(rows || [])];
  const want = normalizeHubPosition(posFilter);
  return (rows || []).filter((r) => normalizeHubPosition(r.position) === want);
}
