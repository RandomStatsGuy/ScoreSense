/** Display helpers for SCORE-23/24/30 cached player-context payloads. */

export const MEDIA_SIGNAL_LABELS = {
  role_up: "Role up",
  injury_watch: "Injury watch",
  mentioned: "Mentioned",
};

/** Visible trust labels (SCORE-24) — keep distinct from API metadata alone. */
export const TRUST_LABEL = {
  INCLUDED: "Included in projection",
  COMMENTARY: "Commentary only",
  ASSUMES_ACTIVE: "Projection assumes active",
};

/** Designations where we must not imply the player's own line is fully modeled. */
const ASSUMES_ACTIVE_STATUS_RE = /questionable|doubtful/i;

export function mediaSignalLabel(signal) {
  if (!signal) return null;
  return MEDIA_SIGNAL_LABELS[signal] || String(signal).replace(/_/g, " ");
}

export function mediaSignalTone(signal) {
  const s = String(signal || "").toLowerCase();
  if (s === "role_up") return "positive";
  if (s === "injury_watch") return "caution";
  if (s === "mentioned") return "neutral";
  return "default";
}

export function formatOppPoints(points) {
  const n = Number(points);
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return null;
  const abs = Math.abs(n).toFixed(1);
  return n > 0 ? `+${abs}` : `−${abs}`;
}

export function formatProjPts(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(1) : "—";
}

/**
 * SCORE-30: table expand affordance from compact list rows.
 * Hide Ctx when the cached row has nothing worth lazy-loading.
 */
export function isDetailAvailable(context) {
  if (!context || typeof context !== "object") return false;
  if (typeof context.detail_available === "boolean") {
    return context.detail_available;
  }
  // Detail endpoint / pre-SCORE-30 rows without the flag still warrant expand.
  return true;
}

/** Compact injury age for badges (hours since availability.updated_at). */
export function formatInjuryAgeHours(ageHours) {
  if (ageHours == null || ageHours === "") return null;
  const n = Number(ageHours);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n < 1) return "<1h";
  if (n < 48) return `${Math.round(n)}h`;
  const days = Math.round(n / 24);
  return `${days}d`;
}

/**
 * Parse ISO strings or unix ms/seconds into a Date, or null.
 */
export function parseContextTime(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function projectionFreshnessAt(context, slateMeta = null) {
  const meta = context?.meta || {};
  return parseContextTime(
    meta.artifact_built_at
      || meta.context_built_at
      || slateMeta?.built_at
      || slateMeta?.artifact_built_at
      || slateMeta?.injury_snapshot_built_at,
  );
}

export function injuryStatusFreshnessAt(context) {
  return parseContextTime(context?.availability?.updated_at);
}

/**
 * Only label "Included in projection" when:
 * - opportunity_adjustment.included is true
 * - artifact is not flagged stale (AC11 coordination)
 * - projection snapshot time ≥ displayed injury status time (when both known)
 */
export function canLabelIncludedInProjection(context, slateMeta = null) {
  const opp = context?.opportunity_adjustment;
  if (!opp?.included) return false;
  if (context?.meta?.stale || slateMeta?.stale) return false;

  const injuryAt = injuryStatusFreshnessAt(context);
  const projAt = projectionFreshnessAt(context, slateMeta);
  if (injuryAt && projAt && projAt.getTime() < injuryAt.getTime()) return false;
  return true;
}

/**
 * Questionable / Doubtful (and similar) when the player's own line is not reduced.
 * Teammate opportunity may move; do not imply the designation is fully modeled.
 */
export function shouldShowProjectionAssumesActive(context) {
  const status = context?.availability?.status;
  if (!status || !ASSUMES_ACTIVE_STATUS_RE.test(String(status))) return false;

  const delta = Number(context?.projection?.injury_delta);
  if (Number.isFinite(delta) && delta < -0.005) return false;
  return true;
}

/**
 * Media context never feeds the number (affects_projection=false).
 * Always return the Commentary only label when media content is shown.
 */
export function commentaryOnlyLabel(media) {
  if (!media) return null;
  if (media.affects_projection) return null;
  return TRUST_LABEL.COMMENTARY;
}

/**
 * Build a Map<player_id, context> from a list endpoint response.
 */
export function indexPlayersContext(payload) {
  const map = new Map();
  const players = payload?.players || [];
  for (const row of players) {
    const id = row?.player_id != null ? String(row.player_id) : "";
    if (id) map.set(id, row);
  }
  return map;
}
