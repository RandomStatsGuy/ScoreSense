import { evidenceContext } from "./dfsEvidence.js";
import { freezeSnapshot } from "./dfsPortfolio.js";
import { stableBuildKey } from "./dfsEntryExportSeal.js";
import { normalizeDfsTeam, DFS_SHARED_OUTCOMES_COPY as C } from "./dfsToolPresentation.js";

export const SHARED_MAX_BYTES = 8 * 1024 * 1024;
export const SHARED_SEMANTICS = "empirical_declared_scenario_scores_not_calibrated_forecasts_or_payouts";
export const SHARED_SCORING_VERSION = "draftkings_nfl_classic_2026-10-12_v1";
const encoder = new TextEncoder();
const object = v => v && typeof v === "object" && !Array.isArray(v);
const id = v => typeof v === "string" && v.length > 0 && v.length <= 100 && v === v.trim() && !/[\x00-\x1f\x7f]/.test(v);
const sameContext = (a, b) => Boolean(a && b && Object.keys(a).every(k => a[k] === b[k]));
const finite = v => typeof v === "number" && Number.isFinite(v);
const textValue = (v, maximum = 4096) => typeof v === "string" && v.length <= maximum;
const warnings = v => Array.isArray(v) && v.length <= 64 && v.every(row => textValue(row));
function zonedTimestamp(value) {
  if (typeof value !== "string") return NaN;
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.\d+)?)?(Z|[+-](\d\d):(\d\d))$/.exec(value);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12 || Number(match[3]) < 1 ||
      Number(match[3]) > new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate() ||
      Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6] || 0) > 59 || Number(match[8] || 0) > 23 || Number(match[9] || 0) > 59) return NaN;
  return Date.parse(value);
}

/** Bounded JSON parsing also rejects duplicate fields before rights are read. */
export function parseScenarioJson(text) {
  if (typeof text !== "string" || encoder.encode(text).length > SHARED_MAX_BYTES) throw new Error(C.sizeError);
  let at = 0, nodes = 0;
  const whitespace = () => { while (/[ \t\r\n]/.test(text[at] || "") && at < text.length) at++; };
  const fail = () => { throw new Error(C.jsonError); };
  const string = () => {
    const start = at++;
    while (at < text.length) {
      if (text[at] === "\\") { at += 2; continue; }
      if (text[at++] === '"') { try { return JSON.parse(text.slice(start, at)); } catch { fail(); } }
    }
    fail();
  };
  const value = depth => {
    if (depth > 24 || ++nodes > 250000) throw new Error(C.structureError);
    whitespace();
    if (text[at] === '"') return string();
    if (text[at] === "{" || text[at] === "[") {
      const array = text[at++] === "[", result = array ? [] : Object.create(null), keys = new Set(), end = array ? "]" : "}";
      whitespace(); if (text[at] === end) { at++; return result; }
      while (at < text.length) {
        let key;
        if (!array) {
          whitespace(); if (text[at] !== '"') fail(); key = string(); whitespace();
          if (keys.has(key) || ["__proto__", "constructor", "prototype"].includes(key)) throw new Error(C.duplicateError);
          keys.add(key); if (text[at++] !== ":") fail();
        }
        const child = value(depth + 1); if (array) result.push(child); else result[key] = child;
        whitespace(); const separator = text[at++]; if (separator === end) return result; if (separator !== ",") fail();
      }
      fail();
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(at));
    if (!match) fail(); at += match[0].length;
    const result = JSON.parse(match[0]); if (typeof result === "number" && !Number.isFinite(result)) fail(); return result;
  };
  const result = value(0); whitespace(); if (at !== text.length || !object(result)) fail();
  return result;
}

/** Local admission happens before any source observations leave the browser. */
export function checkScenarioAdmission(bank, inputs) {
  if (!object(bank) || bank.schema_version !== "dfs_shared_outcomes_bank_v1" || bank.mode !== "declared_empirical_scenarios") throw new Error(C.schemaError);
  if (!sameContext(inputs.context, bank.context)) throw new Error(C.contextError);
  if (!Array.isArray(bank.sources) || !bank.sources.length || bank.sources.length > 64 || bank.sources.some(source => !object(source) ||
      ["personal_analysis", "hosted_ingestion", "display"].some(key => source.rights?.[key] !== true))) throw new Error(C.rightsError);
  if (!Array.isArray(bank.games) || !bank.games.length || bank.games.length > 16) throw new Error(C.gameError);
  const games = new Map(inputs.games.map(g => [g.game_id, g]));
  const seen = new Set();
  for (const game of bank.games) {
    if (!object(game)) throw new Error(C.gameError);
    const exact = games.get(game.game_id);
    if (!exact || seen.has(game.game_id) || normalizeDfsTeam(game.home_team) !== exact.home || normalizeDfsTeam(game.away_team) !== exact.away ||
        !Number.isFinite(zonedTimestamp(game.kickoff_at)) || zonedTimestamp(game.kickoff_at) !== zonedTimestamp(exact.kickoff_at)) throw new Error(C.gameError);
    seen.add(game.game_id);
  }
  if (inputs.pool.some(p => !seen.has(p.game_id))) throw new Error(C.coverageError);
  return bank;
}

