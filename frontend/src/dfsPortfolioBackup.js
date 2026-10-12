import { appendPortfolioBatch, auditPortfolio, createPortfolioBatch, freezeSnapshot } from "./dfsPortfolio.js";
import { DFS_PORTFOLIO_COPY as C } from "./dfsToolPresentation.js";
import { normalizeClassicStackRules } from "./dfsClassicStackRules.js";
import { assertBuildPlanApplied } from "./dfsBuildPlans.js";
import { normalizePortfolioRules } from "./dfsPortfolioReview.js";

export const PORTFOLIO_BACKUP_SCHEMA = "scoresense_classic_portfolio";
export const PORTFOLIO_BACKUP_VERSION = 2;
export const PORTFOLIO_BACKUP_MAX_BYTES = 20 * 1024 * 1024;
export const PORTFOLIO_BACKUP_MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
export const PORTFOLIO_BACKUP_MAX_EXPANDED_NODES = 2_000_000;
const BATCH_KEYS = ["id", "label", "context", "slateName", "lineups", "settings", "salaryCatalog", "salarySnapshot"];
const SETTING_KEYS = ["site", "slate_id", "season", "week", "slate_salaries", "salary_snapshot_id", "objective",
  "salary_cap", "locked_player_ids", "excluded_player_ids", "lineup_count", "max_overlap", "max_exposure",
  "randomness", "min_salary", "max_per_team", "qb_stack_count", "stack_bring_back", "stack_game_weights",
  "locked_captain_id", "captain_exposure_limits", "projection_overrides", "apply_injury_adjustments",
  "block_bye_weeks", "note", "ownership", "projection_sources", "build_snapshot", "snapshot_at",
  "portfolio_mode", "player_exposure_limits", "group_exposure_limits", "block_qb_opposing_dst", "portfolio_selection", "game_schedule",
  "classic_stack_rules", "plan_manifest", "require_qb_stack", "stack_teams", "stack_qb_ids", "replacement_manifest"];
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype", "accesstoken", "refreshtoken", "idtoken",
  "authorization", "cookie", "credentials", "password", "auth", "authenticated", "session", "sessionid",
  "savedbuild", "savedbuilds", "portfoliobuildids", "buildids", "assignments", "entryassignments", "entrytemplate",
  "owner", "ownerid", "account", "accountid", "userid", "user"]);
const fail = () => { throw new Error(C.backupInvalid); };
const expansionFail = () => { throw new Error(C.backupExpanded || C.backupInvalid); };
const encoder = new TextEncoder();
const byteCache = new Map();
const jsonBytes = value => {
  if (byteCache.has(value)) return byteCache.get(value);
  const size = encoder.encode(JSON.stringify(value)).length;
  if (byteCache.size < 10_000 && (typeof value !== "string" || value.length <= 300)) byteCache.set(value, size);
  return size;
};
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const contentKey = value => JSON.stringify(value, (_key, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const text = (value, max = 300, empty = false) => {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim())) fail();
};
const shape = (value, allowed, required = allowed) => {
  if (!object(value) || Object.keys(value).some(k => !allowed.includes(k)) || required.some(k => !Object.hasOwn(value, k))) fail();
};
const timestamp = value => {
  text(value, 64);
  const parts = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.exec(value);
  if (!parts || !Number.isFinite(Date.parse(value))) fail();
  const [year, month, day, hour, minute, second] = parts.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day ||
      hour > 23 || minute > 59 || second > 59) fail();
};

function validateKey(key) {
  if (key.length > 300 || /token|password|credential|authorization|cookie|secret/i.test(key) ||
      FORBIDDEN_KEYS.has(key) || FORBIDDEN_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""))) fail();
}

