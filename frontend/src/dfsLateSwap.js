import { parseScenarioJson, sharedRequestBody, SHARED_MAX_BYTES } from "./dfsSharedOutcomes.js";
import { stableBuildKey } from "./dfsEntryExportSeal.js";
import { freezeSnapshot } from "./dfsPortfolio.js";
import { exposureBoundCount } from "./dfsExposureBounds.js";
import { auditClassicStackRules } from "./dfsClassicStackRules.js";
import { DFS_LATE_SWAP_COPY as C, normalizeDfsTeam } from "./dfsToolPresentation.js";

export const LATE_SWAP_SCHEMA = "dfs_late_swap_package_v1";
export const LATE_SWAP_SEMANTICS = "offline_declared_exact_slot_projection_planning_not_live_late_swap";
export const LATE_SWAP_SLOTS = Object.freeze(["QB", "RB1", "RB2", "WR1", "WR2", "WR3", "TE", "FLEX", "DST"]);
const object = value => value && typeof value === "object" && !Array.isArray(value);
const exactId = value => typeof value === "string" && value.length > 0 && value.length <= 100 && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const declaredHash = value => typeof value === "string" && /^[a-fA-F0-9]{64}$/.test(value);
const same = (first, second) => JSON.stringify(order(first)) === JSON.stringify(order(second));
const order = value => Array.isArray(value) ? value.map(order) : object(value) ? Object.fromEntries(Object.entries(value).sort().map(([key, row]) => [key, order(row)])) : value;
const finite = value => typeof value === "number" && Number.isFinite(value);
const fail = (message = C.fileError) => { throw new Error(message); };
function timestamp(value) {
  const match = typeof value === "string" && /^(\d{4})-(\d\d)-(\d\d)T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  return Boolean(match && Number(match[2]) >= 1 && Number(match[2]) <= 12 && Number(match[3]) >= 1 &&
    Number(match[3]) <= new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate() && Number.isFinite(Date.parse(value)));
}
const numericId = value => exactId(value) && /^\d+$/.test(value) && /[1-9]/.test(value);
const decimal = value => {
  if (!finite(value) && (typeof value !== "string" || value !== value.trim() || value.length > 80)) return false;
  const text = String(value), match = /^[+-]?(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) return false;
  const decimals = match[2] || match[3] || "", digits = ((match[1] || "") + decimals).replace(/^0+/, "") || "0";
  return decimals.length - Number(match[4] || 0) <= 12 && digits.length <= 24 && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 1000000;
};
const fields = new Set(["schema_version", "context", "decision_at", "objective", "contest", "sources", "accepted_state", "catalog", "candidates", "controls"]);
const sourceKinds = new Set(["user_platform_readback", "rules", "salary_catalog", "lock_snapshot", "projection_inputs"]);
const slots = value => object(value) && Object.keys(value).length === 9 && LATE_SWAP_SLOTS.every(slot => exactId(value[slot])) && new Set(Object.values(value)).size === 9;