function rosterRows(entries, pool, prefix) {
  const byId = new Map(pool.map(p => [p.player_id, p])), seen = new Set();
  return entries.map((entry, index) => {
    const rows = entry?.lineup;
    if (!Array.isArray(rows) || rows.length !== 9) throw new Error(C.rosterError);
    const ids = rows.map(row => row.player_id);
    if (ids.some(pid => !id(pid) || !byId.has(pid)) || new Set(ids).size !== 9) throw new Error(C.rosterError);
    const positions = {}, games = new Set(); let salary = 0;
    for (const row of rows) {
      const p = byId.get(row.player_id);
      if ((row.team != null && normalizeDfsTeam(row.team) !== p.team) || (row.position != null && row.position !== p.position)) throw new Error(C.rosterError);
      positions[p.position] = (positions[p.position] || 0) + 1; games.add(p.game_id); salary += p.salary;
    }
    if (positions.QB !== 1 || positions.DST !== 1 || !(positions.RB >= 2 && positions.WR >= 3 && positions.TE >= 1) || games.size < 2 || salary > 50000) throw new Error(C.rosterError);
    const key = [...ids].sort().join("\u0000"); if (seen.has(key)) throw new Error(C.duplicateLineups); seen.add(key);
    return { lineup_id: `${prefix}:${index}`, player_ids: ids };
  });
}

export function sharedOutcomeInputs(b, scope = "build") {
  const context = evidenceContext(b);
  if (!context || !id(context.slate_id)) throw new Error(C.slateError);
  if (!["build", "collection"].includes(scope)) throw new Error(C.scopeError);
  const providerGames = new Map();
  for (const g of b.vegasGames || []) {
    if (!id(g.game_id) || providerGames.has(g.game_id)) throw new Error(C.gameError);
    providerGames.set(g.game_id, g);
  }
  const seen = new Set(), games = new Map();
  const pool = (b.pool || []).map(p => {
    if (!id(p.player_id) || seen.has(p.player_id)) throw new Error(C.identityError); seen.add(p.player_id);
    const game = providerGames.get(p.game_id), team = normalizeDfsTeam(p.Team), opponent = normalizeDfsTeam(p.Opponent);
    const kickoff = game?.kickoff_at || game?.kickoff_et;
    if (!game || !id(p.game_id) || !Number.isFinite(zonedTimestamp(kickoff)) ||
        ![normalizeDfsTeam(game.home), normalizeDfsTeam(game.away)].includes(team) ||
        ![normalizeDfsTeam(game.home), normalizeDfsTeam(game.away)].includes(opponent) || team === opponent) throw new Error(C.gameError);
    if (!Number.isSafeInteger(Number(p.salary)) || typeof p.salary === "boolean" || Number(p.salary) <= 0 || Number(p.salary) > 50000 ||
        !["QB", "RB", "WR", "TE", "DST"].includes(p.Position)) throw new Error(C.poolError);
    games.set(game.game_id, { game_id: game.game_id, home: normalizeDfsTeam(game.home), away: normalizeDfsTeam(game.away), kickoff_at: kickoff });
    return { player_id: p.player_id, game_id: p.game_id, team, opponent, position: p.Position, salary: Number(p.salary) };
  }).sort((a, b) => a.player_id.localeCompare(b.player_id));
  if (pool.length < 9 || pool.length > 750) throw new Error(C.poolError);
  let lineups, labels;
  if (scope === "build") {
    if (b.currentBuild?.context && !sameContext(context, evidenceContext({ context: b.currentBuild.context, buildPlanValidation: { salarySnapshot: b.currentBuild.salarySnapshot } }))) throw new Error(C.collectionContextError);
    lineups = rosterRows(b.lineups || [], pool, "current"); labels = lineups.map((_, i) => C.lineupLabel(i + 1));
  } else {
    const batches = b.portfolio || [];
    for (const batch of batches) if (!sameContext(context, evidenceContext({ context: batch.context, buildPlanValidation: { salarySnapshot: batch.salarySnapshot } }))) throw new Error(C.collectionContextError);
    const entries = batches.flatMap(batch => batch.lineups || []);
    lineups = rosterRows(entries, pool, "collection"); labels = batches.flatMap(batch => (batch.lineups || []).map((_, i) => `${batch.label} · ${C.lineupLabel(i + 1)}`));
  }
  if (lineups.length > 150) throw new Error(C.lineupLimit);
  return { context, pool, games: [...games.values()].sort((a, b) => a.game_id.localeCompare(b.game_id)), lineups, labels, scope,
    player_labels: Object.fromEntries((b.pool || []).map(p => [p.player_id, typeof p.Player === "string" ? p.Player : p.player_id])),
    controls: { settings: b.settings || {}, locked: b.locked || [], excluded: b.excluded || [], stackWeights: b.stackWeights || {},
      stackScope: b.stackScope || {}, classicStackRules: b.classicStackRules || null, globalExposure: b.globalExposure || {}, globalGroups: b.globalGroups || [],
      portfolioRules: b.portfolioRules || null, portfolioLimits: b.portfolioLimits || {},
      playerInputs: (b.pool || []).map(p => [p.player_id, p["Projected Points"], p["Low (P10)"], p["High (P90)"], p["Injury Status"] || "", p.projection_source || ""]) } };
}

