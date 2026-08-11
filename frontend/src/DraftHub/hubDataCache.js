/** In-memory cache for Draft Hub pool + overlay payloads. */

let poolCache = null;
let overlayCache = null;

const INSIGHTS_SESSION_PREFIX = "ss_insights_";
const INSIGHTS_CACHE_VERSION = 2;

function rulesKey(rules) {
  if (!rules) return "";
  const roster = rules.roster || {};
  const serialize = (pos) => JSON.stringify(roster[pos] || {});
  return [
    rules.salary_cap,
    rules.risk_tolerance ?? 0,
    serialize("qb"),
    serialize("rb"),
    serialize("wr"),
    serialize("te"),
    serialize("k"),
    serialize("def"),
    JSON.stringify(roster.flex || {}),
    JSON.stringify(rules.auction || {}),
    JSON.stringify(rules.contracts || {}),
  ].join("|");
}

export function poolCacheKey(season, rules) {
  return `${season}:${rulesKey(rules)}`;
}

export function getCachedPool(season, rules) {
  const key = poolCacheKey(season, rules);
  if (poolCache?.key === key) return poolCache.data;
  return null;
}

export function setCachedPool(season, rules, data) {
  poolCache = { key: poolCacheKey(season, rules), data };
}

export function getCachedOverlay(season) {
  if (overlayCache?.season === season) return overlayCache.data;
  return null;
}

export function setCachedOverlay(season, data) {
  overlayCache = { season, data };
}

export function clearHubDataCache() {
  poolCache = null;
  overlayCache = null;
  clearLeagueRostersCache();
}

/** Session + memory cache for commissioner Teams tab (/league/{id}/rosters). */
const ROSTERS_SESSION_PREFIX = "ss_rosters_";
const ROSTERS_CACHE_VERSION = 1;

export function leagueRostersCacheKey(leagueId, sourceVersion = "") {
  return `${leagueId}:${sourceVersion || "v0"}`;
}

