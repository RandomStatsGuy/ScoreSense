import { contestEvaluationRequest, moneyFraction, validateContestReport } from "./dfsContestResearch.js";
import { sharedRequestBody } from "./dfsSharedOutcomes.js";
import { exposureRequest, groupExposureRequest } from "./dfsGlobalExposure.js";
import { exposureBoundCount } from "./dfsExposureBounds.js";
import { auditClassicStackRules, normalizeClassicStackRules } from "./dfsClassicStackRules.js";
import { stableBuildKey } from "./dfsEntryExportSeal.js";
import { DFS_CONTEST_PORTFOLIO_COPY as C } from "./dfsToolPresentation.js";

export const PORTFOLIO_SELECTION_SEMANTICS = "conditional_supplied_scenario_portfolio_selection_not_forecast_ev";
const object = value => value && typeof value === "object" && !Array.isArray(value);
const finite = value => typeof value === "number" && Number.isFinite(value);
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value) ? Object.fromEntries(Object.entries(value).sort().map(([key, row]) => [key, canonical(row)])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const fail = message => { throw new Error(message); };
const decimal = value => typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/.test(value) && value.length <= 32 && Number(value) >= 0 && Number(value) <= 100;
const goals = new Set(C.goals.map(row => row.id));

/** Projection baselines preserve the scoring goal frozen with the exact pool. */
export function frozenProjectionScores(snapshot) {
  const objective = snapshot.controls?.settings?.objective;
  if (!["median", "floor", "ceiling", "value"].includes(objective) || !Array.isArray(snapshot.controls?.playerInputs)) fail(C.inputsError);
  const byId = new Map(snapshot.controls.playerInputs.map(row => [row[0], row]));
  if (byId.size !== snapshot.pool.length || snapshot.controls.playerInputs.length !== snapshot.pool.length) fail(C.inputsError);
  const playerScores = new Map(snapshot.pool.map(player => {
    const score = byId.get(player.player_id)?.[objective === "floor" ? 2 : objective === "ceiling" ? 3 : 1];
    if (!finite(score)) fail(C.inputsError);
    const value = objective === "value" ? score * 1000 / player.salary : score;
    if (!finite(value) || Math.abs(value) > 1000000) fail(C.inputsError);
    return [player.player_id, value];
  }));
  return Object.fromEntries(snapshot.lineups.map(lineup => {
    if (!Array.isArray(lineup.player_ids) || lineup.player_ids.some(id => !playerScores.has(id))) fail(C.inputsError);
    const total = lineup.player_ids.reduce((sum, id) => sum + playerScores.get(id), 0);
    if (!finite(total) || Math.abs(total) > 1000000) fail(C.inputsError);
    return [lineup.lineup_id, total.toFixed(12).replace(/\.?0+$/, "") || "0"];
  }));
}

function mergeBounds(first, second, count) {
  const result = {};
  for (const kind of ["min", "target", "max"]) {
    const a = first?.[kind] == null ? null : exposureBoundCount(first[kind], count, kind);
    const b = second?.[kind] == null || second[kind] === "" ? null : exposureBoundCount({ count: kind === "target" ? String(second[kind]) :
      kind === "max" ? Math.min(count, Number(second[kind])) : Number(second[kind]) }, count, kind);
    if (a !== null && b !== null && kind === "target" && Math.abs(a - b) > 1e-9) fail(C.collectionError);
    const value = a === null ? b : b === null ? a : kind === "min" ? Math.max(a, b) : kind === "max" ? Math.min(a, b) : a;
    if (value !== null) result[kind] = { count: value };
  }
  if ((result.min?.count ?? 0) > (result.max?.count ?? count)) fail(C.collectionError);
  return result;
}

/** All active bounds come from the immutable snapshot; no builder state is changed. */
export function frozenPortfolioConstraints(snapshot, count) {
  const controls = snapshot.controls || {}, settings = controls.settings || {}, locked = controls.locked || [], excluded = controls.excluded || [];
  const maximum = settings.exposure === 0 ? 1 : settings.exposure ?? 1;
  if (!finite(maximum) || maximum <= 0 || maximum > 1) fail(C.settingsError);
  const global = settings.portfolioMode === "global";
  if ((!global && (Number(settings.qbStack || 0) > 0 || settings.requireQbStack || settings.bringBack)) ||
      Object.values(controls.stackWeights || {}).some(value => Number(value) > 0) ||
      (controls.stackScope?.teams?.length || controls.stackScope?.qbIds?.length)) fail(C.legacyStackError);
  const rules = global ? controls.globalExposure || {} : {};
  const players = exposureRequest(rules, count, locked, excluded, maximum);
  const groups = groupExposureRequest(global ? controls.globalGroups || [] : [], count, locked, excluded, rules, maximum, snapshot.pool);
  if (snapshot.scope === "collection") {
    const collection = controls.portfolioRules;
    if (collection && (collection.version !== 1 || !object(collection.players) || !Array.isArray(collection.groups))) fail(C.collectionError);
    const ids = new Set(snapshot.pool.map(player => player.player_id));
    for (const [id, bound] of Object.entries(collection?.players || {})) {
      if (!ids.has(id)) fail(C.collectionError);
      players[id] = mergeBounds(players[id], bound, count);
    }
    for (const [id, value] of Object.entries(controls.portfolioLimits || {})) {
      if (value == null || value === "") continue;
      if (!ids.has(id) || !Number.isSafeInteger(Number(value)) || Number(value) < 0) fail(C.collectionError);
      players[id] = mergeBounds(players[id], { max: Math.min(count, Number(value)) }, count);
    }
    for (const group of collection?.groups || []) {
      if (!Array.isArray(group.player_ids) || group.player_ids.some(id => !ids.has(id))) fail(C.collectionError);
      const existing = groups.find(row => same([...row.player_ids].sort(), [...group.player_ids].sort()));
      const bounds = mergeBounds(existing, group, count);
      if (existing) Object.assign(existing, bounds);
      else groups.push({ id: group.id, player_ids: [...group.player_ids].sort(), ...bounds });
    }
    if (groups.length > 50 || new Set(groups.map(group => group.id)).size !== groups.length) fail(C.collectionError);
  }
  const differences = Number(settings.differences ?? 0), minSalary = Number(settings.minSalary || 0), maxSalary = Math.min(Number(settings.maxSalary ?? 50000), 50000);
  if (!Number.isSafeInteger(differences) || differences < 0 || differences > 9 || !Number.isSafeInteger(minSalary) || minSalary < 0 ||
      !Number.isSafeInteger(maxSalary) || maxSalary < 1 || minSalary > maxSalary) fail(C.settingsError);
  return { player_exposure_limits: players, group_exposure_limits: groups, locked_player_ids: locked, excluded_player_ids: excluded,
    max_exposure: maximum, max_overlap: 9 - differences,
    classic_stack_rules: global ? normalizeClassicStackRules(controls.classicStackRules, snapshot.pool) : null,
    block_qb_opposing_dst: settings.blockQbDst !== false, max_per_team: Number(settings.maxTeam) || null,
    min_salary: minSalary, max_salary: maxSalary };
}

export async function contestPortfolioRequest(selected, chosen, settings) {
  const { count, scenarioId, objective, seed, draws, topK, riskAlpha, riskWeight } = settings;
  if (!Number.isSafeInteger(count) || count < 1 || count > 150 || count > selected.snapshot.lineups.length ||
      count >= chosen.summary.payout_contract.entrant_count || !chosen.summary.field.scenarios.some(row => row.scenario_id === scenarioId) ||
      !goals.has(objective) || !C.tails.some(row => row.id === riskAlpha) || !decimal(riskWeight)) fail(C.settingsError);
  const request = { ...contestEvaluationRequest(selected, chosen.file.value, chosen.summary, seed, draws, topK),
    projection_scores: frozenProjectionScores(selected.snapshot), count, scenario_id: scenarioId, objective,
    risk_alpha: riskAlpha, risk_weight: riskWeight, ...frozenPortfolioConstraints(selected.snapshot, count) };
  const selection_request_id = (await stableBuildKey(request)).replace(/^build:/, "selection:");
  return { ...request, selection_request_id };
}

const pair = (value, unit = "USD_cents") => {
  moneyFraction({ ...value, unit: "USD_cents" });
  if (unit !== null && value.unit !== unit) fail(C.responseError);
  return [BigInt(value.numerator), BigInt(value.denominator)];
};
const equalPair = (a, b) => a[0] * b[1] === b[0] * a[1];
const equalMoney = (a, b) => equalPair(pair(a), pair(b));
const subtract = (a, b) => [a[0] * b[1] - b[0] * a[1], a[1] * b[1]];
const decimalPair = value => {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!match || String(value).length > 100) fail(C.responseError);
  const scale = (match[3] || "").length - Number(match[4] || 0);
  if (Math.abs(scale) > 30) fail(C.responseError);
  const numerator = BigInt(match[1] + match[2] + (match[3] || ""));
  return scale < 0 ? [numerator * 10n ** BigInt(-scale), 1n] : [numerator, 10n ** BigInt(scale)];
};
const reducePair = ([numerator, denominator]) => {
  let a = numerator < 0n ? -numerator : numerator, b = denominator;
  while (b) [a, b] = [b, a % b];
  return [numerator / a, denominator / a];
};
function targetDeviation(request, rows) {
  let result = [0n, 1n];
  for (const rule of [...Object.entries(request.player_exposure_limits).map(([id, bounds]) => ({ ...bounds, player_ids: [id] })), ...request.group_exposure_limits]) {
    if (rule.target == null) continue;
    const target = object(rule.target) ? decimalPair(rule.target.count) : decimalPair(rule.target);
    if (!object(rule.target)) target[0] *= BigInt(request.count);
    const actual = rows.filter(row => rule.player_ids.every(id => row.player_ids.includes(id))).length;
    const miss = subtract([BigInt(actual), 1n], target); if (miss[0] < 0n) miss[0] = -miss[0];
    result = reducePair([result[0] * miss[1] + miss[0] * result[1], result[1] * miss[1]]);
  }
  return result;
}
const fractionValue = value => {
  const result = pair(value, null);
  if (result[0] < 0n || result[0] > result[1]) fail(C.responseError);
  return moneyFraction({ ...value, unit: "USD_cents" });
};
function validateMetrics(value, request) {
  if (!object(value) || !object(value.net_distribution)) fail(C.responseError);
  const mean = pair(value.mean_net_cents), loss = pair(value.cvar_loss_cents), weight = decimalPair(request.risk_weight);
  if (!equalPair(pair(value.risk_adjusted_net_cents), subtract(mean, [loss[0] * weight[0], loss[1] * weight[1]]))) fail(C.responseError);
  fractionValue(value.top_finish_fraction);
  const expected = request.objective === "conditional_mean_net" ? value.mean_net_cents :
    request.objective === "conditional_risk_adjusted_net" ? value.risk_adjusted_net_cents : value.top_finish_fraction;
  if (request.objective === "conditional_top_finish") {
    if (value.objective_value?.unit !== "sample_fraction" || !equalPair(pair(value.objective_value, "sample_fraction"), pair(expected, null))) fail(C.responseError);
  } else if (!equalMoney(value.objective_value, expected)) fail(C.responseError);
  const distribution = value.net_distribution, ordered = ["min_cents", "p10_cents", "p50_cents", "p90_cents", "max_cents"].map(key => moneyFraction(distribution[key]));
  const average = moneyFraction(distribution.mean_cents);
  if (ordered.some((v, i) => i && v < ordered[i - 1]) || average < ordered[0] - 1e-4 || average > ordered[4] + 1e-4 ||
      !equalMoney(distribution.mean_cents, value.mean_net_cents) || !finite(distribution.replay_standard_error_cents) || distribution.replay_standard_error_cents < 0) fail(C.responseError);
}
function validateSet(ids, request) {
  if (!Array.isArray(ids) || ids.length !== request.count || new Set(ids).size !== ids.length) fail(C.responseError);
  const candidates = new Map(request.lineups.map(row => [row.lineup_id, row]));
  if (ids.some(id => !candidates.has(id))) fail(C.responseError);
  const rows = ids.map(id => candidates.get(id)), sets = rows.map(row => new Set(row.player_ids));
  const pool = new Map(request.pool.map(player => [player.player_id, player]));
  for (const row of rows) {
    const players = row.player_ids.map(id => pool.get(id));
    if (players.some(player => !player)) fail(C.responseError);
    const salary = players.reduce((sum, player) => sum + player.salary, 0), teams = new Map();
    players.forEach(player => teams.set(player.team, (teams.get(player.team) || 0) + 1));
    const qb = players.find(player => player.position === "QB"), dst = players.find(player => player.position === "DST");
    if (salary < request.min_salary || salary > request.max_salary ||
        (request.max_per_team !== null && [...teams.values()].some(count => count > request.max_per_team)) ||
        (request.block_qb_opposing_dst && qb?.opponent === dst?.team)) fail(C.responseError);
    try { auditClassicStackRules(request.classic_stack_rules, { lineup: players.map(player => ({ ...player, slot: player.position })) }, request.pool); }
    catch { fail(C.responseError); }
  }
  const appearance = members => sets.filter(set => members.every(id => set.has(id))).length;
  if (request.locked_player_ids.some(id => appearance([id]) !== request.count) || request.excluded_player_ids.some(id => appearance([id]))) fail(C.responseError);
  for (const player of request.pool) {
    const bound = request.player_exposure_limits[player.player_id] || {}, actual = appearance([player.player_id]);
    const lower = bound.min == null ? 0 : exposureBoundCount(bound.min, request.count, "min");
    const upper = Math.min(bound.max == null ? request.count : exposureBoundCount(bound.max, request.count, "max"),
      exposureBoundCount(request.max_exposure, request.count, "max"));
    if (actual < lower || actual > upper) fail(C.responseError);
  }
  for (const group of request.group_exposure_limits) {
    const actual = appearance(group.player_ids);
    if (actual < (group.min == null ? 0 : exposureBoundCount(group.min, request.count, "min")) ||
        actual > (group.max == null ? request.count : exposureBoundCount(group.max, request.count, "max"))) fail(C.responseError);
  }
  if (request.max_overlap !== null) for (let i = 0; i < sets.length; i++) for (let j = 0; j < i; j++)
    if ([...sets[i]].filter(id => sets[j].has(id)).length > request.max_overlap) fail(C.responseError);
  return rows;
}