export function validateScenarioPreview(value, inputs) {
  if (!object(value) || !/^[a-f0-9]{64}$/.test(value.content_id || "") || !sameContext(inputs.context, value.context) ||
      value.semantics !== SHARED_SEMANTICS || value.scoring_version !== SHARED_SCORING_VERSION || value.counts?.pool_players !== inputs.pool.length ||
      value.counts?.games !== inputs.games.length || !Number.isSafeInteger(value.counts?.profiles) || value.counts.profiles < inputs.games.length ||
      value.capabilities?.coherent_event_scoring !== true || value.capabilities?.expected_payout !== false || value.capabilities?.calibrated_marginals !== false || value.capabilities?.calibrated_joint_tail !== false || value.capabilities?.forward_forecast !== false ||
      !textValue(value.evidence_scope, 40) || !Number.isFinite(zonedTimestamp(value.decision_at)) || !warnings(value.warnings) ||
      !Array.isArray(value.sources) || !value.sources.length || value.sources.length > 64 || value.sources.some(source => !object(source) ||
        !textValue(source.source_id, 120) || !textValue(source.provider, 500) || !textValue(source.uri) || !/^[a-f0-9]{64}$/.test(source.content_sha256 || "") || !object(source.rights)) ||
      value.sources.some(source => [source.published_at, source.known_at, source.retrieved_at].some(time => time != null && !Number.isFinite(zonedTimestamp(time)))) ||
      !object(value.scoring_source) || !textValue(value.scoring_source.provider, 500) || !textValue(value.scoring_source.uri) ||
      !/^[a-f0-9]{64}$/.test(value.scoring_source.response_sha256 || ""))
    throw new Error(C.responseError);
  return value;
}

export async function selectScenarioSnapshot(inputs, preview, now = new Date().toISOString()) {
  validateScenarioPreview(preview, inputs);
  const snapshot = { ...inputs, bank_id: preview.content_id, selected_at: now };
  return freezeSnapshot({ ...snapshot, input_snapshot_id: (await stableBuildKey(snapshot)).replace(/^build:/, "scenario:") });
}

export function sharedEvaluationRequest(snapshot, bank, seed = 0, drawCount = 256) {
  if (!snapshot?.lineups.length) throw new Error(C.buildFirst);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 2 ** 31 - 1 || ![32, 64, 128, 256, 512, 1024].includes(drawCount)) throw new Error(C.settingsError);
  return { context: snapshot.context, pool: snapshot.pool, bank, lineups: snapshot.lineups,
    input_snapshot_id: snapshot.input_snapshot_id, bank_id: snapshot.bank_id, seed, draw_count: drawCount };
}

