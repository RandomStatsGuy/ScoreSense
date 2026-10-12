import { parseScenarioJson, sharedRequestBody } from "./dfsSharedOutcomes.js";
import { DFS_CONTEST_COPY as C } from "./dfsToolPresentation.js";

export const CONTEST_SEMANTICS = "conditional_supplied_field_and_game_replay_not_forecast_ev";
const object = v => v && typeof v === "object" && !Array.isArray(v);
const hash = v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const text = v => typeof v === "string" && v.length > 0 && v.length <= 4096;
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value) ? Object.fromEntries(Object.entries(value).sort().map(([k, v]) => [k, canonical(v)])) : value;
const same = (a, b) => object(a) && object(b) && JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const normalizePayout = a => ({ ...a, tie_policy: { ...a?.tie_policy, source: { ...a?.tie_policy?.source,
  content_sha256: a?.tie_policy?.source?.content_sha256?.toLowerCase(), as_of: Date.parse(a?.tie_policy?.source?.as_of) } } });
const payoutSame = (a, b) => same(normalizePayout(a), normalizePayout(b));
const finite = v => typeof v === "number" && Number.isFinite(v);
const warnings = v => Array.isArray(v) && v.length <= 64 && v.every(text);
const capabilities = v => v?.expected_payout === false && v?.forward_forecast === false &&
  v?.ownership_calibrated === false && v?.joint_outcomes_calibrated === false && v?.platform_settlement_verified === false &&
  v?.exact_conditional_cash_ties === true && v?.legal_declared_field === true;
