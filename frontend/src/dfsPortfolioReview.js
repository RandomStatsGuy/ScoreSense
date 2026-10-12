import { appendPortfolioBatch, auditPortfolio, classicLineupKey, createPortfolioBatch, freezeSnapshot, portfolioLineups } from "./dfsPortfolio.js";
import { exposureBoundCount } from "./dfsExposureBounds.js";
import { normalizeDfsTeam } from "./dfsToolPresentation.js";
import { DFS_REVIEW_COPY as C } from "./dfsPortfolioReviewPresentation.js";
import { validateGlobalBuildForExport } from "./dfsGlobalExportValidation.js";

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const canonical = value => JSON.stringify(value, (_key, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const idOf = row => String(row.player_id ?? "");
const position = row => String(row.Position ?? row.position ?? "").toUpperCase();
const teamOf = row => normalizeDfsTeam(row.Team ?? row.team);
const knownTeam = value => { const team = normalizeDfsTeam(value); return team && !["BYE", "NAN", "NONE", "NULL"].includes(team) ? team : ""; };
const fail = reason => { throw new Error(reason); };
const shape = (value, keys) => { if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) fail(C.malformed); };
const catalogs = batches => new Map(batches.flatMap(batch => (batch.salaryCatalog || []).filter(p => p.salary != null).map(p => [idOf(p), p])));
function countBound(value, kind) {
  if (value == null || value === "") return null;
  if (!["number", "string"].includes(typeof value) || (typeof value === "string" &&
      !(kind === "target" ? /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/ : /^\d+$/).test(value))) fail(C.invalidCount(kind));
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0 || count > 10000 || (kind !== "target" && !Number.isSafeInteger(count))) fail(C.invalidCount(kind));
  return count;
}
function normalizeBounds(rule, label) {
  shape(rule, ["min", "target", "max"]);
  const result = Object.fromEntries(["min", "target", "max"].map(kind => [kind, countBound(rule[kind], kind)]).filter(([, value]) => value !== null));
  if ((result.min ?? 0) > (result.max ?? Infinity)) fail(C.contradictory(label));
  return result;
}
/** Shape/identity validation only. Feasibility against actual saved lineups is audited separately. */
export function normalizePortfolioRules(value = null, batches = []) {
  if (value == null) return { version: 1, players: {}, groups: [] };
  shape(value, ["version", "players", "groups"]);
  if (value.version !== 1 || !object(value.players) || Object.keys(value.players).length > 5000 || !Array.isArray(value.groups) || value.groups.length > 50) fail(C.malformed);
  const catalog = catalogs(batches), players = {}, ids = new Set(), combinations = new Set();
  for (const [id, rule] of Object.entries(value.players)) {
    if (!catalog.has(id)) fail(C.unknownPlayer(id));
    Object.defineProperty(players, id, { value: normalizeBounds(rule, catalog.get(id).Player || id), enumerable: true, configurable: true, writable: true });
  }
  const groups = value.groups.map(group => {
    shape(group, ["id", "player_ids", "min", "target", "max"]);
    if (typeof group.id !== "string" || !/^[A-Za-z0-9:_-]{1,100}$/.test(group.id) || ids.has(group.id) || !Array.isArray(group.player_ids) ||
        group.player_ids.length < 2 || group.player_ids.length > 9 || group.player_ids.some(id => typeof id !== "string" || !catalog.has(id)) || new Set(group.player_ids).size !== group.player_ids.length) fail(C.repeatedGroup);
    const members = [...group.player_ids].sort(), key = JSON.stringify(members);
    if (combinations.has(key)) fail(C.repeatedGroup);
    ids.add(group.id); combinations.add(key);
    return { id: group.id, player_ids: members, ...normalizeBounds(Object.fromEntries(["min", "target", "max"].filter(kind => Object.hasOwn(group, kind)).map(kind => [kind, group[kind]])), group.id) };
  });
  return { version: 1, players, groups };
}

