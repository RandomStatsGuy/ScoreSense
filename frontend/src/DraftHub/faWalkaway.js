/** Personal FA walk-away ceiling. Local only — not league FAAB. */

export function walkawayStorageKey(leagueId, playerId) {
  return `ss_fa_walkaway:${leagueId}:${playerId}`;
}

export function parseWalkaway(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

export function readWalkaway(leagueId, playerId, storage = globalThis.localStorage) {
  if (!leagueId || !playerId || !storage) return null;
  try {
    return parseWalkaway(storage.getItem(walkawayStorageKey(leagueId, playerId)));
  } catch {
    return null;
  }
}

export function writeWalkaway(leagueId, playerId, amount, storage = globalThis.localStorage) {
  const n = parseWalkaway(amount);
  if (!leagueId || !playerId || !storage) return null;
  try {
    if (n == null) {
      storage.removeItem(walkawayStorageKey(leagueId, playerId));
    } else {
      storage.setItem(walkawayStorageKey(leagueId, playerId), String(n));
    }
  } catch {
    return n;
  }
  return n;
}

export function suggestedFaBid(row, fallback = 1) {
  const raw = row?.fair_value ?? row?.model_bid_hint ?? row?.suggested_bid ?? row?.min_sal ?? fallback;
  return parseWalkaway(raw) ?? parseWalkaway(fallback) ?? 1;
}

export function bidBlockedByCeiling(amount, ceiling) {
  const bid = parseWalkaway(amount);
  const cap = parseWalkaway(ceiling);
  if (bid == null || cap == null) return false;
  return bid > cap;
}

export function walkawayChipAmber(suggested, ceiling) {
  return bidBlockedByCeiling(suggested, ceiling);
}