/** Reject stale identities, promoted forecasts, partial sets and altered rosters. */
export function validateContestPortfolio(value, request) {
  const v = value, manifest = v?.input_manifest, stream = v?.stream_manifest, solver = v?.solver;
  if (!object(v) || v.schema_version !== "dfs_contest_portfolio_selection_v1" || v.semantics !== PORTFOLIO_SELECTION_SEMANTICS ||
      v.selection_request_id !== request.selection_request_id || v.input_snapshot_id !== request.input_snapshot_id ||
      v.bank_id !== request.bank_id || v.contest_research_id !== request.contest_research_id || !same(v.context, request.context) || !hash(v.manifest) ||
      v.requested_count !== request.count || v.candidate_count !== request.lineups.length || ![true, false].includes(v.complete) ||
      !finite(v.runtime_seconds) || v.runtime_seconds < 0 || !Array.isArray(v.warnings) || v.warnings.length > 64 || v.warnings.some(row => typeof row !== "string" || row.length > 4096) ||
      ["conditional_portfolio_selection", "exact_joint_cash_ties", "common_selection_draws", "separate_final_evaluation_draws"].some(key => v.capabilities?.[key] !== true) ||
      ["ownership_calibrated", "joint_outcomes_calibrated", "expected_payout", "forward_forecast", "platform_settlement_verified", "untouched_evaluation_verified"].some(key => v.capabilities?.[key] !== false) ||
      v.objective?.mode !== request.objective || Number(v.objective.risk_alpha) !== Number(request.risk_alpha) || Number(v.objective.risk_weight) !== Number(request.risk_weight) ||
      v.objective.loss_definition !== "fees minus gross cash payouts" || v.objective.units !== "USD_cents" || v.objective.top_k !== request.top_k || v.objective.scenario_id !== request.scenario_id ||
      v.objective.target_policy !== "minimum absolute appearance miss, then conditional objective" ||
      !object(manifest) || manifest.bank_id !== request.bank_id || manifest.contest_research_id !== request.contest_research_id ||
      manifest.requested_count !== request.count || manifest.scenario_id !== request.scenario_id || manifest.objective !== request.objective ||
      Number(manifest.risk_alpha) !== Number(request.risk_alpha) || Number(manifest.risk_weight) !== Number(request.risk_weight) ||
      manifest.seed !== request.seed || manifest.draw_count !== request.draw_count || manifest.top_k !== request.top_k ||
      !object(stream) || stream.seed !== request.seed || !Number.isSafeInteger(stream.selection_seed) || !Number.isSafeInteger(stream.evaluation_seed) ||
      stream.selection_seed === stream.evaluation_seed || stream.finalist_choice_independence_verified !== false ||
      stream.common_draws_across_candidates !== true || stream.common_evaluation_draws_for_baseline_and_selected !== true ||
      manifest.selection_seed !== stream.selection_seed || manifest.evaluation_seed !== stream.evaluation_seed ||
      !object(solver) || solver.candidate_pool_only !== true || typeof solver.proven_optimal !== "boolean" || solver.baseline_proven_exact !== false ||
      typeof solver.target_optimum_proven_exact !== "boolean" ||
      !Array.isArray(solver.conflicts) || !Array.isArray(v.constraints) || !Array.isArray(v.targets) || !Array.isArray(v.exposure_violations) ||
      !Array.isArray(manifest.candidates) || manifest.candidates.length !== request.lineups.length) fail(C.responseError);
  for (const key of ["player_exposure_limits", "group_exposure_limits", "max_exposure", "max_overlap", "classic_stack_rules", "block_qb_opposing_dst", "max_per_team", "min_salary", "max_salary"])
    if (!same(manifest[key], request[key])) fail(C.responseError);
  for (const key of ["locked_player_ids", "excluded_player_ids"])
    if (!same([...manifest[key]].sort(), [...request[key]].sort())) fail(C.responseError);
  const candidates = new Map(request.lineups.map(row => [row.lineup_id, row]));
  const hasTargets = Object.values(request.player_exposure_limits).some(row => row.target != null) || request.group_exposure_limits.some(row => row.target != null);
  if (new Set(manifest.candidates.map(row => row.lineup_id)).size !== candidates.size || manifest.candidates.some(row => !candidates.has(row.lineup_id) ||
      !same(row.player_ids, [...candidates.get(row.lineup_id).player_ids].sort()) || Number(row.projection_score) !== Number(request.projection_scores[row.lineup_id]))) fail(C.responseError);
  if (!v.complete) {
    if (v.selected_count !== 0 || v.unique_count !== 0 || !same(v.selected_lineup_ids, []) || !same(v.selected_lineups, []) || v.selected !== null || v.baseline !== null ||
        solver.proven_optimal || solver.target_optimum_proven_exact || solver.target_stage_status !== (hasTargets ? "unproven" : "not_applicable") ||
        typeof v.error !== "string" || v.error.length > 4096) fail(C.responseError);
    return v;
  }
  if (v.selected_count !== request.count || v.unique_count !== request.count || v.exposure_violations.length ||
      !same(v.selected_lineup_ids, v.selected?.lineup_ids) || !Array.isArray(v.selected_lineups) || v.selected_lineups.length !== request.count ||
      !["optimal_candidate_pool", "feasible_time_limit", "feasible_heuristic"].includes(solver.status) ||
      solver.proven_optimal !== (solver.status === "optimal_candidate_pool") || stream.independent_joint_payout_check_passed !== true ||
      stream.selection?.purpose !== "selection" || stream.evaluation?.purpose !== "evaluation" ||
      stream.selection.seed !== stream.selection_seed || stream.evaluation.seed !== stream.evaluation_seed ||
      v.comparison?.paired_draws !== true || v.comparison.forecast_improvement_claim !== false) fail(C.responseError);
  for (const purpose of ["selection", "evaluation"]) {
    const frozen = stream[purpose];
    if (!hash(frozen.game_draw_content_id) || !hash(frozen.game_stream_id) || !hash(frozen.field_draw_content_id) ||
        frozen.scenario_id !== request.scenario_id || frozen.full_opponent_count !== request.payout_contract.entrant_count - request.count) fail(C.responseError);
  }
  if (stream.selection.game_stream_id === stream.evaluation.game_stream_id) fail(C.responseError);
  const chosenRows = validateSet(v.selected_lineup_ids, request);
  const deviation = targetDeviation(request, chosenRows), targetProved = hasTargets && (solver.proven_optimal || deviation[0] === 0n);
  if (!equalPair(pair(solver.target_deviation_fraction, "appearances"), deviation) || !equalPair(decimalPair(solver.target_deviation_count), deviation) ||
      solver.target_optimum_proven_exact !== targetProved || solver.target_stage_status !== (targetProved ? "optimal" : hasTargets ? "unproven" : "not_applicable") ||
      (solver.proven_optimal && (solver.method !== "exact_joint_enumeration" || solver.stop_reason !== "exhaustive_complete" ||
        solver.gap !== 0 || solver.bound_scope !== "maximum conditional objective among hard-feasible sets achieving the minimum exact total target miss on frozen selection draws" ||
        !equalPair(pair(solver.bound, request.objective === "conditional_top_finish" ? "sample_fraction" : "USD_cents"), pair(v.selected.selection_metrics.objective_value, request.objective === "conditional_top_finish" ? "sample_fraction" : "USD_cents")))) ||
      (!solver.proven_optimal && (solver.bound !== null || solver.gap !== null))) fail(C.responseError);
  if (v.selected_lineups.some((row, index) => row.lineup_id !== chosenRows[index].lineup_id || !same([...row.player_ids].sort(), [...chosenRows[index].player_ids].sort()))) fail(C.responseError);
  for (const portfolio of [v.selected, v.baseline]) {
    const rows = validateSet(portfolio.lineup_ids, request);
    validateMetrics(portfolio.selection_metrics, request); validateMetrics(portfolio.evaluation_metrics, request);
    const expectedProjection = rows.reduce((sum, row) => sum + Number(request.projection_scores[row.lineup_id]), 0);
    if (!Number.isFinite(Number(portfolio.projection_sum)) || Math.abs(Number(portfolio.projection_sum) - expectedProjection) > 1e-8) fail(C.responseError);
    const evaluation = portfolio.evaluation;
    if (evaluation.input_snapshot_id !== undefined && evaluation.input_snapshot_id !== request.input_snapshot_id) fail(C.responseError);
    validateContestReport({ ...evaluation, input_snapshot_id: request.input_snapshot_id }, { ...request, lineups: rows, seed: stream.evaluation_seed });
    const assumption = evaluation.assumptions.find(row => row.scenario_id === request.scenario_id);
    if (!same(assumption.net, portfolio.evaluation_metrics.net_distribution) ||
        evaluation.stream_manifest.game_draw_content_id !== stream.evaluation.game_draw_content_id ||
        evaluation.stream_manifest.game_stream_id !== stream.evaluation.game_stream_id || assumption.field_draw_content_id !== stream.evaluation.field_draw_content_id ||
        Math.abs(assumption.sampled_finish_fractions.top_k - fractionValue(portfolio.evaluation_metrics.top_finish_fraction)) > 1e-6) fail(C.responseError);
  }
  if (v.selected.evaluation.stream_manifest.game_draw_content_id !== v.baseline.evaluation.stream_manifest.game_draw_content_id ||
      !equalPair(pair(v.comparison.evaluation_mean_net_difference_cents), subtract(pair(v.selected.evaluation_metrics.mean_net_cents), pair(v.baseline.evaluation_metrics.mean_net_cents))) ||
      !equalPair(pair(v.comparison.selection_mean_net_difference_cents), subtract(pair(v.selected.selection_metrics.mean_net_cents), pair(v.baseline.selection_metrics.mean_net_cents)))) fail(C.responseError);
  return v;
}

