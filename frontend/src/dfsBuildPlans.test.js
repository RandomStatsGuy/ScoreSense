import assert from "node:assert/strict";
import test from "node:test";
import { createBuildPlan, readBuildPlan, writeBuildPlan, previewBuildPlan, applyBuildPlan, assertBuildPlanApplied,
  BUILD_PLAN_MAX_BYTES } from "./dfsBuildPlans.js";
import { DEFAULT_CLASSIC_STACK_RULES } from "./dfsClassicStackRules.js";

const catalog = [
  ["qb1", "101", "BUF", "QB"], ["qb2", "102", "KC", "QB"], ["wr1", "103", "BUF", "WR"],
  ["wr2", "104", "KC", "WR"], ["rb1", "105", "BUF", "RB"], ["dst", "106", "LAR", "DST"],
].map(([player_id, dfs_id, Team, Position]) => ({ player_id, dfs_id, Team, Position, salary: 4000, Player: "Same display name" }));
const validation = { catalog, context: { site: "draftkings", season: 2026, week: 5, slateId: "synthetic" },
  salarySnapshot: { id: "salary-original" }, games: [{ game_id: "immutable-game", home: "KC", away: "BUF", kickoff_et: "2026-10-11T17:00:00Z" }] };
const request = () => ({ portfolio_mode: "global", lineup_count: 4, objective: "median", salary_cap: 50000,
  max_exposure: 1, max_overlap: 7, locked_player_ids: ["qb1"], excluded_player_ids: ["dst"],
  classic_stack_rules: structuredClone(DEFAULT_CLASSIC_STACK_RULES),
  player_exposure_limits: { wr1: { min: .25, target: .4, max: .75 } },
  group_exposure_limits: [{ id: "immutable-core", player_ids: ["qb1", "wr1"], min: { count: 1 }, max: { count: 2 } }],
  game_schedule: validation.games, note: "Outside plan strategy remains intact." });
const plan = (inputs = request(), meta = { id: "plan-first", label: "CIN-C" }) => createBuildPlan(meta, inputs, validation);

test("T14 named plans replace all prior strategy fields in one detached transaction", () => {
  const previous = { ...request(), portfolio_mode: "legacy", locked_player_ids: ["qb2"], excluded_player_ids: ["wr2"],
    qb_stack_count: 2, stack_bring_back: true, classic_stack_rules: null, player_exposure_limits: {}, group_exposure_limits: [],
    stack_game_weights: [{ game_id: "immutable-game", teams: ["BUF", "KC"], weight: 3 }] };
  const before = structuredClone(previous), preview = previewBuildPlan(plan(), previous, validation);
  assert.deepEqual(previous, before);
  assert.ok(preview.manifest.changes.some(change => change.field === "excluded_player_ids"));
  const applied = applyBuildPlan(preview, previous, validation);
  assert.deepEqual(applied.inputs.locked_player_ids, ["qb1"]);
  assert.deepEqual(applied.inputs.excluded_player_ids, ["dst"]);
  assert.deepEqual(applied.inputs.stack_game_weights, []);
  assert.equal(applied.inputs.qb_stack_count, 0); assert.equal(applied.inputs.stack_bring_back, false);
  assert.deepEqual(applied.inputs.game_schedule, before.game_schedule);
  assert.equal(applied.inputs.note, before.note);
  assert.equal(applied.manifest.matches, true); assert.equal(Object.isFrozen(applied.inputs), true);
  assert.deepEqual(previous, before);
});

test("T14 missing exclusions or stale edits block Build and stale previews cannot apply", () => {
  const original = request(), preview = previewBuildPlan(plan(), original, validation);
  assert.throws(() => applyBuildPlan(preview, { ...original, objective: "ceiling" }, validation), /preview.*again/i);
  const applied = applyBuildPlan(preview, original, validation);
  assert.throws(() => assertBuildPlanApplied(applied.manifest, { ...applied.inputs, excluded_player_ids: [] }), /excluded_player_ids/);
  assert.throws(() => assertBuildPlanApplied(applied.manifest, { ...applied.inputs, stack_game_weights: [{ game_id: "stale", teams: ["BUF", "KC"], weight: 1 }] }), /stack_game_weights/);
  const forged = { ...preview, replacement: { ...preview.replacement, excluded_player_ids: [] } };
  assert.deepEqual(applyBuildPlan(forged, original, validation).inputs.excluded_player_ids, ["dst"]);
});

