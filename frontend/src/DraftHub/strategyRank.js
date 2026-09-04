/**
 * Strategy personal draft board — league-context site rank + pairwise inserts.
 *
 * Site order comes from the existing draft-pool overlay (no live predict_*).
 * A pick places the winner immediately above the loser. That order can be
 * written to the existing nomination / pick queue (cap 40).
 *
 * Not Vibes: no aura, no weekly P50 scale, no one-swipe-per-day lock.
 * Not a second valuation: suggested bid stays model fair_value.
 */

export const BOARD_SIZE = 80;
export const QUEUE_CAP = 40;
export const SIMILAR_REL_GAP = 0.18;
export const FLEX_ELIGIBLE = Object.freeze(["RB", "WR", "TE"]);

/** Honest default until Rules stores a scoring profile. Pool today is Hub PPR. */
export const DEFAULT_SCORING_PROFILE = "hub_ppr";

export const UNSUPPORTED_PROFILES = Object.freeze(["dynasty", "standard", "half_ppr"]);

export function scoringLabel(profile) {
  const id = String(profile || DEFAULT_SCORING_PROFILE);
  if (id === "hub_ppr" || id === "ppr") return "Hub PPR";
  if (id === "half_ppr") return "Half PPR";
  if (id === "standard") return "Standard";
  if (id === "dynasty") return "Dynasty";
  return "Hub PPR";
}

export function scoringIsSupported(profile) {
  const id = String(profile || DEFAULT_SCORING_PROFILE);
  return id === "hub_ppr" || id === "ppr";
}

export function boardContext({
  season,
  teamCount = 12,
  draftType = "auction",
  scoringProfile = DEFAULT_SCORING_PROFILE,
  poolFingerprint = "",
} = {}) {
  const scoring = scoringIsSupported(scoringProfile)
    ? (scoringProfile === "ppr" ? DEFAULT_SCORING_PROFILE : scoringProfile)
    : DEFAULT_SCORING_PROFILE;
  return {
    season: season != null ? Number(season) : null,
    teamCount: Number(teamCount) || 12,
    draftType: draftType === "snake" || draftType === "linear" ? draftType : "auction",
    scoringProfile: scoring,
    scoringRequested: scoringProfile || DEFAULT_SCORING_PROFILE,
    scoringSupported: scoringIsSupported(scoringProfile),
    poolFingerprint: String(poolFingerprint || ""),
  };
}

export function contextFingerprint(ctx) {
  const c = boardContext(ctx);
  return [c.season, c.teamCount, c.draftType, c.scoringProfile, c.poolFingerprint].join(":");
}

export function posOf(row) {
  return String(row?.position || "").toUpperCase();
}

export function siteScore(row, ctx = {}) {
  const draftType = boardContext(ctx).draftType;
  if (draftType === "auction") {
    const bid = Number(row?.risk_adjusted_value ?? row?.fair_value ?? row?.model_bid_hint);
    if (Number.isFinite(bid) && bid > 0) return bid;
  }
  const p50 = Number(row?.season_p50 ?? row?.season_proj);
  return Number.isFinite(p50) ? p50 : 0;
}

export function isBoardEligible(row) {
  if (!row?.player_id) return false;
  if (row.is_available === false) return false;
  const status = String(row.status || "available");
  if (status === "taken" || status === "mine" || status === "rostered") return false;
  return true;
}

export function buildSiteBoard(rows, ctx = {}) {
  const scored = (rows || [])
    .filter(isBoardEligible)
    .map((row) => ({
      ...row,
      site_score: siteScore(row, ctx),
    }))
    .sort((a, b) => {
      if (b.site_score !== a.site_score) return b.site_score - a.site_score;
      return String(a.player || a.player_name || "").localeCompare(
        String(b.player || b.player_name || ""),
        undefined,
        { sensitivity: "base" },
      );
    })
    .slice(0, BOARD_SIZE);

  return scored.map((row, idx) => ({
    ...row,
    site_rank: idx + 1,
    personal_rank: idx + 1,
  }));
}

