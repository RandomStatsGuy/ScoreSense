/** Build draft-room enrichment payloads from whatever player lists are on screen. */

const MAX_ENRICHMENT_PLAYERS = 400;

function hintFromRow(row) {
  if (!row) return null;
  const playerId = row.player_id || row.playerId;
  if (!playerId) return null;
  return {
    player_id: playerId,
    player_name: row.player || row.player_name || row.name || "",
    team: row.team || row.nfl_team || "",
    position: row.position || "",
  };
}

export function enrichmentPlayerHints(rows = [], extras = [], { limit = MAX_ENRICHMENT_PLAYERS } = {}) {
  const seen = new Set();
  const out = [];
  for (const row of [...rows, ...extras]) {
    const hint = hintFromRow(row);
    if (!hint) continue;
    const key = String(hint.player_id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hint);
    if (out.length >= limit) break;
  }
  return out;
}

export function mergePlayerMedia(local = {}, enrichment = {}) {
  const out = { ...local };
  for (const [id, row] of Object.entries(enrichment || {})) {
    if (!row || typeof row !== "object") continue;
    const current = out[id];
    if (row.headshot_url || row.team_logo_url) {
      out[id] = { ...current, ...row };
    } else if (!current) {
      out[id] = row;
    }
  }
  return out;
}
