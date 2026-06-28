/** In-memory cache for Draft Hub pool + overlay payloads. */

let poolCache = null;
let overlayCache = null;

function rulesKey(rules) {
  if (!rules) return "";
  const roster = rules.roster || {};
  const serialize = (pos) => JSON.stringify(roster[pos] || {});
  return [
    rules.salary_cap,
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
      min_sal: row.min_sal,
      max_sal: row.max_sal,
      range_source: row.range_source,
      model_bid_hint: row.model_bid_hint,
      fair_value: row.fair_value,
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