export function orderFromBoard(board) {
  return [...(board || [])]
    .sort((a, b) => (a.personal_rank || 0) - (b.personal_rank || 0))
    .map((row) => String(row.player_id));
}

export function applyOrder(board, order) {
  const rankById = new Map((order || []).map((id, idx) => [String(id), idx + 1]));
  return (board || []).map((row) => ({
    ...row,
    personal_rank: rankById.get(String(row.player_id)) ?? row.site_rank ?? row.personal_rank,
  }));
}

export function rankDelta(row) {
  const site = Number(row?.site_rank);
  const mine = Number(row?.personal_rank);
  if (!Number.isFinite(site) || !Number.isFinite(mine)) return 0;
  return site - mine;
}

export function similarEnough(a, b, ctx = {}) {
  const sa = siteScore(a, ctx);
  const sb = siteScore(b, ctx);
  const denom = Math.max(sa, sb, 1);
  return Math.abs(sa - sb) / denom <= SIMILAR_REL_GAP;
}

export function pairKey(aId, bId) {
  return [String(aId), String(bId)].sort().join(":");
}

function samePosOrFlex(a, b, posFilter) {
  const pa = posOf(a);
  const pb = posOf(b);
  if (!posFilter || posFilter === "ALL") return true;
  if (posFilter === "FLEX") {
    return FLEX_ELIGIBLE.includes(pa) && FLEX_ELIGIBLE.includes(pb);
  }
  return pa === posFilter && pb === posFilter;
}

/**
 * Next toss-up: neighbors on the personal board first, then a wider window.
 * Skip pairs already seen (pick, skip, or too close).
 */
export function nextPair(board, {
  seenKeys = [],
  posFilter = "ALL",
  ctx = {},
} = {}) {
  const ordered = [...(board || [])].sort((a, b) => a.personal_rank - b.personal_rank);
  const seen = new Set(seenKeys);
  const windows = [1, 2, 3, 4];
  for (const gap of windows) {
    for (let i = 0; i < ordered.length - gap; i += 1) {
      const a = ordered[i];
      const b = ordered[i + gap];
      if (!samePosOrFlex(a, b, posFilter)) continue;
      if (!similarEnough(a, b, ctx)) continue;
      const key = pairKey(a.player_id, b.player_id);
      if (seen.has(key)) continue;
      return { a, b, key, neighbor: gap === 1 };
    }
  }
  return null;
}

/** Winner is placed immediately above the loser. No-op if already above. */
export function applyPick(order, winnerId, loserId) {
  const list = [...(order || [])].map(String);
  const winner = String(winnerId || "");
  const loser = String(loserId || "");
  const w = list.indexOf(winner);
  const l = list.indexOf(loser);
  if (w < 0 || l < 0 || winner === loser) {
    return { order: list, moved: false, from: null, to: null };
  }
  if (w < l) {
    return { order: list, moved: false, from: w + 1, to: w + 1 };
  }
  const next = list.filter((id) => id !== winner);
  const insertAt = next.indexOf(loser);
  next.splice(insertAt, 0, winner);
  return { order: next, moved: true, from: w + 1, to: insertAt + 1 };
}

export function queueFromOrder(order, { cap = QUEUE_CAP } = {}) {
  return (order || []).map(String).filter(Boolean).slice(0, cap);
}

export const STRATEGY_RANK_COPY = Object.freeze({
  eyebrow: "Strategy",
  heading: "Put them in the order you will take them.",
  support: "Site board is this league's context. Pick between two close names. Your order can fill the draft queue.",
  useMine: "Use my board in Draft",
  useSite: "Use site board",
  take: "Take",
  skip: "Skip",
  tooClose: "Too close",
  undo: "Undo",
  site: "Site",
  mine: "Mine",
  emptyPair: "No close calls left in this filter. Open All or reset seen pairs.",
  scoringFallback: "Ranks use Hub PPR until Rules names another scoring profile.",
});