/** Personal exports include derived rosters and receipts, never raw supplied banks. */
export function portableContestPortfolio(review) {
  return { schema_version: "scoresense_conditional_portfolio_proposal_v1", semantics: PORTFOLIO_SELECTION_SEMANTICS,
    snapshot: review.snapshot, assumptions: review.preview, report: review.report, archive_scope: C.archiveScope };
}

export function runContestPortfolioTask(operation, payload, signal) {
  if (typeof Worker === "undefined") return Promise.reject(new Error(C.workerError));
  return new Promise((resolve, reject) => {
    let worker, done = false;
    const finish = (error, value) => { if (done) return; done = true; signal?.removeEventListener("abort", abort); worker?.terminate(); error ? reject(error) : resolve(value); };
    const abort = () => finish(Object.assign(new Error(C.cancelled), { name: "AbortError" }));
    if (signal?.aborted) return abort(); signal?.addEventListener("abort", abort, { once: true });
    try {
      worker = new Worker(new URL("./dfsContestPortfolio.worker.js", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }) => data?.ok ? finish(null, data.value) : finish(new Error(data?.error || C.failed));
      worker.onerror = event => { event.preventDefault?.(); finish(new Error(C.workerError)); };
      worker.onmessageerror = () => finish(new Error(C.workerError)); worker.postMessage({ operation, ...payload });
    } catch { finish(new Error(C.workerError)); }
  });
}
export { sharedRequestBody };
