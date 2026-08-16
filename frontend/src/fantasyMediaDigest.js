/**
 * SCORE-29: fantasy-show commentary uses fantasy_media_digest only.
 * Do not read beat_digest here — that field is reserved for true team beat readout.
 */

export function pickFantasyMediaDigest(row) {
  if (!row || typeof row !== "object") return "";
  const text = row.fantasy_media_digest;
  return typeof text === "string" ? text.trim() : "";
}

export function pickFantasyMediaDigestSource(row) {
  if (!row || typeof row !== "object") return undefined;
  return row.fantasy_media_digest_source || undefined;
}

export function fantasyMediaNarrative(row, ...fallbacks) {
  const digest = pickFantasyMediaDigest(row);
  if (digest) return digest;
  for (const value of fallbacks) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}