/** Bound and check declarations before any imported private entry leaves the browser. */
export function checkLateSwapAdmission(value, context) {
  if (!object(value) || Object.keys(value).some(key => !fields.has(key)) || value.schema_version !== LATE_SWAP_SCHEMA ||
      value.objective !== "projection_guided_snapshot" || !timestamp(value.decision_at) || !object(value.controls) || !object(value.context)) fail();
  if (!same(value.context, context)) fail(C.contextError);
  if (!object(value.contest) || !exactId(value.contest.contest_id) || typeof value.contest.name !== "string" || !value.contest.name ||
      value.contest.late_swap_enabled !== true || value.contest.lock_policy !== "individual_game" || !timestamp(value.contest.as_of)) fail();
  if (!Array.isArray(value.sources) || value.sources.length !== 5 || new Set(value.sources.map(row => row?.source_id)).size !== 5 ||
      new Set(value.sources.map(row => row?.kind)).size !== 5 || value.sources.some(row => !object(row) || !sourceKinds.has(row.kind) ||
        !exactId(row.source_id) || !timestamp(row.as_of) || !declaredHash(row.content_sha256))) fail();
  if (value.sources.some(row => !object(row.rights) || Object.keys(row.rights).length !== 3 || ["personal_analysis", "hosted_ingestion", "display"].some(key => row.rights[key] !== true))) fail(C.rightsError);
  const accepted = value.accepted_state;
  if (!object(accepted) || !exactId(accepted.source_id) || !declaredHash(accepted.readback_sha256) || !exactId(accepted.portfolio_version) || !exactId(accepted.export_version) ||
      !timestamp(accepted.as_of) || !Array.isArray(accepted.entries) || !accepted.entries.length || accepted.entries.length > 150 ||
      new Set(accepted.entries.map(row => row?.entry_id)).size !== accepted.entries.length || accepted.entries.some(row => !object(row) || !numericId(row.entry_id) ||
        row.contest_id !== value.contest.contest_id || !slots(row.slots))) fail();
  if (Array.isArray(value.catalog) && value.catalog.some(row => !timestamp(row?.kickoff_at) || !["locked", "unlocked"].includes(row?.lock_state))) fail(C.lockError);
  if (!Array.isArray(value.catalog) || value.catalog.length < 9 || value.catalog.length > 750 || new Set(value.catalog.map(row => row?.player_id)).size !== value.catalog.length ||
      new Set(value.catalog.map(row => row?.dfs_id)).size !== value.catalog.length ||
      value.catalog.some(row => !object(row) || !exactId(row.player_id) || !numericId(row.dfs_id) || !["QB", "RB", "WR", "TE", "DST"].includes(row.position) ||
        !Number.isSafeInteger(row.salary) || row.salary < 1 || row.salary > 50000 || !timestamp(row.kickoff_at) || !["locked", "unlocked"].includes(row.lock_state) ||
        !["eligible", "out", "inactive", "unknown"].includes(row.status) || row.projection === null && row.lock_state !== "locked" || row.projection !== null && !decimal(row.projection))) fail();
  const entries = new Set(accepted.entries.map(row => row.entry_id));
  if (!Array.isArray(value.candidates) || value.candidates.length > 600 || new Set(value.candidates.map(row => row?.candidate_id)).size !== value.candidates.length ||
      value.candidates.some(row => !object(row) || !exactId(row.candidate_id) || !entries.has(row.entry_id) || !slots(row.slots))) fail();
  const pool = new Set(value.catalog.map(row => row.player_id));
  if ([...accepted.entries, ...value.candidates].some(row => Object.values(row.slots).some(id => !pool.has(id)))) fail();
  sharedRequestBody({ context, package: value });
  return freezeSnapshot(value);
}

export function readLateSwapFile(text, context) {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > SHARED_MAX_BYTES) fail(C.sizeError);
  return checkLateSwapAdmission(parseScenarioJson(text), context);
}
export function lateSwapPreviewRequest(value, context) {
  checkLateSwapAdmission(value, context);
  return { context, package: value };
}
export async function lateSwapRequestVersion(value) {
  return (await stableBuildKey(value)).replace(/^build:/, "late-swap:");
}