export function auditPortfolioRules(batches, players, value) {
  const normalized = normalizePortfolioRules(value, batches), counts = new Map(players.map(p => [p.id, p.count])), catalog = catalogs(batches), errors = [];
  const report = (id, bounds, actual, label, player_ids = [id]) => {
    if (bounds.min != null && actual < bounds.min) errors.push(C.minimumMiss(label, actual, bounds.min));
    if (bounds.max != null && actual > bounds.max) errors.push(C.maximumMiss(label, actual, bounds.max));
    return { id, player_ids, label, ...bounds, actual, targetMiss: bounds.target == null ? null : actual - bounds.target };
  };
  const playerBounds = Object.entries(normalized.players).map(([id, bounds]) => report(id, bounds, counts.get(id) || 0, catalog.get(id).Player ?? id));
  const groupBounds = normalized.groups.map(group => report(group.id, group,
    portfolioLineups(batches).filter(({ entry }) => group.player_ids.every(id => entry.lineup.some(row => idOf(row) === id))).length,
    group.id, group.player_ids));
  return { normalized, players: playerBounds, groups: groupBounds, errors };
}

/** Descriptive incidence only: no ownership product, probability or correlation model. */
export function auditPortfolioStructure(batches) {
  const flat = portfolioLineups(batches), pairs = new Map(), qbs = new Map(), games = new Map(), teams = new Map(), injuries = new Map(), stacks = new Map();
  const flex = { RB: 0, WR: 0, TE: 0 }, defenses = new Map(), salaries = [], sets = [], overlapHistogram = new Map();
  let projectionSum = 0, projectionsKnown = true, salaryKnown = true, maximumOverlap = 0;
  const increment = (map, key, data, batchId) => {
    const record = map.get(key) || { ...data, count: 0, batches: new Set() };
    record.count++; record.batches.add(batchId); map.set(key, record);
  };
  for (const { entry, batch } of flat) {
    const rows = [...new Map(entry.lineup.map(row => [idOf(row), row])).values()], members = new Set(rows.map(idOf));
    const catalog = new Map(batch.salaryCatalog.map(p => [idOf(p), p]));
    const original = new Map((batch.settings.build_snapshot?.content?.eligible_players || []).map(p => [idOf(p), p]));
    const declared = new Set(batch.settings.classic_stack_rules?.attachments?.receiving_rb_ids || []);
    const qb = rows.find(row => row.slot === "QB"), qbTeam = knownTeam(qb?.team), qbId = qb && idOf(qb);
    const opponentRaw = qbId && (original.get(qbId)?.opponent ?? catalog.get(qbId)?.Opponent ?? catalog.get(qbId)?.opponent);
    const opponent = knownTeam(opponentRaw), relationshipKnown = !!(qbTeam && opponent && qbTeam !== opponent);
    if (qb) {
      increment(qbs, qbId, { id: qbId, player: qb.player }, batch.id);
      const gameKey = JSON.stringify([qbId, relationshipKnown ? [qbTeam, opponent].sort() : null]);
      increment(games, gameKey, { id: gameKey, qb_id: qbId, player: qb.player, team: qbTeam, opponent: relationshipKnown ? opponent : null, relationship_known: relationshipKnown }, batch.id);
      const eligibleAttachments = rows.filter(row => ["WR", "TE"].includes(position(row)) || (position(row) === "RB" && declared.has(idOf(row))));
      const opposingSkills = rows.filter(row => ["RB", "WR", "TE"].includes(position(row)));
      const attachments = qbTeam && eligibleAttachments.every(row => knownTeam(row.team))
        ? eligibleAttachments.filter(row => knownTeam(row.team) === qbTeam).length : null;
      const bring_back = relationshipKnown && opposingSkills.every(row => knownTeam(row.team))
        ? opposingSkills.filter(row => knownTeam(row.team) === opponent).length : null;
      const key = JSON.stringify([attachments, bring_back]); increment(stacks, key, { id: key, attachments, bring_back }, batch.id);
    }
    const flexRow = rows.find(row => row.slot === "FLEX"); if (Object.hasOwn(flex, position(flexRow || {}))) flex[position(flexRow)]++;
    for (const team of new Set(rows.map(teamOf).filter(team => team && team !== "BYE"))) increment(teams, team, { id: team, team }, batch.id);
    for (const row of rows) {
      if (position(row) === "DST") increment(defenses, idOf(row), { id: idOf(row), player: row.player }, batch.id);
      const status = String(row.injury_status ?? original.get(idOf(row))?.injury_status ?? catalog.get(idOf(row))?.["Injury Status"] ?? catalog.get(idOf(row))?.injury_status ?? "").trim();
      if (status) increment(injuries, JSON.stringify([idOf(row), status]), { id: idOf(row), player: row.player, status, player_ids: [idOf(row)] }, batch.id);
    }
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
      const pair = [rows[i], rows[j]].sort((a, b) => idOf(a).localeCompare(idOf(b))), ids = pair.map(idOf), key = JSON.stringify(ids);
      increment(pairs, key, { id: key, player_ids: ids, names: pair.map(p => p.player), rb: pair.every(row => position(row) === "RB") }, batch.id);
    }
    if (typeof entry.total_salary !== "number" || !Number.isFinite(entry.total_salary)) salaryKnown = false; else salaries.push(entry.total_salary);
    if (typeof entry.total_points !== "number" || !Number.isFinite(entry.total_points)) projectionsKnown = false; else projectionSum += entry.total_points;
    if (flat.length <= 1000) for (const previous of sets) { const n = [...members].filter(id => previous.has(id)).length;
      maximumOverlap = Math.max(maximumOverlap, n); overlapHistogram.set(n, (overlapHistogram.get(n) || 0) + 1); }
    sets.push(members);
  }
  const records = map => [...map.values()].map(({ batches, ...row }) => ({ ...row, batchCount: batches.size })).sort((a, b) => b.count - a.count || String(a.id).localeCompare(String(b.id)));
  return { pairs: records(pairs), quarterbacks: records(qbs), qbGames: records(games), teams: records(teams), injuryAssumptions: records(injuries),
    stackSizes: records(stacks), flex, defenses: records(defenses), projectionSum: projectionsKnown ? projectionSum : null,
    salary: salaryKnown && salaries.length ? { min: Math.min(...salaries), max: Math.max(...salaries), mean: salaries.reduce((a, b) => a + b, 0) / salaries.length, sum: salaries.reduce((a, b) => a + b, 0) } : null,
    overlap: { evaluated: flat.length <= 1000, max: flat.length < 2 ? 0 : flat.length <= 1000 ? maximumOverlap : null,
      histogram: [...overlapHistogram].sort((a, b) => a[0] - b[0]).map(([shared, count]) => ({ shared, count })) } };
}

