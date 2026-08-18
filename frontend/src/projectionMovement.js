/** SCORE-7 — projection movement ("What Changed?") helpers. */

export const MOVEMENT_FILTERS = [
  { id: "all", label: "All" },
  { id: "movers", label: "Biggest movers" },
  { id: "risers", label: "Risers" },
  { id: "fallers", label: "Fallers" },
];

export const MOVEMENT_FILTER_IDS = new Set(MOVEMENT_FILTERS.map((f) => f.id));

/** Parse URL `movers` query into a filter id. */
export function parseMoversParam(raw) {
  if (raw == null || raw === "") return "all";
  const v = String(raw).trim().toLowerCase();
  if (v === "1" || v === "true" || v === "material" || v === "movers") return "movers";
  if (v === "risers" || v === "riser" || v === "up") return "risers";
  if (v === "fallers" || v === "faller" || v === "down") return "fallers";
  if (v === "all" || v === "0" || v === "false") return "all";
  return MOVEMENT_FILTER_IDS.has(v) ? v : "all";
}

/** Serialize filter id for the URL (`movers`); omit when all. */
export function moversParamValue(filterId) {
  if (!filterId || filterId === "all") return null;
  if (filterId === "movers") return "1";
  return filterId;
}

export function formatSignedNum(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const body = Math.abs(n).toFixed(digits);
  if (n > 0) return `+${body}`;
  if (n < 0) return `−${body}`;
  return body;
}

export function positionAbbrev(position) {
  const p = String(position || "").trim().toUpperCase();
  if (p === "WR" || p === "TE" || p === "WR/TE") return "WR";
  if (p === "QB" || p === "RB") return p;
  return p || "";
}

const ZERO_P50_EPS = 0.005;

function isNonZeroP50Delta(value) {
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) >= ZERO_P50_EPS;
}

function isNonZeroRankDelta(value) {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0;
}

/**
 * Rank change label: "RB18 → RB11 ▲7".
 * Positive rank_delta = rose (lower rank number).
 * Hide unchanged ranks (e.g. "QB1 → QB1") so the table is not filled with no-ops.
 */
export function formatRankMove({
  previousRank,
  currentRank,
  rankDelta,
  position,
} = {}) {
  const prev = Number(previousRank);
  const curr = Number(currentRank);
  const delta = Number(rankDelta);
  const pos = positionAbbrev(position);
  if (!Number.isFinite(prev) || !Number.isFinite(curr)) return null;
  if (prev === curr && !isNonZeroRankDelta(delta)) return null;
  const left = pos ? `${pos}${prev}` : String(prev);
  const right = pos ? `${pos}${curr}` : String(curr);
  if (!isNonZeroRankDelta(delta)) {
    return `${left} → ${right}`;
  }
  const arrow = delta > 0 ? "▲" : "▼";
  return `${left} → ${right} ${arrow}${Math.abs(delta)}`;
}

export function formatP50Move(p50Delta, digits = 1) {
  if (!isNonZeroP50Delta(p50Delta)) return null;
  return formatSignedNum(p50Delta, digits);
}

export function movementTone(delta) {
  const n = Number(delta);
  if (!Number.isFinite(n) || n === 0) return "neutral";
  return n > 0 ? "up" : "down";
}

/** Prefer rank delta for tone; fall back to P50. */
export function rowMovementTone(row) {
  const rank = Number(row?.rank_delta);
  if (Number.isFinite(rank) && rank !== 0) return movementTone(rank);
  return movementTone(row?.p50_delta);
}

export function hasMovement(row) {
  return isNonZeroP50Delta(row?.p50_delta) || isNonZeroRankDelta(row?.rank_delta);
}

export function isMaterialMover(row) {
  if (row?.movement_material === true || row?.material === true) return true;
  const p50 = Math.abs(Number(row?.p50_delta));
  const rank = Math.abs(Number(row?.rank_delta));
  return (Number.isFinite(p50) && p50 >= 1.5) || (Number.isFinite(rank) && rank >= 3);
}

export function isRiser(row) {
  if (!isMaterialMover(row)) return false;
  const rank = Number(row?.rank_delta);
  const p50 = Number(row?.p50_delta);
  if (Number.isFinite(rank) && rank > 0) return true;
  if (Number.isFinite(rank) && rank < 0) return false;
  return Number.isFinite(p50) && p50 > 0;
}

export function isFaller(row) {
  if (!isMaterialMover(row)) return false;
  const rank = Number(row?.rank_delta);
  const p50 = Number(row?.p50_delta);
  if (Number.isFinite(rank) && rank < 0) return true;
  if (Number.isFinite(rank) && rank > 0) return false;
  return Number.isFinite(p50) && p50 < 0;
}

export function matchesMovementFilter(row, filterId) {
  if (!filterId || filterId === "all") return true;
  if (filterId === "movers") return isMaterialMover(row);
  if (filterId === "risers") return isRiser(row);
  if (filterId === "fallers") return isFaller(row);
  return true;
}

/** Biggest-mover sort key: material first, then |rank|, then |p50|. */
export function movementSortScore(row) {
  const material = isMaterialMover(row) ? 1 : 0;
  const absRank = Math.abs(Number(row?.rank_delta)) || 0;
  const absP50 = Math.abs(Number(row?.p50_delta)) || 0;
  return material * 1e9 + absRank * 1e4 + absP50;
}

export function formatMovementSummary(change, { position } = {}) {
  const name = change?.player_name || change?.Player || "Player";
  const pos = positionAbbrev(change?.position || position);
  const rankLabel = formatRankMove({
    previousRank: change?.previous_rank,
    currentRank: change?.current_rank,
    rankDelta: change?.rank_delta,
    position: pos,
  });
  const p50Label = formatP50Move(change?.p50_delta ?? change?.delta_p50);
  const parts = [name];
  if (rankLabel) parts.push(rankLabel);
  if (p50Label) parts.push(`Proj ${p50Label}`);
  return parts.join(" · ");
}