function validateCapabilities(value) {
  if (!object(value) || ["accepted_readback_authenticated", "current_lock_verified", "platform_export_ready", "conditional_remaining_evaluation", "expected_payout", "forecast_performance_verified"].some(key => value[key] !== false) ||
      value.offline_exact_slot_planning !== true || value.independent_hard_constraint_audit !== true) fail(C.responseError);
}
const messages = value => Array.isArray(value) && value.length <= 256 && value.every(row => typeof row === "string" && row.length <= 4096);
const normalizedContest = value => ({ ...value, as_of: Date.parse(value.as_of) });
const normalizedSources = value => value.map(row => ({ ...row, as_of: Date.parse(row.as_of), content_sha256: row.content_sha256.toLowerCase() })).sort((a, b) => a.kind.localeCompare(b.kind));
export function validateLateSwapPreview(value, request) {
  const data = request.package, entries = data.accepted_state.entries, pool = new Map(data.catalog.map(row => [row.player_id, row]));
  if (!object(value) || value.schema_version !== "dfs_late_swap_preview_v1" || value.semantics !== LATE_SWAP_SEMANTICS || !hash(value.content_id) || !same(value.context, request.context) ||
      Date.parse(value.decision_at) !== Date.parse(data.decision_at) || !object(value.contest) || !same(normalizedContest(value.contest), normalizedContest(data.contest)) || value.entry_count !== entries.length ||
      value.candidate_count !== data.candidates.length || value.option_count !== data.candidates.length + entries.length || value.locked_slot_count !== entries.reduce((sum, row) => sum + Object.values(row.slots).filter(id => pool.get(id).lock_state === "locked").length, 0) ||
      !Array.isArray(value.rejected_options) || !Array.isArray(value.sources) || !same(normalizedSources(value.sources), normalizedSources(data.sources)) || !messages(value.warnings)) fail(C.responseError);
  validateCapabilities(value.capabilities);
  return value;
}
function decimalPair(value) {
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(String(value));
  if (!match || String(value).length > 100) fail(C.responseError);
  const decimals = match[3] || match[4] || "", scale = decimals.length - Number(match[5] || 0);
  if (!Number.isSafeInteger(scale) || Math.abs(scale) > 30) fail(C.responseError);
  const numerator = BigInt((match[1] === "-" ? "-" : "") + (match[2] || "0") + decimals);
  return scale < 0 ? [numerator * 10n ** BigInt(-scale), 1n] : [numerator, 10n ** BigInt(scale)];
}
const add = (a, b) => [a[0] * b[1] + b[0] * a[1], a[1] * b[1]];
const equalDecimal = (value, expected) => { const parsed = decimalPair(value); return parsed[0] * expected[1] === expected[0] * parsed[1]; };
const slotPosition = slot => slot.startsWith("RB") ? "RB" : slot.startsWith("WR") ? "WR" : slot;
function validateRoster(value, pool, controls) {
  if (!slots(value)) fail(C.responseError);
  const players = LATE_SWAP_SLOTS.map(slot => ({ ...pool.get(value[slot]), slot }));
  if (players.some(row => !row.player_id || (row.slot === "FLEX" ? !["RB", "WR", "TE"].includes(row.position) : row.position !== slotPosition(row.slot)))) fail(C.responseError);
  const salary = players.reduce((sum, row) => sum + row.salary, 0), teams = new Map();
  players.forEach(row => teams.set(row.team, (teams.get(row.team) || 0) + 1));
  if (salary > (controls.max_salary ?? 50000) || salary < (controls.min_salary ?? 0) || new Set(players.map(row => row.game_id)).size < 2 ||
      (controls.max_per_team != null && [...teams.values()].some(count => count > controls.max_per_team)) ||
      (controls.excluded_player_ids || []).some(id => Object.values(value).includes(id)) ||
      (controls.locked_player_ids || []).some(id => !Object.values(value).includes(id))) fail(C.responseError);
  const qb = players.find(row => row.slot === "QB"), dst = players.find(row => row.slot === "DST");
  if (controls.block_qb_opposing_dst !== false && (qb.opponent === dst.team || dst.opponent === qb.team)) fail(C.responseError);
  try { auditClassicStackRules(controls.classic_stack_rules || null, { lineup: players }, [...pool.values()]); } catch { fail(C.responseError); }
  return salary;
}
export function validateLateSwapPlan(value, request, preview) {
  const data = request.package, originals = new Map(data.accepted_state.entries.map(row => [row.entry_id, row])), pool = new Map(data.catalog.map(row => [row.player_id, { ...row, team: normalizeDfsTeam(row.team), opponent: normalizeDfsTeam(row.opponent) }]));
  if (!object(value) || value.schema_version !== "dfs_late_swap_plan_v1" || value.semantics !== LATE_SWAP_SEMANTICS || value.package_id !== request.package_id || value.package_id !== preview.content_id ||
      !hash(value.plan_id) || !same(value.context, request.context) || Date.parse(value.decision_at) !== Date.parse(data.decision_at) || !object(value.contest) || !same(normalizedContest(value.contest), normalizedContest(data.contest)) ||
      value.entry_count !== originals.size || value.requested_count !== originals.size || value.candidate_count !== data.candidates.length || value.option_count !== data.candidates.length + originals.size || typeof value.complete !== "boolean" || !object(value.solver) ||
      !["optimal_candidate_pool", "feasible_candidate_pool", "feasible_time_limit", "time_limit", "constraint_conflict", "infeasible_candidate_pool", "solver_error"].includes(value.solver.status) ||
      value.solver.candidate_pool_only !== true || value.solver.objective !== "unstarted_player_input_sum" || typeof value.solver.proven_optimal !== "boolean" ||
      !Number.isSafeInteger(value.solver.evaluated_trials) || value.solver.evaluated_trials < 0 ||
      [value.solver.bound, value.solver.gap].some(row => row !== null && !finite(row)) ||
      !finite(value.runtime_seconds) || value.runtime_seconds < 0 || !Array.isArray(value.rejected_options) || value.rejected_options.some(row => !object(row) || !exactId(row.entry_id) || !exactId(row.candidate_id) || !messages(row.issues)) ||
      !Array.isArray(value.targets) || value.targets.some(row => !object(row) || !exactId(row.id) || !["player", "group"].includes(row.scope) || !Array.isArray(row.player_ids) || !row.player_ids.length || row.player_ids.some(id => !pool.has(id)) || !Number.isSafeInteger(row.actual_count) || row.actual_count < 0 || row.actual_count > originals.size) || !messages(value.warnings) ||
      value.input_manifest?.package_id !== request.package_id || value.input_manifest?.accepted_readback_sha256 !== data.accepted_state.readback_sha256.toLowerCase() ||
      value.input_manifest?.portfolio_version !== data.accepted_state.portfolio_version || value.input_manifest?.export_version !== data.accepted_state.export_version ||
      value.input_manifest?.objective !== data.objective || !Array.isArray(value.input_manifest.sources) || !same(normalizedSources(value.input_manifest.sources), normalizedSources(data.sources))) fail(C.responseError);
  validateCapabilities(value.capabilities);
  if (!value.complete) {
    if (value.selected_count !== 0 || !Array.isArray(value.entries) || value.entries.length || !Array.isArray(value.changes) || value.changes.length) fail(C.responseError);
    return value;
  }
  if (!object(value.audit) || !Array.isArray(value.audit.issues) || value.audit.issues.length || !["optimal_candidate_pool", "feasible_candidate_pool", "feasible_time_limit"].includes(value.solver.status) ||
      value.solver.proven_optimal && value.solver.status !== "optimal_candidate_pool") fail(C.responseError);
  if (value.solver.proven_optimal && (value.solver.method !== "exact_candidate_assignment_enumeration" || value.solver.numerical_optimal !== false || value.solver.gap !== 0 || value.solver.target_stage_status !== "exact_candidate_pool")) fail(C.responseError);
  if (value.selected_count !== originals.size || value.audit?.ok !== true || value.audit?.locked_slots_preserved !== true || value.audit.entry_count !== originals.size || !Array.isArray(value.audit.issues) || !Array.isArray(value.entries) || value.entries.length !== originals.size ||
      new Set(value.entries.map(row => row.entry_id)).size !== originals.size || !Array.isArray(value.changes) || !object(value.baseline) || !object(value.proposed)) fail(C.responseError);
  let beforeSum = [0n, 1n], afterSum = [0n, 1n], beforeSalary = 0, afterSalary = 0;
  const allChanges = [], selected = [];
  for (const entry of value.entries) {
    const original = originals.get(entry.entry_id);
    if (!original || entry.contest_id !== original.contest_id || !same(entry.before_slots, original.slots) || !slots(entry.after_slots) ||
        !object(entry.locked_slots) || !Array.isArray(entry.changes) || !Array.isArray(entry.lineup) || entry.lineup.length !== 9) fail(C.responseError);
    if (!(entry.candidate_id === `baseline:${entry.entry_id}` && same(entry.after_slots, original.slots)) &&
        !data.candidates.some(row => row.candidate_id === entry.candidate_id && row.entry_id === entry.entry_id && same(row.slots, entry.after_slots))) fail(C.responseError);
    const lockedSlots = LATE_SWAP_SLOTS.filter(slot => pool.get(original.slots[slot]).lock_state === "locked");
    if (!same(entry.locked_slots, Object.fromEntries(lockedSlots.map(slot => [slot, original.slots[slot]]))) || lockedSlots.some(slot => entry.after_slots[slot] !== original.slots[slot])) fail(C.responseError);
    const salaryBefore = Object.values(original.slots).reduce((sum, id) => sum + pool.get(id).salary, 0), salaryAfter = validateRoster(entry.after_slots, pool, data.controls);
    let inputBefore = [0n, 1n], inputAfter = [0n, 1n]; const changes = [];
    for (const slot of LATE_SWAP_SLOTS) {
      const before = pool.get(original.slots[slot]), after = pool.get(entry.after_slots[slot]), row = entry.lineup.find(row => row.slot === slot);
      if (!row || row.player_id !== after.player_id || row.dfs_id !== after.dfs_id || row.player !== after.name || row.position !== after.position || row.team !== after.team || row.salary !== after.salary || row.locked !== (after.lock_state === "locked") ||
          (after.lock_state === "locked" && !lockedSlots.includes(slot)) || (after.lock_state === "unlocked" && after.status !== "eligible") ||
          (after.projection === null ? row.projection !== null : !equalDecimal(row.projection, decimalPair(after.projection)))) fail(C.responseError);
      if (before.lock_state === "unlocked") inputBefore = add(inputBefore, decimalPair(before.projection));
      if (after.lock_state === "unlocked") inputAfter = add(inputAfter, decimalPair(after.projection));
      if (before.player_id !== after.player_id) changes.push({ entry_id: entry.entry_id, slot, before_player_id: before.player_id, after_player_id: after.player_id, before_dfs_id: before.dfs_id, after_dfs_id: after.dfs_id, locked: false });
    }
    if (!same(changes, entry.changes) || !equalDecimal(entry.projection_before, inputBefore) || !equalDecimal(entry.projection_after, inputAfter) ||
        entry.salary_before !== salaryBefore || entry.salary_after !== salaryAfter) fail(C.responseError);
    allChanges.push(...changes); selected.push(new Set(Object.values(entry.after_slots)));
    beforeSum = add(beforeSum, inputBefore); afterSum = add(afterSum, inputAfter); beforeSalary += salaryBefore; afterSalary += salaryAfter;
  }
  if (!same(value.changes, allChanges) || !equalDecimal(value.baseline.projection_sum, beforeSum) || !equalDecimal(value.proposed.projection_sum, afterSum) ||
      value.baseline.salary_sum !== beforeSalary || value.proposed.salary_sum !== afterSalary || value.unique_count !== new Set(selected.map(row => [...row].sort().join("\u0000"))).size) fail(C.responseError);
  for (const [id, bound] of Object.entries(data.controls.player_exposure_limits || {})) {
    const count = selected.filter(row => row.has(id)).length;
    if (bound.min != null && count < exposureBoundCount(bound.min, originals.size, "min") || bound.max != null && count > exposureBoundCount(bound.max, originals.size, "max")) fail(C.responseError);
  }
  for (const bound of data.controls.group_exposure_limits || []) {
    const count = selected.filter(row => bound.player_ids.every(id => row.has(id))).length;
    if (bound.min != null && count < exposureBoundCount(bound.min, originals.size, "min") || bound.max != null && count > exposureBoundCount(bound.max, originals.size, "max")) fail(C.responseError);
  }
  for (const target of value.targets) {
    if (target.actual_count !== selected.filter(row => target.player_ids.every(id => row.has(id))).length) fail(C.responseError);
    decimalPair(target.target_count); decimalPair(target.deviation_count);
  }
  for (let i = 0; i < selected.length; i++) {
    if (data.controls.max_exposure != null && [...selected[i]].some(id => selected.filter(row => row.has(id)).length > exposureBoundCount(data.controls.max_exposure, originals.size, "max"))) fail(C.responseError);
    for (let j = 0; j < i; j++) if (data.controls.max_overlap != null && [...selected[i]].filter(id => selected[j].has(id)).length > data.controls.max_overlap) fail(C.responseError);
  }
  return value;
}
export function portableLateSwapPlan(review) {
  return { schema_version: "scoresense_late_swap_plan_review_v1", package: review.package, preview: review.summary, report: review.report, archive_scope: C.downloadScope };
}

export function runLateSwapTask(operation, payload, signal) {
  if (typeof Worker === "undefined") return Promise.reject(new Error(C.workerError));
  return new Promise((resolve, reject) => {
    let worker, done = false;
    const finish = (error, value) => { if (done) return; done = true; signal?.removeEventListener("abort", abort); worker?.terminate(); error ? reject(error) : resolve(value); };
    const abort = () => finish(Object.assign(new Error(C.cancelled), { name: "AbortError" }));
    if (signal?.aborted) return abort(); signal?.addEventListener("abort", abort, { once: true });
    try {
      worker = new Worker(new URL("./dfsLateSwap.worker.js", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }) => data?.ok ? finish(null, data.value) : finish(new Error(data?.error || C.fileError));
      worker.onerror = event => { event.preventDefault?.(); finish(new Error(C.workerError)); };
      worker.onmessageerror = () => finish(new Error(C.workerError)); worker.postMessage({ operation, ...payload });
    } catch { finish(new Error(C.workerError)); }
  });
}
export { sharedRequestBody, SHARED_MAX_BYTES };
