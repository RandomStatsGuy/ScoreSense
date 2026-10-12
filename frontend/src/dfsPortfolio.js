import { buildSiteLineupCsv } from "./dfsExport.js";
import { buildEntryCsv } from "./dfsEntryExport.js";
import { moneyCents } from "./dfsCsv.js";
import { DFS_PORTFOLIO_COPY as C } from "./dfsToolPresentation.js";
import { validateGlobalBuildForExport } from "./dfsGlobalExportValidation.js";
import { auditPortfolioRules, auditPortfolioStructure, validatePortfolioReplacementLineage } from "./dfsPortfolioReview.js";

export const PORTFOLIO_TARGET = 150;

/** Detach all nested inputs, then freeze them so later builds cannot rewrite history. */
export function freezeSnapshot(value) {
  const copy = structuredClone(value);
  const freeze = (item) => {
    if (item && typeof item === "object") {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
    return item;
  };
  return freeze(copy);
}

// Canonical identities are exact keys shared by roster rows, bounds and saved
// inputs. Trimming/coercing only appearance counts can make a hard cap miss.
const playerId = (row) => {
  const id = row?.player_id;
  if (typeof id !== "string" || !id || id !== id.trim()) throw new Error(C.missingIdentity);
  return id;
};
const validateCatalogIds = (snapshot) => snapshot.salaryCatalog.filter(p => p.salary != null).forEach(playerId);
export function classicLineupKey(entry) {
  const ids = entry.lineup.map(playerId);
  return JSON.stringify([...new Set(ids)].sort());
}

function catalogKey(catalog) {
  return JSON.stringify(catalog.filter(p => p.salary != null).map(p => [
    String(p.dfs_id), playerId(p), Number(p.salary),
    String(p.Position ?? p.position ?? "").toUpperCase(),
    String(p.Team ?? p.team ?? "").toUpperCase(),
  ]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

function identity(snapshot) {
  return JSON.stringify([snapshot.context.site, snapshot.context.season,
    snapshot.context.week, snapshot.context.source, String(snapshot.context.slateId || ""),
    snapshot.salarySnapshot?.id || null, catalogKey(snapshot.salaryCatalog)]);
}

export function createPortfolioBatch(snapshot, label, id = crypto.randomUUID()) {
  if (!label.trim()) throw new Error(C.labelRequired);
  if (snapshot?.context?.site !== "draftkings") throw new Error(C.classicOnly);
  if (!snapshot.salaryCatalog?.length || !snapshot.settings || !snapshot.lineups?.length)
    throw new Error(C.buildFirst);
  validateCatalogIds(snapshot);
  snapshot.lineups.forEach(classicLineupKey);
  const check = buildSiteLineupCsv("draftkings", snapshot.lineups, snapshot.salaryCatalog);
  if (!check.ok) throw new Error(check.reason);
  return freezeSnapshot({ ...snapshot, id, label: label.trim() });
}

export function appendPortfolioBatch(batches, batch) {
  if (batch.context.site !== "draftkings") throw new Error(C.classicOnly);
  if (batches.length && identity(batches[0]) !== identity(batch)) throw new Error(C.incompatible);
  return [...batches, batch];
}

export function removePortfolioBatch(batches, id) {
  return batches.filter(batch => batch.id !== id);
}

export function portfolioLineups(batches) {
  return batches.flatMap(batch => batch.lineups.map((entry, lineupIndex) => ({
    entry, batch, lineupIndex,
  })));
}

export function auditPortfolio(batches, limits = {}, rules = null) {
  batches.forEach(validateCatalogIds);
  const lineups = portfolioLineups(batches), seen = new Map(), players = new Map(), duplicates = [];
  lineups.forEach(({ entry, batch }, index) => {
    const key = classicLineupKey(entry);
    if (seen.has(key)) duplicates.push({ first: seen.get(key), index, batch: batch.label });
    else seen.set(key, index);
    // A player appearance means one lineup, including every batch's locked players.
    const appeared = new Set();
    entry.lineup.forEach(row => {
      const id = playerId(row);
      const p = players.get(id) || { id, player: row.player, count: 0, quarterbacks: 0, batches: new Set() };
      if (!appeared.has(id)) { p.count++; appeared.add(id); }
      if (row.slot === "QB") p.quarterbacks++;
      p.batches.add(batch.id);
      players.set(id, p);
    });
  });
  const errors = [];
  for (const [id, value] of Object.entries(limits)) {
    if (value == null || String(value).trim() === "") continue;
    const max = Number(value), count = players.get(id)?.count || 0;
    if (!Number.isSafeInteger(max) || max < 0) errors.push(C.invalidLimit);
    else if (count > max) errors.push(C.limitExceeded(players.get(id)?.player || id, count, max));
  }
  batches.forEach(batch => {
    try { validateGlobalBuildForExport(batch); validatePortfolioReplacementLineage(batch); }
    catch (error) { errors.push(`${batch.label}: ${error.message}`); }
  });
  const playerRows = [...players.values()].map(p => ({ ...p, batchCount: p.batches.size,
    percent: lineups.length ? p.count / lineups.length * 100 : 0,
  })).sort((a, b) => b.count - a.count || a.player.localeCompare(b.player));
  let bounds = { players: [], groups: [], errors: [] };
  try { bounds = auditPortfolioRules(batches, playerRows, rules); errors.push(...bounds.errors); }
  catch (error) { errors.push(error.message); }
  return {
    total: lineups.length, unique: seen.size, duplicates,
    requestedCount: batches.reduce((sum, batch) => sum + (Number.isSafeInteger(batch.settings.lineup_count) && batch.settings.lineup_count > 0 ? batch.settings.lineup_count : batch.lineups.length), 0),
    shortfall: Math.max(0, PORTFOLIO_TARGET - seen.size), batchCount: batches.length, errors,
    players: playerRows, bounds, structure: auditPortfolioStructure(batches),
  };
}

/** Validate the whole reviewed set before any saved-build or entry-ledger writes. */
export function buildPortfolioEntryCsv(template, batches, assignments, limits = {}, rules = null) {
  const audit = auditPortfolio(batches, limits, rules);
  if (!audit.total) throw new Error(C.buildFirst);
  if (template.site !== "draftkings") throw new Error(C.classicOnly);
  if (audit.duplicates.length) throw new Error(C.duplicateBlock);
  if (audit.errors.length) throw new Error(audit.errors.join(" "));
  const globalBuilds = [], replacementSources = [];
  batches.forEach(batch => {
    if (batch.context.site !== "draftkings" || identity(batch) !== identity(batches[0])) throw new Error(C.incompatible);
    const check = buildSiteLineupCsv("draftkings", batch.lineups, batch.salaryCatalog);
    if (!check.ok) throw new Error(check.reason);
    const global = validateGlobalBuildForExport(batch);
    if (global) globalBuilds.push({ batchId: batch.id, ...global });
    const replacements = validatePortfolioReplacementLineage(batch);
    if (replacements) replacementSources.push({ batchId: batch.id, ...replacements });
  });
  const selected = Object.values(assignments).filter(v => v !== "" && v != null);
  if (selected.length !== audit.total) throw new Error(C.countMismatch(selected.length, audit.total));
  const indices = selected.map(Number);
  if (indices.some(i => !Number.isInteger(i) || i < 0 || i >= audit.total) || new Set(indices).size !== audit.total)
    throw new Error(C.assignmentRepeat);
  const result = buildEntryCsv(template, portfolioLineups(batches).map(p => p.entry), assignments, batches[0].salaryCatalog);
  return { ...result, manifest: { ...result.manifest, ...(globalBuilds.length ? { globalBuilds } : {}),
    ...(replacementSources.length ? { replacementSources } : {}),
    collectionReview: { version: 1, total: audit.total, unique: audit.unique, rules: audit.bounds.normalized,
      players: audit.bounds.players, groups: audit.bounds.groups, structure: audit.structure } } };
}

export function portfolioBuildPayload(batch) {
  return { site: batch.context.site, slate_id: String(batch.context.slateId || ""),
    slate_name: batch.slateName, lineups: batch.lineups,
    settings: { ...batch.settings, portfolio_batch: { id: batch.id, label: batch.label,
      context: batch.context, salary_catalog: batch.salaryCatalog, salary_snapshot: batch.salarySnapshot } },
    note: batch.settings.note || "",
  };
}

export function portfolioEntryRecords(template, batches, assignments, buildIds) {
  const lineups = portfolioLineups(batches);
  return template.entries.filter(e => assignments[e.id] !== "" && assignments[e.id] != null).map(e => {
    const p = lineups[Number(assignments[e.id])];
    const buildId = buildIds[p.batch.id];
    if (!buildId) throw new Error(C.missingBuild);
    return { site: "draftkings", entry_id: e.id, contest_id: e.contestId, contest_name: e.contest,
      fee_cents: moneyCents(e.fee), status: "unsettled", build_id: buildId, lineup_index: p.lineupIndex };
  });
}