export function portfolioSupportingLineups(batches, ids, page = 0, size = 5) {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== "string") || ids.length > 9 || !Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(size) || size < 1 || size > 20) fail(C.malformed);
  const matching = portfolioLineups(batches).filter(({ entry }) => ids.every(id => entry.lineup.some(row => idOf(row) === id)));
  return { total: matching.length, rows: matching.slice(page * size, (page + 1) * size).map(({ batch, lineupIndex, entry }) => ({ batchId: batch.id, label: batch.label, lineupIndex, entry })) };
}

/** Recheck every manually selected roster against its complete generated source at export. */
export function validatePortfolioReplacementLineage(batch) {
  const manifest = batch.settings.replacement_manifest;
  if (manifest == null) return null;
  shape(manifest, ["version", "mode", "original_batch_id", "replacements"]);
  if (manifest.version !== 1 || manifest.mode !== "lineup" || typeof manifest.original_batch_id !== "string" || !manifest.original_batch_id || manifest.original_batch_id.length > 100 ||
      !Array.isArray(manifest.replacements) || !manifest.replacements.length || manifest.replacements.length > 150) fail(C.malformed);
  const indices = new Set(), sources = [];
  for (const record of manifest.replacements) {
    shape(record, ["lineup_index", "candidate_lineup_index", "candidate_source"]);
    const source = record.candidate_source;
    shape(source, ["context", "slateName", "lineups", "settings", "salaryCatalog", "salarySnapshot"]);
    if (source.settings?.replacement_manifest != null) fail(C.recursiveSource);
    if (!Number.isSafeInteger(record.lineup_index) || record.lineup_index < 0 || record.lineup_index >= batch.lineups.length || indices.has(record.lineup_index) ||
        !Number.isSafeInteger(record.candidate_lineup_index) || record.candidate_lineup_index < 0 || record.candidate_lineup_index >= (source.lineups?.length || 0)) fail(C.invalidSelection);
    indices.add(record.lineup_index);
    const sourceBatch = createPortfolioBatch(source, batch.label, "replacement-source");
    appendPortfolioBatch([batch], sourceBatch);
    const audit = validateGlobalBuildForExport(sourceBatch);
    if (canonical(source.lineups[record.candidate_lineup_index]) !== canonical(batch.lineups[record.lineup_index])) fail(C.stale);
    sources.push({ lineupIndex: record.lineup_index, candidateLineupIndex: record.candidate_lineup_index,
      sourceSnapshotId: source.settings.build_snapshot?.id ?? null, sourceAudit: audit });
  }
  return { version: 1, originalBatchId: manifest.original_batch_id, replacements: sources };
}

