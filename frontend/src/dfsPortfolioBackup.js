import { appendPortfolioBatch, auditPortfolio, createPortfolioBatch, freezeSnapshot } from "./dfsPortfolio.js";
import { DFS_PORTFOLIO_COPY as C } from "./dfsToolPresentation.js";

export const PORTFOLIO_BACKUP_SCHEMA = "scoresense_classic_portfolio";
export const PORTFOLIO_BACKUP_VERSION = 1;
export const PORTFOLIO_BACKUP_MAX_BYTES = 20 * 1024 * 1024;
const BATCH_KEYS = ["id", "label", "context", "slateName", "lineups", "settings", "salaryCatalog", "salarySnapshot"];
const SETTING_KEYS = ["site", "slate_id", "season", "week", "slate_salaries", "salary_snapshot_id", "objective",
  "salary_cap", "locked_player_ids", "excluded_player_ids", "lineup_count", "max_overlap", "max_exposure",
  "randomness", "min_salary", "max_per_team", "qb_stack_count", "stack_bring_back", "stack_game_weights",
  "locked_captain_id", "captain_exposure_limits", "projection_overrides", "apply_injury_adjustments",
  "block_bye_weeks", "note", "ownership", "projection_sources", "build_snapshot", "snapshot_at"];
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype", "accesstoken", "refreshtoken", "idtoken",
  "authorization", "cookie", "credentials", "password", "auth", "authenticated", "session", "sessionid",
  "savedbuild", "savedbuilds", "portfoliobuildids", "buildids", "assignments", "entryassignments", "entrytemplate",
  "owner", "ownerid", "account", "accountid", "userid", "user"]);
const fail = () => { throw new Error(C.backupInvalid); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
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

// Snapshots and catalog columns retain their historical JSON, within bounded
// depth/node/string limits. They are data, never authentication or executable state.
function validateJson(value) {
  let nodes = 0;
  const walk = (v, depth) => {
    if (++nodes > 500_000 || depth > 24) fail();
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "number") { if (!Number.isFinite(v)) fail(); return; }
    if (typeof v === "string") { if (v.length > 20_000) fail(); return; }
    if (typeof v !== "object") fail();
    if (Array.isArray(v)) { if (v.length > 10_000) fail(); v.forEach(x => walk(x, depth + 1)); return; }
    for (const [key, item] of Object.entries(v)) {
      if (key.length > 300 || /token|password|credential|authorization|cookie|secret/i.test(key) ||
          FORBIDDEN_KEYS.has(key) || FORBIDDEN_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""))) fail();
      walk(item, depth + 1);
    }
  };
  walk(value, 0);
}

function validateBatch(batch) {
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
  if (!Array.isArray(batch.lineups) || !batch.lineups.length || batch.lineups.length > 150) fail();
  batch.lineups.forEach(entry => {
    shape(entry, ["lineup", "total_salary", "total_points", "salary_remaining", "objective", "ok", "note"], ["lineup", "total_salary", "total_points"]);
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
}

/** Fully validate before returning a detached, immutable replacement candidate. */
export function readPortfolioBackup(textValue) {
  if (typeof textValue !== "string" || new TextEncoder().encode(textValue).length > PORTFOLIO_BACKUP_MAX_BYTES)
    throw new Error(C.backupSize);
  let data;
  try { data = JSON.parse(textValue); } catch { fail(); }
  validateJson(data);
  shape(data, ["schema", "version", "exportedAt", "batches", "appearanceLimits"]);
  if (data.schema !== PORTFOLIO_BACKUP_SCHEMA || data.version !== PORTFOLIO_BACKUP_VERSION) throw new Error(C.backupVersion);
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
  auditPortfolio(batches, data.appearanceLimits);
  return freezeSnapshot({ ...data, batches });
}

export async function readPortfolioBackupFile(file) {
  if (file.size > PORTFOLIO_BACKUP_MAX_BYTES) throw new Error(C.backupSize);
  return readPortfolioBackup(await file.text());
}

export function writePortfolioBackup(batches, appearanceLimits, exportedAt = new Date().toISOString()) {
  const data = { schema: PORTFOLIO_BACKUP_SCHEMA, version: PORTFOLIO_BACKUP_VERSION, exportedAt,
    batches: batches.map(batch => Object.fromEntries(BATCH_KEYS.map(key => [key, batch[key]]))), appearanceLimits };
  const json = JSON.stringify(data, (_key, value) => {
    if (typeof value === "number" && !Number.isFinite(value)) fail();
    return value;
  });
  readPortfolioBackup(json); // Never download a backup that this version cannot restore.
  return json;
}

export function downloadPortfolioBackup(batches, limits) {
  const json = writePortfolioBackup(batches, limits);
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = `scoresense-classic-portfolio-${Date.now()}.json`;
  link.click(); URL.revokeObjectURL(url);
}