test("T14 fractional and count representations compare by the actual rounded appearance contract", () => {
  const original = request(), result = applyBuildPlan(previewBuildPlan(plan(), original, validation), original, validation);
  const actual = structuredClone(result.inputs);
  actual.player_exposure_limits.wr1 = { min: { count: 1 }, target: { count: 1.6 }, max: { count: 3 } };
  actual.group_exposure_limits[0].player_ids.reverse(); actual.locked_player_ids.reverse();
  assert.equal(assertBuildPlanApplied(result.manifest, actual).matches, true);
  actual.player_exposure_limits.wr1.min.count = 2;
  assert.throws(() => assertBuildPlanApplied(result.manifest, actual), /player_exposure_limits/);
});

test("T14 build manifests retain exact slate identity and normalize the API's empty uploaded slate ID", () => {
  const imported = { ...validation, context: { ...validation.context, slateId: "" }, salarySnapshot: null };
  const current = { ...request(), site: "draftkings", season: 2026, week: 5, slate_id: null, salary_snapshot_id: null };
  const value = createBuildPlan({ id: "uploaded-plan", label: "Uploaded slate" }, current, imported);
  const applied = applyBuildPlan(previewBuildPlan(value, current, imported), current, imported);
  assert.equal(assertBuildPlanApplied(applied.manifest, applied.inputs).matches, true);
  assert.throws(() => assertBuildPlanApplied(applied.manifest, { ...applied.inputs, week: 6 }), /week identity/i);
});

test("T06/T14 immutable IDs distinguish identical labels and prevent changed player rebinding", () => {
  const first = plan(), next = request(); next.locked_player_ids = ["qb2"];
  const second = plan(next, { id: "plan-second", label: "CIN-C" });
  assert.notEqual(first.id, second.id); assert.equal(first.label, second.label);
  assert.deepEqual(second.inputs.locked_player_ids, ["qb2"]);
  const roundTrip = readBuildPlan(writeBuildPlan(first, validation), validation);
  assert.deepEqual(roundTrip, first);
  const changed = { ...validation, catalog: catalog.map(player => player.player_id === "qb1" ? { ...player, dfs_id: "999" } : player) };
  assert.throws(() => readBuildPlan(JSON.stringify(first), changed), /identity/i);
  const noisy = JSON.parse(JSON.stringify(first)); noisy.inputs.locked_player_ids = ["Same display name"];
  assert.throws(() => readBuildPlan(JSON.stringify(noisy), validation), /canonical|missing/i);
  const missing = JSON.parse(JSON.stringify(first)); missing.player_identities = [];
  assert.throws(() => readBuildPlan(JSON.stringify(missing), validation), /missing.*identity/i);
});

test("T14 complete bounded versioned files reject omissions, unsupported fields and malformed data", () => {
  for (const change of [
    value => { delete value.inputs.excluded_player_ids; },
    value => { value.inputs.excluded_player_ids = null; },
    value => { value.inputs.game_schedule = validation.games; },
    value => { value.version = 2; },
    value => { value.inputs.max_exposure = "0.5"; },
    value => { value.context.week = 6; },
  ]) {
    const value = JSON.parse(JSON.stringify(plan())); change(value);
    assert.throws(() => readBuildPlan(JSON.stringify(value), validation), /plan/i);
  }
  assert.throws(() => readBuildPlan("{" + "x".repeat(BUILD_PLAN_MAX_BYTES), validation), /512 KiB/);
  const malicious = JSON.stringify(plan()).replace('"inputs":{', '"inputs":{"__proto__":{"polluted":true},');
  assert.throws(() => readBuildPlan(malicious, validation), /private|executable|fields/i);
  assert.equal({}.polluted, undefined);
});

test("T07/T10 plans detect lock/exclusion, group and role contradictions before any state replacement", () => {
  for (const mutate of [
    input => { input.excluded_player_ids.push("qb1"); },
    input => { input.player_exposure_limits.wr1 = { min: { count: 4 }, max: { count: 2 } }; },
    input => { input.group_exposure_limits[0].player_ids = ["qb1", "dst"]; },
    input => { input.stack_qb_ids = ["wr1"]; },
    input => { input.classic_stack_rules.attachments.receiving_rb_ids = ["wr1"]; },
    input => { input.require_qb_stack = true; },
    input => { input.qb_stack_count = 1; },
    input => { input.max_exposure = .5; },
  ]) {
    const input = request(); mutate(input);
    assert.throws(() => plan(input), /plan|stack/i);
  }
});