const fingerprint = (batches, source, limits, rules) => canonical({ batches, source, limits, rules });
function preservedCoreErrors(original, replacement) {
  const errors = [], lineups = replacement.lineups;
  for (const [index, entry] of lineups.entries()) for (const id of original.settings.locked_player_ids || [])
    if (!entry.lineup.some(row => idOf(row) === id)) errors.push(C.originalLock(original.salaryCatalog.find(p => idOf(p) === id)?.Player || id, index));
  for (const group of original.settings.group_exposure_limits || []) {
    try {
      const minimum = exposureBoundCount(group.min ?? 0, original.settings.lineup_count ?? original.lineups.length, "min");
      if (!minimum) continue;
      if (!Array.isArray(group.player_ids) || group.player_ids.length < 2 || new Set(group.player_ids).size !== group.player_ids.length) fail(C.coreCheck);
      const actual = lineups.filter(entry => group.player_ids.every(id => entry.lineup.some(row => idOf(row) === id))).length;
      if (actual < minimum) errors.push(C.originalCore(group.id, actual, minimum));
    } catch { errors.push(C.coreCheck); }
  }
  return errors;
}
function deltas(before, after, key = "id") {
  const a = new Map(before.map(row => [row[key], row])), b = new Map(after.map(row => [row[key], row]));
  return [...new Set([...a.keys(), ...b.keys()])].map(id => ({ ...(b.get(id) || a.get(id)), id,
    before: a.get(id)?.count || 0, after: b.get(id)?.count || 0, delta: (b.get(id)?.count || 0) - (a.get(id)?.count || 0) }));
}
export function previewPortfolioReplacement(batches, batchId, currentBuild, limits = {}, rules = null, selection = null) {
  const index = batches.findIndex(batch => batch.id === batchId); if (index < 0) fail(C.missingBatch);
  if (currentBuild?.settings?.replacement_manifest != null) fail(C.recursiveSource);
  const source = Object.fromEntries(["context", "slateName", "lineups", "settings", "salaryCatalog", "salarySnapshot"].map(key => [key, currentBuild?.[key]]));
  const original = batches[index], sourceBatch = createPortfolioBatch(source, original.label, `source:${crypto.randomUUID()}`);
  // Compare with the original even when replacing the only batch.
  appendPortfolioBatch([original], sourceBatch);
  validateGlobalBuildForExport(sourceBatch);
  let candidate = sourceBatch;
  if (selection != null) {
    shape(selection, ["lineupIndex", "candidateIndex"]);
    if (!Number.isSafeInteger(selection.lineupIndex) || selection.lineupIndex < 0 || selection.lineupIndex >= original.lineups.length ||
        !Number.isSafeInteger(selection.candidateIndex) || selection.candidateIndex < 0 || selection.candidateIndex >= sourceBatch.lineups.length) fail(C.invalidSelection);
    const previous = original.settings.replacement_manifest;
    const replacements = [...(previous?.replacements || []).filter(record => record.lineup_index !== selection.lineupIndex),
      { lineup_index: selection.lineupIndex, candidate_lineup_index: selection.candidateIndex, candidate_source: source }].sort((a, b) => a.lineup_index - b.lineup_index);
    const snapshot = { context: original.context, slateName: original.slateName, salaryCatalog: original.salaryCatalog, salarySnapshot: original.salarySnapshot,
      lineups: original.lineups.map((entry, n) => n === selection.lineupIndex ? sourceBatch.lineups[selection.candidateIndex] : entry),
      settings: { ...original.settings, portfolio_selection: null, replacement_manifest: { version: 1, mode: "lineup", original_batch_id: previous?.original_batch_id || original.id, replacements } } };
    candidate = createPortfolioBatch(snapshot, original.label, `replacement:${crypto.randomUUID()}`);
  } else candidate = createPortfolioBatch(source, original.label, `replacement:${crypto.randomUUID()}`);
  const candidateBatches = batches.map((batch, n) => n === index ? candidate : batch);
  const before = auditPortfolio(batches, limits, rules), after = auditPortfolio(candidateBatches, limits, rules);
  const blockers = [...after.errors, ...(after.duplicates.length ? [C.duplicateReplacement] : []), ...preservedCoreErrors(original, candidate)];
  const oldKeys = new Set(portfolioLineups(batches).map(({ entry }) => classicLineupKey(entry))), newKeys = new Set(portfolioLineups(candidateBatches).map(({ entry }) => classicLineupKey(entry)));
  const allPlayerDeltas = deltas(before.players, after.players);
  const rosterChanges = selection ? [{ original: original.lineups[selection.lineupIndex], candidate: candidate.lineups[selection.lineupIndex],
    originalIndex: selection.lineupIndex, candidateIndex: selection.candidateIndex }] : original.lineups.map((entry, n) => ({ original: entry, candidate: candidate.lineups[n] || null, originalIndex: n, candidateIndex: n }))
    .filter(row => !row.candidate || classicLineupKey(row.original) !== classicLineupKey(row.candidate)).slice(0, 5);
  const approvedCores = [];
  for (const group of original.settings.group_exposure_limits || []) {
    try { const min = exposureBoundCount(group.min ?? 0, original.settings.lineup_count ?? original.lineups.length, "min");
      if (min > 0) approvedCores.push({ id: group.id, player_ids: group.player_ids, min }); } catch { /* Already reported as a blocking unverifiable core. */ }
  }
  return freezeSnapshot({ version: 1, batchId, selection, candidateBatchId: candidate.id, candidateBatches, before, after, blockers,
    rosterChanges, approvedLocks: original.settings.locked_player_ids || [], approvedCores,
    canApply: !blockers.length, fingerprint: fingerprint(batches, currentBuild, limits, rules),
    playerDeltas: allPlayerDeltas.filter(row => row.delta), unchangedPlayerCounts: allPlayerDeltas.filter(row => !row.delta).length,
    pairDeltas: deltas(before.structure.pairs, after.structure.pairs).filter(row => row.delta),
    warningsAdded: blockers.filter(error => !before.errors.includes(error) && !(before.duplicates.length && error === C.duplicateReplacement)),
    warningsRemoved: before.errors.filter(error => !after.errors.includes(error)),
    delta: { unchangedLineups: [...oldKeys].filter(key => newKeys.has(key)).length, removedLineups: [...oldKeys].filter(key => !newKeys.has(key)).length,
      addedLineups: [...newKeys].filter(key => !oldKeys.has(key)).length,
      projectionSum: before.structure.projectionSum == null || after.structure.projectionSum == null ? null : after.structure.projectionSum - before.structure.projectionSum,
      salary: before.structure.salary == null || after.structure.salary == null ? null : after.structure.salary.sum - before.structure.salary.sum } });
}
export function applyPortfolioReplacement(preview, batches, currentBuild, limits = {}, rules = null) {
  if (preview?.version !== 1 || preview.fingerprint !== fingerprint(batches, currentBuild, limits, rules)) fail(C.stale);
  const fresh = previewPortfolioReplacement(batches, preview.batchId, currentBuild, limits, rules, preview.selection);
  if (!fresh.canApply) fail(fresh.blockers.join(" "));
  // Preserve the reviewed new ID and exact candidate contents, rather than the recheck's random ID.
  if (canonical(preview.candidateBatches.map(batch => ({ ...batch, id: batch.id === preview.candidateBatchId ? "candidate" : batch.id }))) !==
      canonical(fresh.candidateBatches.map(batch => ({ ...batch, id: batch.id === fresh.candidateBatchId ? "candidate" : batch.id })))) fail(C.stale);
  return preview.candidateBatches;
}