export function getLeagueRostersCache(leagueId, sourceVersion) {
  const memKey = leagueRostersCacheKey(leagueId, sourceVersion);
  if (getLeagueRostersCache._mem?.[memKey]) {
    return getLeagueRostersCache._mem[memKey];
  }
  try {
    const raw = sessionStorage.getItem(`${ROSTERS_SESSION_PREFIX}${memKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.v !== ROSTERS_CACHE_VERSION || !parsed?.data) return null;
    getLeagueRostersCache._mem = getLeagueRostersCache._mem || {};
    getLeagueRostersCache._mem[memKey] = parsed.data;
    return parsed.data;
  } catch {
    return null;
  }
}
getLeagueRostersCache._mem = {};

export function setLeagueRostersCache(leagueId, sourceVersion, data) {
  const memKey = leagueRostersCacheKey(leagueId, sourceVersion);
  getLeagueRostersCache._mem = getLeagueRostersCache._mem || {};
  getLeagueRostersCache._mem[memKey] = data;
  try {
    sessionStorage.setItem(
      `${ROSTERS_SESSION_PREFIX}${memKey}`,
      JSON.stringify({ v: ROSTERS_CACHE_VERSION, data, at: Date.now() }),
    );
  } catch {
    /* quota */
  }
}

export function getAnyLeagueRostersCache(leagueId) {
  if (getLeagueRostersCache._mem) {
    const prefix = `${leagueId}:`;
    for (const [key, data] of Object.entries(getLeagueRostersCache._mem)) {
      if (key.startsWith(prefix)) return data;
    }
  }
  try {
    const prefix = `${ROSTERS_SESSION_PREFIX}${leagueId}:`;
    let best = null;
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const k = sessionStorage.key(i);
      if (!k?.startsWith(prefix)) continue;
      const parsed = JSON.parse(sessionStorage.getItem(k));
      if (parsed?.v === ROSTERS_CACHE_VERSION && parsed?.data) {
        if (!best || (parsed.at || 0) > (best.at || 0)) best = parsed;
      }
    }
    return best?.data || null;
  } catch {
    return null;
  }
}

export function clearLeagueRostersCache(leagueId) {
  getLeagueRostersCache._mem = {};
  try {
    const prefix = leagueId
      ? `${ROSTERS_SESSION_PREFIX}${leagueId}:`
      : ROSTERS_SESSION_PREFIX;
    const toRemove = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(prefix)) toRemove.push(k);
    }
    toRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

/** Session-persisted Insights section cache (stale-while-revalidate). */
export function insightsSectionKey(leagueId, section, seasonKey = "current") {
  return `${leagueId}:${section}:${seasonKey}`;
}

export function getInsightsSection(leagueId, section, seasonKey = "current") {
  const memKey = insightsSectionKey(leagueId, section, seasonKey);
  if (getInsightsSection._mem?.[memKey]) {
    return getInsightsSection._mem[memKey];
  }
  try {
    const raw = sessionStorage.getItem(`${INSIGHTS_SESSION_PREFIX}${memKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.v !== INSIGHTS_CACHE_VERSION || !parsed?.data) return null;
    getInsightsSection._mem = getInsightsSection._mem || {};
    getInsightsSection._mem[memKey] = parsed.data;
    return parsed.data;
  } catch {
    /* ignore */
  }
  return null;
}
getInsightsSection._mem = {};

export function setInsightsSection(leagueId, section, seasonKey, data) {
  const memKey = insightsSectionKey(leagueId, section, seasonKey);
  getInsightsSection._mem = getInsightsSection._mem || {};
  getInsightsSection._mem[memKey] = data;
  try {
    sessionStorage.setItem(
      `${INSIGHTS_SESSION_PREFIX}${memKey}`,
      JSON.stringify({ v: INSIGHTS_CACHE_VERSION, data, at: Date.now() }),
    );
  } catch {
    /* quota */
  }
}

export function clearInsightsSectionCache(leagueId) {
  getInsightsSection._mem = {};
  try {
    const prefix = leagueId
      ? `${INSIGHTS_SESSION_PREFIX}${leagueId}:`
      : INSIGHTS_SESSION_PREFIX;
    const toRemove = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(prefix)) toRemove.push(k);
    }
    toRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

/** Clear insights cache after cap sheet sync / contract updates. */
export function invalidateInsightsAfterCapSync(leagueId) {
  if (leagueId) clearInsightsSectionCache(leagueId);
  invalidateFreshnessCache(leagueId);
}

/** In-memory freshness strip cache (/league/{id}/freshness). */
const freshnessCache = new Map();

export function getFreshnessCache(leagueId) {
  if (!leagueId) return null;
  return freshnessCache.get(leagueId) || null;
}

export function setFreshnessCache(leagueId, data) {
  if (!leagueId) return;
  freshnessCache.set(leagueId, { data, at: Date.now() });
}

export function invalidateFreshnessCache(leagueId) {
  if (leagueId) freshnessCache.delete(leagueId);
  else freshnessCache.clear();
}

/** Pool-shaped payload for client cache (valuation fields only). */
export function poolPayloadFromSheet(sheet) {
  if (!sheet?.rows) return sheet;
  return {
    season: sheet.season,
    team_count: sheet.team_count,
    count: sheet.count,
    pool_mode: sheet.pool_mode || "draft",
    rows: sheet.rows.map((row) => ({
      player_id: row.player_id,
      player: row.player,
      team: row.team,
      position: row.position,
      season_proj: row.season_proj,
      per_game_proj: row.per_game_proj,
      season_p10: row.season_p10,
      season_p50: row.season_p50,
      season_p90: row.season_p90,
      season_spread: row.season_spread,
      games_expected: row.games_expected,
      season_quantile_method: row.season_quantile_method,
      min_sal: row.min_sal,
      max_sal: row.max_sal,
      range_source: row.range_source,
      model_bid_hint: row.model_bid_hint,
      fair_value: row.fair_value,
      risk_score: row.risk_score,
      risk_adjusted_value: row.risk_adjusted_value,
      tier: row.tier,
      is_rookie: row.is_rookie,
    })),
  };
}

export function mergePoolAndOverlay(pool, overlay) {
  if (!pool?.rows?.length) return overlay;
  if (!overlay?.rows?.length) return pool;
  const overlayById = new Map(
    overlay.rows.map((row) => [row.player_id, row]),
  );
  const poolIds = new Set(pool.rows.map((r) => r.player_id));
  const rows = pool.rows.map((base) => {
    const extra = overlayById.get(base.player_id);
    return extra ? { ...base, ...extra } : base;
  });
  for (const row of overlay.rows) {
    if (!poolIds.has(row.player_id)) {
      rows.push(row);
    }
  }
  return {
    ...pool,
    ...overlay,
    rows,
    count: rows.length,
  };
}
