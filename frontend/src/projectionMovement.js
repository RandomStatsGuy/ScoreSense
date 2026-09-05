/** SCORE-7 / SCORE-48 — projection movement ("What Changed?") helpers. */

export const MOVEMENT_FILTERS = [
  { id: "all", label: "All" },
  { id: "movers", label: "Biggest movers" },
  { id: "risers", label: "Risers" },
  { id: "fallers", label: "Fallers" },
  { id: "attention", label: "Attention" },
];

export const MOVEMENT_FILTER_IDS = new Set(MOVEMENT_FILTERS.map((f) => f.id));

/** Empty-state codes from `/api/predict/...` movement meta (SCORE-48). */
export const EMPTY_NO_PRIOR = "no_prior_snapshot";
export const EMPTY_NO_MATERIAL = "no_material_moves";
export const EMPTY_ARTIFACT_MISSING = "artifact_missing";
export const EMPTY_NO_MATCHES = "no_matching_players";

export const SLATE_LEFT = "left";
export const SLATE_ENTERED = "entered";
export const SLATE_STAYED = "stayed";

/** Parse URL `movers` query into a filter id. */
export function parseMoversParam(raw) {
  if (raw == null || raw === "") return "all";
  const v = String(raw).trim().toLowerCase();
  if (v === "1" || v === "true" || v === "material" || v === "movers") return "movers";
  if (v === "risers" || v === "riser" || v === "up") return "risers";
  if (v === "fallers" || v === "faller" || v === "down") return "fallers";
  if (v === "attention" || v === "attn") return "attention";
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

export function slateStatus(row) {
  return String(row?.slate_status || "").trim().toLowerCase();
}

export function isLeftSlate(row) {
  return slateStatus(row) === SLATE_LEFT || row?._left_slate === true;
}

/**
 * User-facing copy for empty Biggest movers / Risers / Fallers tabs.
 * Prefer API `note` when present; otherwise map known empty_reason codes.
 */
export function movementEmptyMessage(emptyReason, note, { filterId } = {}) {
  const trimmedNote = typeof note === "string" ? note.trim() : "";
  if (trimmedNote) return trimmedNote;

  const code = String(emptyReason || "").trim();
  if (code === EMPTY_NO_PRIOR) {
    return "No prior projection snapshot yet — movement appears after the next refresh.";
  }
  if (code === EMPTY_ARTIFACT_MISSING) {
    return "Movement data is unavailable for this slate.";
  }
  if (code === EMPTY_NO_MATERIAL) {
    if (filterId === "risers") {
      return "No material risers vs the prior refresh.";
    }
    if (filterId === "fallers") {
      return "No material fallers vs the prior refresh.";
    }
    return "No material movers vs the prior refresh.";
  }
  if (code === EMPTY_NO_MATCHES) {
    return "No players match this movement filter.";
  }
  if (filterId && filterId !== "all") {
    return "No players match this movement filter.";
  }
  return null;
}

/**
 * Rank change label: "RB18 → RB11 ▲7".
 * Positive rank_delta = rose (lower rank number).
 * Hide unchanged ranks (e.g. "QB1 → QB1") so the table is not filled with no-ops.
 * SCORE-48: players who left the slate render as "QB12 → —".
 */
export function formatRankMove({
  previousRank,
  currentRank,
  rankDelta,
  position,
  slateStatus: status,
} = {}) {
  const prevMissing = previousRank == null || previousRank === "" || Number(previousRank) <= 0;
  const prev = Number(previousRank);
  const curr = Number(currentRank);
  const delta = Number(rankDelta);
  const pos = positionAbbrev(position);
  const left = String(status || "").trim().toLowerCase() === SLATE_LEFT;

  if (left) {
    if (prevMissing || !Number.isFinite(prev)) return null;
    const leftLabel = pos ? `${pos}${prev}` : String(prev);
    if (isNonZeroRankDelta(delta)) {
      return `${leftLabel} → — ▼${Math.abs(delta)}`;
    }
    return `${leftLabel} → —`;
  }

  if (!Number.isFinite(curr)) return null;
  if (prevMissing) {
    const right = pos ? `${pos}${curr}` : String(curr);
    return `New → ${right}`;
  }
  if (!Number.isFinite(prev)) return null;
  if (prev === curr && !isNonZeroRankDelta(delta)) return null;
  const leftLabel = pos ? `${pos}${prev}` : String(prev);
  const right = pos ? `${pos}${curr}` : String(curr);
  if (!isNonZeroRankDelta(delta)) {
    return `${leftLabel} → ${right}`;
  }
  const arrow = delta > 0 ? "▲" : "▼";
  return `${leftLabel} → ${right} ${arrow}${Math.abs(delta)}`;
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
  if (isLeftSlate(row)) return "down";
  const rank = Number(row?.rank_delta);
  if (Number.isFinite(rank) && rank !== 0) return movementTone(rank);
  return movementTone(row?.p50_delta);
}

export function hasMovement(row) {
  if (isLeftSlate(row)) return true;
  return isNonZeroP50Delta(row?.p50_delta) || isNonZeroRankDelta(row?.rank_delta);
}

export function isMaterialMover(row) {
  if (row?.movement_material === true || row?.material === true) return true;
  if (isLeftSlate(row)) return true;
  const p50 = Math.abs(Number(row?.p50_delta));
  const rank = Math.abs(Number(row?.rank_delta));
  return (Number.isFinite(p50) && p50 >= 1.5) || (Number.isFinite(rank) && rank >= 3);
}

export function isRiser(row) {
  if (isLeftSlate(row)) return false;
  if (!isMaterialMover(row)) return false;
  const rank = Number(row?.rank_delta);
  const p50 = Number(row?.p50_delta);
  if (Number.isFinite(rank) && rank > 0) return true;
  if (Number.isFinite(rank) && rank < 0) return false;
  return Number.isFinite(p50) && p50 > 0;
}

export function isFaller(row) {
  if (isLeftSlate(row)) return isMaterialMover(row);
  if (!isMaterialMover(row)) return false;
  const rank = Number(row?.rank_delta);
  const p50 = Number(row?.p50_delta);
  if (Number.isFinite(rank) && rank < 0) return true;
  if (Number.isFinite(rank) && rank > 0) return false;
  return Number.isFinite(p50) && p50 < 0;
}

export function matchesMovementFilter(row, filterId, { attentionIds } = {}) {
  if (!filterId || filterId === "all") return true;
  if (filterId === "movers") return isMaterialMover(row);
  if (filterId === "risers") return isRiser(row);
  if (filterId === "fallers") return isFaller(row);
  if (filterId === "attention") {
    const id = String(row?.player_id || row?.playerId || "");
    return Boolean(id && attentionIds?.has(id));
  }
  return true;
}

/** Biggest-mover sort key: material first, then left-slate, then |rank|, then |p50|. */
export function movementSortScore(row) {
  const material = isMaterialMover(row) ? 1 : 0;
  const left = isLeftSlate(row) ? 1 : 0;
  const absRank = Math.abs(Number(row?.rank_delta)) || 0;
  const absP50 = Math.abs(Number(row?.p50_delta)) || 0;
  return material * 1e9 + left * 1e8 + absRank * 1e4 + absP50;
}

/**
 * Normalize a `/api/predict/{pos}/changes` record into WeeklyTable row shape.
 * Left-slate rows are /changes-only (not soft-joined onto current projections).
 */
export function changeRecordToRow(change) {
  if (!change) return null;
  const status = slateStatus(change);
  const left = status === SLATE_LEFT;
  return {
    player_id: change.player_id,
    Player: change.player_name || change.Player || "",
    Position: change.position || change.Position || "",
    Team: change.team || change.Team || "",
    Opponent: change.opponent || change.Opponent || "",
    "Projected Points": left ? null : change.current_p50,
    "Low (P10)": left ? null : change.current_p10,
    "High (P90)": left ? null : change.current_p90,
    previous_rank: change.previous_rank,
    current_rank: change.current_rank,
    rank_delta: change.rank_delta,
    previous_p50: change.previous_p50,
    p50_delta: change.p50_delta,
    movement_material: Boolean(change.material ?? change.movement_material),
    material: Boolean(change.material ?? change.movement_material),
    slate_status: status || SLATE_STAYED,
    _left_slate: left,
  };
}

/** Left-slate rows from a changes payload for movers / fallers tabs. */
export function leftSlateRowsFromChanges(changes) {
  const list = Array.isArray(changes) ? changes : [];
  return list
    .filter((c) => slateStatus(c) === SLATE_LEFT)
    .map(changeRecordToRow)
    .filter(Boolean);
}

/**
 * Merge current-slate rows with left-slate extras for a movers filter.
 * Left players stay off the "All" tab (they are no longer on the slate).
 */
export function mergeRowsForMovementFilter(rows, leftSlateRows, filterId) {
  const base = Array.isArray(rows) ? rows : [];
  if (!filterId || filterId === "all") return base;
  const extras = Array.isArray(leftSlateRows) ? leftSlateRows : [];
  if (!extras.length) return base;
  const seen = new Set(
    base.map((r) => String(r?.player_id || "").trim()).filter(Boolean),
  );
  const merged = [...base];
  for (const extra of extras) {
    const pid = String(extra?.player_id || "").trim();
    if (pid && seen.has(pid)) continue;
    if (!matchesMovementFilter(extra, filterId)) continue;
    if (pid) seen.add(pid);
    merged.push(extra);
  }
  return merged;
}

export function formatMovementSummary(change, { position } = {}) {
  const name = change?.player_name || change?.Player || "Player";
  const pos = positionAbbrev(change?.position || position);
  const status = slateStatus(change);
  const rankLabel = formatRankMove({
    previousRank: change?.previous_rank,
    currentRank: change?.current_rank,
    rankDelta: change?.rank_delta,
    position: pos,
    slateStatus: status,
  });
  const p50Label = formatP50Move(change?.p50_delta ?? change?.delta_p50);
  const parts = [name];
  if (status === SLATE_LEFT) parts.push("Left slate");
  if (rankLabel) parts.push(rankLabel);
  if (p50Label) parts.push(`Proj ${p50Label}`);
  return parts.join(" · ");
}