// Bound both the file and its eventual in-memory content. Reference wrappers do
// not count as historical data; the same limits are reapplied after expansion.
function validateJson(value, maxDepth = 24) {
  const cache = new WeakMap(), visiting = new Set();
  const checked = summary => {
    if (summary.bytes > PORTFOLIO_BACKUP_MAX_EXPANDED_BYTES || summary.nodes > PORTFOLIO_BACKUP_MAX_EXPANDED_NODES) expansionFail();
    if (summary.height > maxDepth) fail();
    return summary;
  };
  const walk = (v, depth) => {
    if (depth > maxDepth) fail();
    if (v === null || typeof v === "boolean") return { bytes: jsonBytes(v), nodes: 1, height: 0 };
    if (typeof v === "number") { if (!Number.isFinite(v)) fail(); return { bytes: jsonBytes(v), nodes: 1, height: 0 }; }
    if (typeof v === "string") { if (v.length > 20_000) fail(); return { bytes: jsonBytes(v), nodes: 1, height: 0 }; }
    if (typeof v !== "object") fail();
    if (visiting.has(v)) fail();
    if (cache.has(v)) return cache.get(v);
    if (Array.isArray(v) && v.length > 10_000) fail();
    visiting.add(v);
    const pairs = Array.isArray(v) ? Array.from(v, item => [null, item === undefined ? null : item]) : Object.entries(v).filter(([, item]) => item !== undefined);
    const summary = { bytes: 2 + Math.max(0, pairs.length - 1), nodes: 1, height: 0 };
    for (const [key, item] of pairs) {
      if (key !== null) validateKey(key);
      const child = walk(item, depth + 1);
      summary.bytes += (key === null ? 0 : jsonBytes(key) + 1) + child.bytes;
      summary.nodes += child.nodes; summary.height = Math.max(summary.height, child.height + 1);
      checked(summary);
    }
    visiting.delete(v); cache.set(v, summary);
    return summary;
  };
  checked(walk(value, 0));
}

