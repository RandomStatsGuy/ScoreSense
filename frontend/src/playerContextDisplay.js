/** Display helpers for SCORE-23 cached player-context payloads. */

export const MEDIA_SIGNAL_LABELS = {
  role_up: "Role up",
  injury_watch: "Injury watch",
  mentioned: "Mentioned",
};

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