test("T14 legacy weighted planning is distinct from kickoff evidence and global scheduling rejects explicitly", () => {
  const legacy = { ...request(), portfolio_mode: "legacy", qb_stack_count: 1, classic_stack_rules: null,
    player_exposure_limits: {}, group_exposure_limits: [], stack_game_weights: [{ game_id: "immutable-game", teams: ["BUF", "KC"], weight: 2 }] };
  assert.equal(plan(legacy).inputs.stack_game_weights[0].weight, 2);
  assert.throws(() => plan({ ...legacy, portfolio_mode: "global", qb_stack_count: 0 }), /unsupported.*global/i);
  assert.throws(() => plan({ ...legacy, stack_game_weights: [{ game_id: "Display game label", teams: ["BUF", "KC"], weight: 2 }] }), /game identity/i);
  assert.throws(() => plan({ ...legacy, stack_game_weights: [{ game_id: "immutable-game", teams: ["BUF", "LAR"], weight: 2 }] }), /game identity/i);
  assert.throws(() => plan({ ...legacy, max_overlap: 9 }), /at least one changed athlete/i);
  const global = request(); global.max_overlap = 9;
  assert.equal(plan(global).inputs.max_overlap, 9);
});

test("T07 plan validation counts existing locked attachments before applying exact or forbidden rules", () => {
  const input = request(); input.locked_player_ids = ["qb1", "wr1"];
  input.player_exposure_limits = {}; input.group_exposure_limits = [];
  input.classic_stack_rules.attachments = { mode: "forbidden", count: 0, receiving_rb_ids: [] };
  assert.throws(() => plan(input), /attachments.*locks/i);
  input.classic_stack_rules.attachments = { mode: "exact", count: 1, receiving_rb_ids: [] };
  assert.equal(plan(input).inputs.classic_stack_rules.attachments.count, 1);
  input.classic_stack_rules.attachments.count = 3;
  assert.throws(() => plan(input), /available eligible/i);
  const omitted = createBuildPlan({ id: "normalized-defaults", label: "Default choices" }, { ...request(), classic_stack_rules: { version: 1 } }, validation);
  assert.deepEqual(omitted.inputs.classic_stack_rules, DEFAULT_CLASSIC_STACK_RULES);
});

test("T14 global named plans reject legacy stack choices even when native rules are null", () => {
  for (const legacy of [{ qb_stack_count: 1 }, { stack_bring_back: true }, { require_qb_stack: true }]) {
    assert.throws(() => plan({ ...request(), classic_stack_rules: null, ...legacy }), /Global plans use native stack rules; clear legacy/i);
  }
  assert.equal(plan({ ...request(), classic_stack_rules: null, qb_stack_count: 0, stack_bring_back: false, require_qb_stack: false }).inputs.classic_stack_rules, null);
});

test("T14 legacy required-stack plans reject explicit zero before create/read and preserve valid wire fields", () => {
  const legacy = { ...request(), portfolio_mode: "legacy", classic_stack_rules: null,
    player_exposure_limits: {}, group_exposure_limits: [], require_qb_stack: true, qb_stack_count: 0 };
  assert.throws(() => plan(legacy), /QB stack count of at least 1/i);
  const valid = plan({ ...legacy, qb_stack_count: 1 });
  const malformed = JSON.parse(JSON.stringify(valid)); malformed.inputs.qb_stack_count = 0;
  assert.throws(() => readBuildPlan(JSON.stringify(malformed), validation), /QB stack count of at least 1/i);
  const restored = readBuildPlan(writeBuildPlan(valid, validation), validation);
  assert.equal(restored.inputs.require_qb_stack, true); assert.equal(restored.inputs.qb_stack_count, 1);
  const result = applyBuildPlan(previewBuildPlan(restored, legacy, validation), legacy, validation);
  assert.equal(assertBuildPlanApplied(result.manifest, result.inputs).matches, true);
  assert.throws(() => assertBuildPlanApplied(result.manifest, { ...result.inputs, qb_stack_count: 0 }), /qb_stack_count/i);
  assert.throws(() => assertBuildPlanApplied(result.manifest, { ...result.inputs, require_qb_stack: false }), /require_qb_stack/i);
});