/** Package-local references share equal JSON content, never URLs or server IDs. */
function compactContent(data) {
  const counts = new Map(), keys = new WeakMap();
  const collect = value => {
    if (value === undefined) return "null";
    if (!value || typeof value !== "object") return JSON.stringify(value);
    const key = Array.isArray(value) ? `[${Array.from(value, collect).join(",")}]` :
      `{${Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${collect(value[k])}`).join(",")}}`;
    if (key.length >= 256) { keys.set(value, key); counts.set(key, (counts.get(key) || 0) + 1); }
    return key;
  };
  collect(data);
  const shared = [], indices = new Map();
  const inline = value => {
    if (Array.isArray(value)) return Array.from(value, encode);
    if (Object.hasOwn(value, "$ref") || Object.hasOwn(value, "$literal"))
      return { $literal: Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, encode(item)]) };
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, encode(item)]));
  };
  const encode = value => {
    if (value === undefined) return null;
    if (!value || typeof value !== "object") return value;
    const key = keys.get(value);
    if (key && counts.get(key) > 1) {
      let index = indices.get(key);
      if (index === undefined) {
        index = shared.length;
        // Table capacity bounds the wire format, not valid historical content.
        // Leave later candidates inline; the final file/expansion checks apply.
        if (index >= 10_000) return inline(value);
        indices.set(key, index); shared.push(null);
        shared[index] = inline(value);
      }
      return { $ref: `c${index}` };
    }
    return inline(value);
  };
  return { ...data, batches: encode(data.batches), appearanceLimits: encode(data.appearanceLimits),
    ...(data.reviewRules === undefined ? {} : { reviewRules: encode(data.reviewRules) }), shared };
}

function expandContent(wire) {
  if (!Array.isArray(wire.shared) || wire.shared.length > 10_000 || wire.shared.some(v => !v || typeof v !== "object")) fail();
  const summaries = new Map(), visiting = new Set(), used = new Set();
  const checked = summary => {
    if (summary.bytes > PORTFOLIO_BACKUP_MAX_EXPANDED_BYTES || summary.nodes > PORTFOLIO_BACKUP_MAX_EXPANDED_NODES) expansionFail();
    if (summary.height > 24) fail();
    return summary;
  };
  const reference = value => {
    shape(value, ["$ref"]);
    if (typeof value.$ref !== "string" || !/^c(?:0|[1-9]\d*)$/.test(value.$ref)) fail();
    const index = Number(value.$ref.slice(1));
    if (!Number.isSafeInteger(index) || index >= wire.shared.length) fail();
    return index;
  };
  const literal = value => {
    shape(value, ["$literal"]);
    if (!Array.isArray(value.$literal) || value.$literal.length > 10_000) fail();
    const seen = new Set();
    value.$literal.forEach(pair => {
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || seen.has(pair[0])) fail();
      validateKey(pair[0]); seen.add(pair[0]);
    });
    return value.$literal;
  };
  const inspect = (value, hops = 0) => {
    if (!value || typeof value !== "object") return { bytes: jsonBytes(value), nodes: 1, height: 0 };
    if (!Array.isArray(value) && Object.hasOwn(value, "$ref")) {
      const index = reference(value); used.add(index);
      if (visiting.has(index) || hops >= 32) fail();
      if (!summaries.has(index)) {
        visiting.add(index); summaries.set(index, inspect(wire.shared[index], hops + 1)); visiting.delete(index);
      }
      return summaries.get(index);
    }
    const pairs = Array.isArray(value) ? value.map(item => [null, item]) :
      Object.hasOwn(value, "$literal") ? literal(value) : Object.entries(value);
    const summary = { bytes: 2 + Math.max(0, pairs.length - 1), nodes: 1, height: 0 };
    for (const [key, item] of pairs) {
      const child = inspect(item, hops);
      summary.bytes += (key === null ? 0 : jsonBytes(key) + 1) + child.bytes;
      summary.nodes += child.nodes; summary.height = Math.max(summary.height, 1 + child.height);
      checked(summary);
    }
    return summary;
  };
  const { shared: _shared, ...encoded } = wire;
  checked(inspect(encoded));
  if (used.size !== wire.shared.length) fail();
  // No expanded arrays or objects are allocated until every reference graph has
  // passed cycle, depth and aggregate size checks. All values remain local data.
  const cache = new Map();
  const expand = value => {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(expand);
    if (Object.hasOwn(value, "$ref")) {
      const index = reference(value);
      if (!cache.has(index)) cache.set(index, expand(wire.shared[index]));
      return cache.get(index);
    }
    return Object.fromEntries((Object.hasOwn(value, "$literal") ? literal(value) : Object.entries(value))
      .map(([key, item]) => [key, expand(item)]));
  };
  return expand(encoded);
}

function validateBatch(batch, replacementDepth = 0) {
  shape(batch, BATCH_KEYS);
  text(batch.id, 100); text(batch.label, 100); text(batch.slateName, 300, true);
  shape(batch.context, ["site", "season", "week", "slateId", "source"]);
  const c = batch.context;
  if (c.site !== "draftkings" || !["live", "upload"].includes(c.source) ||
      !Number.isInteger(c.season) || c.season < 2000 || c.season > 2200 ||
      !Number.isInteger(c.week) || c.week < 1 || c.week > 22) fail();
  text(c.slateId, 100, c.source === "upload");
  shape(batch.settings, SETTING_KEYS, ["snapshot_at", "build_snapshot"]);
  const s = batch.settings;
  timestamp(s.snapshot_at);
  if (s.build_snapshot !== null) {
    shape(s.build_snapshot, ["id", "captured_at", "content"]);
    text(s.build_snapshot.id, 100);
    timestamp(s.build_snapshot.captured_at);
    if (!object(s.build_snapshot.content) || s.build_snapshot.content.schema_version !== "dfs_build_inputs_v1") fail();
  }
  if (batch.salarySnapshot !== null) {
    shape(batch.salarySnapshot, ["id", "captured_at", "site", "slate_id", "source", "player_count", "scope",
      "game_metadata_complete", "scoring_verified", "lock_state_verified"], ["id"]);
    text(batch.salarySnapshot.id, 100);
    if (batch.salarySnapshot.captured_at !== undefined) timestamp(batch.salarySnapshot.captured_at);
    if (batch.salarySnapshot.site !== undefined && batch.salarySnapshot.site !== c.site) fail();
    if (batch.salarySnapshot.slate_id !== undefined && batch.salarySnapshot.slate_id !== c.slateId) fail();
    if (batch.salarySnapshot.scoring_verified || batch.salarySnapshot.lock_state_verified) fail();
  }
  if ((s.site !== undefined && s.site !== c.site) || (s.slate_id != null && s.slate_id !== c.slateId) ||
      (s.season !== undefined && s.season !== c.season) || (s.week !== undefined && s.week !== c.week) ||
      (s.salary_snapshot_id != null && s.salary_snapshot_id !== batch.salarySnapshot?.id)) fail();
  for (const key of ["locked_player_ids", "excluded_player_ids"]) {
    if (s[key] !== undefined) {
      if (!Array.isArray(s[key]) || s[key].length > 5000) fail();
      s[key].forEach(id => text(id, 100));
    }
  }
  for (const key of ["salary_cap", "lineup_count", "max_overlap", "max_exposure", "randomness", "min_salary", "max_per_team", "qb_stack_count"]) {
    if (s[key] != null && typeof s[key] !== "number") fail();
  }
  for (const key of ["stack_bring_back", "apply_injury_adjustments", "block_bye_weeks"]) {
    if (s[key] !== undefined && typeof s[key] !== "boolean") fail();
  }
  for (const key of ["ownership", "projection_sources", "projection_overrides", "captain_exposure_limits"]) {
    if (s[key] !== undefined && !object(s[key])) fail();
  }
  if (s.slate_salaries !== undefined && (!Array.isArray(s.slate_salaries) || s.slate_salaries.length > 5000)) fail();
  if (!Array.isArray(batch.salaryCatalog) || !batch.salaryCatalog.length || batch.salaryCatalog.length > 5000) fail();
  const dfsIds = new Set(), canonicalIds = new Set();
  batch.salaryCatalog.forEach(p => {
    if (!object(p)) fail();
    text(p.player_id, 100);
    if (canonicalIds.has(p.player_id)) fail();
    canonicalIds.add(p.player_id);
    if (p.salary == null) return;
    text(p.dfs_id, 100);
    if (!/^[1-9]\d*$/.test(p.dfs_id) || dfsIds.has(p.dfs_id) || !Number.isSafeInteger(p.salary) || p.salary <= 0) fail();
    dfsIds.add(p.dfs_id);
    text(p.Player ?? p.player_name); text(p.Position ?? p.position, 10); text(p.Team ?? p.team, 10);
  });
  if (s.classic_stack_rules != null) {
    normalizeClassicStackRules(s.classic_stack_rules, batch.salaryCatalog);
    if (s.portfolio_mode !== "global" || s.require_qb_stack || s.qb_stack_count || s.stack_bring_back || s.stack_game_weights?.length) fail();
  }
  if (s.plan_manifest != null) {
    if (!object(s.plan_manifest)) fail();
    assertBuildPlanApplied(s.plan_manifest, s);
  }
  if (!Array.isArray(batch.lineups) || !batch.lineups.length || batch.lineups.length > 150) fail();
  batch.lineups.forEach(entry => {
    shape(entry, ["lineup", "total_salary", "total_points", "salary_remaining", "objective", "ok", "note", "solver_status"], ["lineup", "total_salary", "total_points"]);
    if (!Array.isArray(entry.lineup) || entry.lineup.length !== 9 ||
        typeof entry.total_points !== "number" || !Number.isSafeInteger(entry.total_salary)) fail();
    entry.lineup.forEach(p => {
      shape(p, ["slot", "player_id", "dfs_id", "player", "team", "position", "salary", "proj", "floor", "ceiling", "value", "injury_status", "on_bye"],
        ["slot", "player_id", "dfs_id", "player", "team", "position", "salary", "proj", "floor", "ceiling"]);
      ["slot", "player_id", "dfs_id", "player", "team", "position"].forEach(k => text(p[k]));
      if (!Number.isSafeInteger(p.salary) || p.salary <= 0 || ["proj", "floor", "ceiling"].some(k => typeof p[k] !== "number")) fail();
    });
    if (entry.total_salary !== entry.lineup.reduce((sum, p) => sum + p.salary, 0)) fail();
  });
  if (s.replacement_manifest != null) {
    if (replacementDepth) fail();
    const manifest = s.replacement_manifest;
    shape(manifest, ["version", "mode", "original_batch_id", "replacements"]);
    if (manifest.version !== 1 || manifest.mode !== "lineup" || !Array.isArray(manifest.replacements) ||
        !manifest.replacements.length || manifest.replacements.length > batch.lineups.length || s.portfolio_selection != null) fail();
    text(manifest.original_batch_id, 100);
    const indices = new Set();
    for (const record of manifest.replacements) {
      shape(record, ["lineup_index", "candidate_lineup_index", "candidate_source"]);
      if (!Number.isSafeInteger(record.lineup_index) || record.lineup_index < 0 || record.lineup_index >= batch.lineups.length || indices.has(record.lineup_index)) fail();
      indices.add(record.lineup_index);
      const source = record.candidate_source;
      shape(source, ["context", "slateName", "lineups", "settings", "salaryCatalog", "salarySnapshot"]);
      validateBatch({ ...source, id: "replacement-source", label: "Replacement source" }, replacementDepth + 1);
      if (!Number.isSafeInteger(record.candidate_lineup_index) || record.candidate_lineup_index < 0 || record.candidate_lineup_index >= source.lineups.length) fail();
      // A restored source must be compatible with the collected slate, and its
      // selected lineup must still be the exact historical replacement record.
      appendPortfolioBatch([batch], createPortfolioBatch(source, "Replacement source", "replacement-source"));
      if (contentKey(batch.lineups[record.lineup_index]) !== contentKey(source.lineups[record.candidate_lineup_index])) fail();
    }
  }
}

/** Fully validate before returning a detached, immutable replacement candidate. */
export function readPortfolioBackup(textValue) {
  if (typeof textValue !== "string" || encoder.encode(textValue).length > PORTFOLIO_BACKUP_MAX_BYTES)
    throw new Error(C.backupSize);
  let data;
  try { data = JSON.parse(textValue); } catch { fail(); }
  if (!object(data)) fail();
  if (data.schema !== PORTFOLIO_BACKUP_SCHEMA || ![1, 2].includes(data.version)) throw new Error(C.backupVersion);
  const required = ["schema", "version", "exportedAt", "batches", "appearanceLimits"];
  shape(data, [...required, "reviewRules", ...(data.version === 2 ? ["shared"] : [])], [...required, ...(data.version === 2 ? ["shared"] : [])]);
  validateJson(data, data.version === 2 ? 40 : 24);
  if (data.version === 2) data = expandContent(data);
  validateJson(data);
  timestamp(data.exportedAt);
  if (!Array.isArray(data.batches) || data.batches.length > 50 || !object(data.appearanceLimits)) fail();
  let batches = [], count = 0;
  const ids = new Set();
  for (const batch of data.batches) {
    validateBatch(batch);
    if (ids.has(batch.id) || (count += batch.lineups.length) > 500) fail();
    ids.add(batch.id);
    // Reuse existing roster, canonical-ID, slate/catalog compatibility checks.
    batches = appendPortfolioBatch(batches, createPortfolioBatch(batch, batch.label, batch.id));
  }
  if (Object.keys(data.appearanceLimits).length > 5000) fail();
  for (const [id, limit] of Object.entries(data.appearanceLimits)) {
    text(id, 100);
    if (limit === null || limit === "") continue;
    if (!["string", "number"].includes(typeof limit) || String(limit).trim() === "" || !Number.isSafeInteger(Number(limit)) || Number(limit) < 0) fail();
  }
  // Duplicate lineups and exceeded limits are restored as visible audit failures.
  const reviewRules = data.reviewRules === undefined ? {} : { reviewRules: normalizePortfolioRules(data.reviewRules, batches) };
  auditPortfolio(batches, data.appearanceLimits, reviewRules.reviewRules);
  return freezeSnapshot({ ...data, ...reviewRules, batches });
}

export async function readPortfolioBackupFile(file) {
  if (file.size > PORTFOLIO_BACKUP_MAX_BYTES) throw new Error(C.backupSize);
  return readPortfolioBackup(await file.text());
}

export function writePortfolioBackup(batches, appearanceLimits = {}, exportedAt = new Date().toISOString(), options = {}) {
  shape(options, ["version", "reviewRules"], []);
  const version = options.version ?? PORTFOLIO_BACKUP_VERSION;
  if (![1, 2].includes(version)) throw new Error(C.backupVersion);
  if (!Array.isArray(batches) || batches.length > 50) fail();
  const data = { schema: PORTFOLIO_BACKUP_SCHEMA, version, exportedAt,
    batches: batches.map(batch => Object.fromEntries(BATCH_KEYS.map(key => [key, batch[key]]))), appearanceLimits,
    ...(options.reviewRules === undefined ? {} : { reviewRules: normalizePortfolioRules(options.reviewRules, batches) }) };
  validateJson(data);
  const json = JSON.stringify(version === 2 ? compactContent(data) : data);
  readPortfolioBackup(json); // Never download a backup that this version cannot restore.
  return json;
}

export function downloadPortfolioBackup(batches, limits, reviewRules) {
  const json = writePortfolioBackup(batches, limits, undefined, { reviewRules });
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = `scoresense-classic-portfolio-${Date.now()}.json`;
  link.click(); URL.revokeObjectURL(url);
}