export function validateSharedReport(report, request) {
  const streams = report?.stream_manifest?.streams, streamValues = streams && [streams.generation, streams.selection, streams.evaluation];
  const scores = row => object(row) && [row.mean, row.p10, row.p50, row.p90, row.min, row.max, row.zero_fraction, row.negative_fraction].every(finite) &&
    row.min <= row.p10 && row.p10 <= row.p50 && row.p50 <= row.p90 && row.p90 <= row.max && row.mean >= row.min - 1e-10 && row.mean <= row.max + 1e-10 &&
    row.zero_fraction >= 0 && row.zero_fraction <= 1 && row.negative_fraction >= 0 && row.negative_fraction <= 1 && row.zero_fraction + row.negative_fraction <= 1 + 1e-12;
  if (!object(report) || report.input_snapshot_id !== request.input_snapshot_id || report.bank_id !== request.bank_id ||
      !sameContext(request.context, report.context) || report.semantics !== SHARED_SEMANTICS || report.draw_count !== request.draw_count ||
      report.scoring_version !== SHARED_SCORING_VERSION || report.capabilities?.expected_payout !== false || report.capabilities?.calibrated_marginals !== false || report.capabilities?.calibrated_joint_tail !== false || report.capabilities?.forward_forecast !== false ||
      report.stream_manifest?.selected_purpose !== "evaluation" || report.stream_manifest?.seed !== request.seed ||
      report.stream_manifest?.common_draws_across_lineups !== true || !streamValues || streamValues.some(v => !/^[a-f0-9]{64}$/.test(v)) || new Set(streamValues).size !== 3 ||
      !/^[a-f0-9]{64}$/.test(report.stream_manifest?.draw_content_id || "") || !finite(report.runtime_seconds) || report.runtime_seconds < 0 ||
      !warnings(report.warnings) ||
      report.audit?.conservation_passed !== true || report.audit?.all_profile_audits_passed !== true || report.audit?.all_actor_scores_derive_from_shared_events !== true ||
      report.audit?.pool_players_covered !== request.pool.length || report.audit?.lineups_evaluated !== request.lineups.length ||
      report.audit?.game_draws !== request.bank.games.length * request.draw_count ||
      !Array.isArray(report.lineups) || report.lineups.length !== request.lineups.length ||
      !Array.isArray(report.players) || report.players.length !== request.pool.length) throw new Error(C.responseError);
  const expected = new Map(request.lineups.map(row => [row.lineup_id, [...row.player_ids].sort().join("\u0000")])), seen = new Set();
  for (const row of report.lineups) {
    if (!object(row) || seen.has(row.lineup_id) || !Array.isArray(row.player_ids) || expected.get(row.lineup_id) !== [...row.player_ids].sort().join("\u0000") ||
        !scores(row) || !finite(row.paired_delta_mean_vs_first) || !finite(row.paired_delta_p10_vs_first) ||
        !finite(row.paired_better_fraction_vs_first) || row.paired_better_fraction_vs_first < 0 || row.paired_better_fraction_vs_first > 1)
      throw new Error(C.responseError);
    seen.add(row.lineup_id);
  }
  if (report.players.some(p => !object(p))) throw new Error(C.responseError);
  const playerIds = report.players.map(p => p.player_id);
  if (new Set(playerIds).size !== request.pool.length || request.pool.some(p => !playerIds.includes(p.player_id)) || report.players.some(p => !scores(p))) throw new Error(C.responseError);
  return report;
}

export function sharedRequestBody(request) {
  const json = JSON.stringify(request, (_key, v) => { if (typeof v === "number" && !Number.isFinite(v)) throw new Error(C.jsonError); return v; });
  if (encoder.encode(json).length > SHARED_MAX_BYTES) throw new Error(C.sizeError);
  return json;
}

export function portableSharedReview(snapshot, preview, report) {
  return { schema_version: "scoresense_shared_scenario_review_v1", semantics: SHARED_SEMANTICS,
    snapshot, scenario_reference: { content_id: preview.content_id, context: preview.context, scoring_version: preview.scoring_version,
      scoring_source: preview.scoring_source, evidence_scope: preview.evidence_scope,
      sources: (preview.sources || []).map(s => ({ source_id: s.source_id, provider: s.provider, uri: s.uri, content_sha256: s.content_sha256,
        period: s.period, published_at: s.published_at, known_at: s.known_at, retrieved_at: s.retrieved_at, rights: s.rights })) },
    report, archive_scope: "Personal-analysis report and source receipts; raw event banks and source observations omitted." };
}

export function runSharedOutcomeTask(operation, payload, signal) {
  if (typeof Worker === "undefined") return Promise.reject(new Error(C.workerError));
  return new Promise((resolve, reject) => {
    let worker, done = false;
    const finish = (error, value) => { if (done) return; done = true; signal?.removeEventListener("abort", abort); worker?.terminate(); error ? reject(error) : resolve(value); };
    const abort = () => finish(Object.assign(new Error(C.cancelled), { name: "AbortError" }));
    if (signal?.aborted) return abort(); signal?.addEventListener("abort", abort, { once: true });
    try {
      worker = new Worker(new URL("./dfsSharedOutcomes.worker.js", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }) => data?.ok ? finish(null, data.value) : finish(new Error(data?.error || C.jsonError));
      worker.onerror = event => { event.preventDefault?.(); finish(new Error(C.workerError)); };
      worker.onmessageerror = () => finish(new Error(C.workerError)); worker.postMessage({ operation, ...payload });
    } catch { finish(new Error(C.workerError)); }
  });
}