export function moneyFraction(value) {
  if (!object(value) || value.unit !== "USD_cents" || !/^-?\d{1,8192}$/.test(value.numerator) || !/^[1-9]\d{0,8191}$/.test(value.denominator)) throw new Error(C.responseError);
  // Draw means can have long exact denominators. Scale as integers before the
  // display-only conversion, avoiding Infinity/Infinity or lost JSON integers.
  const result = Number(BigInt(value.numerator) * 1000000n / BigInt(value.denominator)) / 1000000;
  if (!finite(result) || Math.abs(result) > 1e15) throw new Error(C.responseError);
  return result;
}
function distribution(v) {
  if (!object(v)) throw new Error(C.responseError);
  const values = [v.min_cents, v.p10_cents, v.p50_cents, v.p90_cents, v.max_cents].map(moneyFraction);
  const mean = moneyFraction(v.mean_cents);
  if (values.some((n, i) => i && n < values[i - 1]) || mean < values[0] - .0001 || mean > values[4] + .0001 || !finite(v.replay_standard_error_cents) || v.replay_standard_error_cents < 0) throw new Error(C.responseError);
}
export function checkContestAdmission(value, selected) {
  const field = value?.contest_field, payout = value?.payout_contract;
  if (!object(value) || Object.keys(value).some(k => !["contest_field", "payout_contract"].includes(k)) ||
      !object(field) || !object(payout) || field.schema_version !== "dfs_contest_field_v1" ||
      field.mode !== "declared_legal_lineup_templates" || payout.schema_version !== "dfs_cash_payout_contract_v1" ||
      !same(field.context, selected.snapshot.context) || field.decision_at !== selected.summary.decision_at ||
      field.contest?.contest_id !== payout.contest_id || field.contest?.entrant_count !== payout.entrant_count ||
      !Number.isSafeInteger(payout.entrant_count) || payout.entrant_count <= selected.snapshot.lineups.length || payout.entrant_count > 100000 ||
      !Array.isArray(field.scenarios) || !field.scenarios.length || field.scenarios.length > 4 ||
      !Array.isArray(field.sources) || !field.sources.length || field.sources.length > 64) throw new Error(C.fileError);
  if (field.sources.some(s => !object(s) || ["personal_analysis", "hosted_ingestion", "display"].some(k => s.rights?.[k] !== true))) throw new Error(C.rightsError);
  return value;
}
export function readContestFile(raw, selected) { return checkContestAdmission(parseScenarioJson(raw), selected); }
export function contestPreviewRequest(selected, value) {
  checkContestAdmission(value, selected);
  return { context: selected.snapshot.context, pool: selected.snapshot.pool, bank: selected.bank, ...value };
}
export function validateContestPreview(v, selected, file) {
  const scenarios = new Map(file.contest_field.scenarios.map(s => [s.scenario_id, s]));
  const sources = new Map(file.contest_field.sources.map(s => [s.source_id, s]));
  if (!object(v) || v.schema_version !== "dfs_contest_research_preview_v1" || !hash(v.content_id) ||
      v.bank_id !== selected.snapshot.bank_id || v.semantics !== CONTEST_SEMANTICS || !capabilities(v.capabilities) || !warnings(v.warnings) ||
      !hash(v.field?.content_id) || !same(v.field.context, selected.snapshot.context) || !same(v.field.contest, file.contest_field.contest) ||
      !payoutSame(v.payout_contract, file.payout_contract) || !Array.isArray(v.field.scenarios) || v.field.scenarios.length !== file.contest_field.scenarios.length ||
      new Set(v.field.scenarios.map(s => s.scenario_id)).size !== scenarios.size ||
      v.field.scenarios.some(s => !scenarios.has(s.scenario_id) || s.provider !== scenarios.get(s.scenario_id).provider || s.injury_assumption !== scenarios.get(s.scenario_id).injury_assumption ||
        !Number.isSafeInteger(s.unique_template_count) || s.unique_template_count < 1 || s.unique_template_count > 500 ||
        !Number.isSafeInteger(s.ownership_consistency?.known_players) || s.ownership_consistency.known_players < 0 ||
        (s.ownership_consistency.mean_absolute_fraction_gap !== null && (!finite(s.ownership_consistency.mean_absolute_fraction_gap) || s.ownership_consistency.mean_absolute_fraction_gap < 0 || s.ownership_consistency.mean_absolute_fraction_gap > 1))) ||
      !Array.isArray(v.field.sources) || v.field.sources.length !== sources.size || new Set(v.field.sources.map(s => s.source_id)).size !== sources.size ||
      v.field.sources.some(s => !sources.has(s.source_id) || s.uri !== sources.get(s.source_id).uri || s.content_sha256 !== sources.get(s.source_id).content_sha256 || !same(s.rights, sources.get(s.source_id).rights))) throw new Error(C.responseError);
  return v;
}
export function contestEvaluationRequest(selected, value, preview, seed, drawCount, topK) {
  validateContestPreview(preview, selected, value);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 2147483647 || ![32, 64, 128, 256].includes(drawCount) ||
      !Number.isSafeInteger(topK) || topK < 1 || topK > value.payout_contract.entrant_count) throw new Error(C.settingsError);
  return { ...contestPreviewRequest(selected, value), lineups: selected.snapshot.lineups,
    input_snapshot_id: selected.snapshot.input_snapshot_id, bank_id: selected.snapshot.bank_id,
    contest_research_id: preview.content_id, seed, draw_count: drawCount, top_k: topK };
}
export function validateContestReport(v, request) {
  const scenarios = new Map(request.contest_field.scenarios.map(s => [s.scenario_id, s])), ids = [...scenarios.keys()], lineups = request.lineups.map(l => l.lineup_id);
  if (!object(v) || v.schema_version !== "dfs_contest_research_review_v1" || v.semantics !== CONTEST_SEMANTICS ||
      v.bank_id !== request.bank_id || v.contest_research_id !== request.contest_research_id || v.input_snapshot_id !== request.input_snapshot_id ||
      !same(v.context, request.context) || !same(v.contest, request.contest_field.contest) || !capabilities(v.capabilities) || !warnings(v.warnings) ||
      v.draw_count !== request.draw_count || v.top_k !== request.top_k || v.own_entry_count !== lineups.length ||
      v.opponent_entry_count !== request.payout_contract.entrant_count - lineups.length ||
      v.stream_manifest?.purpose !== "evaluation" || v.stream_manifest.seed !== request.seed || !hash(v.stream_manifest.game_stream_id) ||
      !hash(v.stream_manifest.game_draw_content_id) || v.stream_manifest.common_game_draws_across_assumptions !== true || v.stream_manifest.full_opponent_count !== true ||
      !finite(v.runtime_seconds) || v.runtime_seconds < 0 || !Array.isArray(v.assumptions) || v.assumptions.length !== ids.length) throw new Error(C.responseError);
  if (new Set(v.assumptions.map(row => row.scenario_id)).size !== ids.length) throw new Error(C.responseError);
  v.assumptions.forEach(row => {
    const expected = scenarios.get(row.scenario_id);
    if (!expected || row.provider !== expected.provider || row.injury_assumption !== expected.injury_assumption ||
        !hash(row.field_draw_content_id) || !object(row.sampled_finish_fractions) ||
        ["first_place_finish", "first_place_tie", "sole_first", "top_k", "cash", "net_positive"].some(k => !finite(row.sampled_finish_fractions[k]) || row.sampled_finish_fractions[k] < 0 || row.sampled_finish_fractions[k] > 1) ||
        !Array.isArray(row.lineups) || row.lineups.length !== lineups.length || row.lineups.some((l, j) => l.lineup_id !== lineups[j])) throw new Error(C.responseError);
    distribution(row.gross); distribution(row.net);
    if (moneyFraction(row.fees_cents) !== request.payout_contract.entry_fee_cents * lineups.length) throw new Error(C.responseError);
    const gross = row.gross.mean_cents, net = row.net.mean_cents, fees = BigInt(request.payout_contract.entry_fee_cents * lineups.length);
    if (BigInt(gross.numerator) * BigInt(net.denominator) !==
        (BigInt(net.numerator) + fees * BigInt(net.denominator)) * BigInt(gross.denominator)) throw new Error(C.responseError);
    row.lineups.forEach(l => distribution(l.net));
  });
  return v;
}
export function portableContestReview(review) {
  return { schema_version: "scoresense_conditional_contest_review_v1", semantics: CONTEST_SEMANTICS,
    snapshot: review.snapshot, assumptions: review.preview, report: review.report,
    archive_scope: "Personal analysis only. Raw opponent templates, player ownership observations and game events omitted. Source rights remain as declared." };
}
export function runContestTask(operation, payload, signal) {
  if (typeof Worker === "undefined") return Promise.reject(new Error(C.workerError));
  return new Promise((resolve, reject) => {
    let worker, done = false;
    const finish = (err, value) => { if (done) return; done = true; signal?.removeEventListener("abort", abort); worker?.terminate(); err ? reject(err) : resolve(value); };
    const abort = () => finish(Object.assign(new Error(C.cancelled), { name: "AbortError" }));
    if (signal?.aborted) return abort(); signal?.addEventListener("abort", abort, { once: true });
    try {
      worker = new Worker(new URL("./dfsContestResearch.worker.js", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }) => data?.ok ? finish(null, data.value) : finish(new Error(data?.error || C.fileError));
      worker.onerror = event => { event.preventDefault?.(); finish(new Error(C.workerError)); };
      worker.onmessageerror = () => finish(new Error(C.workerError)); worker.postMessage({ operation, ...payload });
    } catch { finish(new Error(C.workerError)); }
  });
}
export { sharedRequestBody };
