import assert from "node:assert/strict";
import test from "node:test";
import { auditPortfolio, buildPortfolioEntryCsv, classicLineupKey, createPortfolioBatch, portfolioBuildPayload } from "./dfsPortfolio.js";
import { readEntryTemplate } from "./dfsEntryExport.js";
import { csvLines } from "./dfsCsv.js";
import { PORTFOLIO_BACKUP_MAX_BYTES, PORTFOLIO_BACKUP_MAX_EXPANDED_BYTES, PORTFOLIO_BACKUP_MAX_EXPANDED_NODES, readPortfolioBackup, readPortfolioBackupFile, writePortfolioBackup } from "./dfsPortfolioBackup.js";
import { createBuildPlan, previewBuildPlan } from "./dfsBuildPlans.js";
import { previewPortfolioReplacement } from "./dfsPortfolioReview.js";

const timestamp = "2026-10-10T12:00:00.123456+00:00";
const slots = ["QB", "RB1", "RB2", "WR1", "WR2", "WR3", "TE", "FLEX", "DST"];
const positions = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "WR", "DST"];
function batch(offset = 0, count = 75) {
  const salaryCatalog = Array.from({ length: 170 }, (_, i) => ({ player_id: `p${i}`, dfs_id: String(i + 1),
    Player: `Player ${i}`, Team: i % 2 ? "KC" : "BUF", Position: positions[i] || "WR", salary: 4000,
    "Projected Points": 10, "Low (P10)": 5, "High (P90)": 15 }));
  const lineups = Array.from({ length: count }, (_, j) => ({ ok: true, objective: "median", total_points: 90,
    total_salary: 36000, salary_remaining: 14000, note: "Original optimizer note",
    lineup: slots.map((slot, i) => {
      const p = salaryCatalog[i === 5 ? 9 + offset + j : i];
      return { slot, player_id: p.player_id, dfs_id: p.dfs_id, player: p.Player, position: p.Position, team: p.Team,
        salary: p.salary, proj: 10, floor: 5, ceiling: 15, value: 2.5, injury_status: null, on_bye: false };
    }),
  }));
  return createPortfolioBatch({ context: { site: "draftkings", season: 2026, week: 5, slateId: "123", source: "live" },
    slateName: "Classic · 11 games", salaryCatalog, lineups,
    salarySnapshot: { id: "salary-original", captured_at: timestamp, site: "draftkings", slate_id: "123", scoring_verified: false, lock_state_verified: false },
    settings: { site: "draftkings", slate_id: "123", season: 2026, week: 5, salary_snapshot_id: "salary-original",
      locked_player_ids: ["p0"], projection_overrides: { p0: { proj: 10, floor: 5, ceiling: 15 } },
      ownership: { p0: 12 }, note: "Historical inputs", snapshot_at: timestamp,
      build_snapshot: { id: `snapshot-${offset}`, captured_at: timestamp, content: { schema_version: "dfs_build_inputs_v1",
        input_pool: salaryCatalog, parameters: { locked_player_ids: ["p0"] } } } },
  }, `Batch ${offset}`, `batch-${offset}`);
}
const original = () => [batch(), batch(75)];
const document = () => JSON.parse(writePortfolioBackup(original(), { p0: "150", p1: "", removed: null }, timestamp, { version: 1 }));
const restore = value => readPortfolioBackup(JSON.stringify(value));

test("T07/T14/T29 native group and stack rules retain applied-plan provenance through recovery", () => {
  const native = structuredClone(batch(0, 2));
  Object.assign(native.settings, { portfolio_mode: "global", lineup_count: 2, salary_cap: 50000,
    min_salary: 0, max_per_team: 0, max_overlap: 8, max_exposure: 1, randomness: 0, objective: "median",
    excluded_player_ids: [], qb_stack_count: 0, require_qb_stack: false, stack_bring_back: false,
    stack_teams: [], stack_qb_ids: [], stack_game_weights: [], player_exposure_limits: {},
    group_exposure_limits: [{ id: "pair:original", player_ids: ["p1", "p2"], min: { count: 2 }, max: { count: 2 } }],
    classic_stack_rules: { version: 1, attachments: { mode: "optional", count: 0, receiving_rb_ids: ["p2"] }, bring_back: { mode: "optional", count: 0 } },
    block_qb_opposing_dst: false });
  const validation = { catalog: native.salaryCatalog, context: native.context, salarySnapshot: native.salarySnapshot, games: [] };
  const plan = createBuildPlan({ id: "plan:original", label: "Original controls" }, native.settings, validation);
  native.settings.plan_manifest = previewBuildPlan(plan, native.settings, validation).manifest;
  native.settings.build_snapshot.content.parameters = structuredClone(plan.inputs);
  const json = writePortfolioBackup([native], {}, timestamp, { version: 1 }), restored = readPortfolioBackup(json);
  assert.deepEqual(restored.batches[0].settings.classic_stack_rules, native.settings.classic_stack_rules);
  assert.deepEqual(restored.batches[0].settings.plan_manifest, native.settings.plan_manifest);
  assert.deepEqual(restored.batches[0].settings.group_exposure_limits, native.settings.group_exposure_limits);
  const changedPlan = JSON.parse(json); changedPlan.batches[0].settings.plan_manifest.requested.excluded_player_ids = ["p4"];
  assert.throws(() => restore(changedPlan), /plan differs/);
  const changedRole = JSON.parse(json); changedRole.batches[0].settings.classic_stack_rules.attachments.receiving_rb_ids = ["p0"];
  assert.throws(() => restore(changedRole), /not an RB/);
});

function fullPoolBatch(offset, count, poolSize = 700) {
  const result = structuredClone(batch(offset, count));
  // Full build snapshots retain model columns as well as the displayed catalog,
  // eligible solver players, and original salary rows for every collected batch.
  const features = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`model_feature_${i}`, i / 100]));
  result.salaryCatalog = Array.from({ length: poolSize }, (_, i) => ({
    ...result.salaryCatalog[i % result.salaryCatalog.length], ...features,
    player_id: `p${i}`, dfs_id: String(i + 1), Player: `Player ${i}`, Position: positions[i] || "WR",
  }));
  result.settings.slate_salaries = result.salaryCatalog.map(p => ({
    dfs_id: p.dfs_id, salary: p.salary, player_name: p.Player, team: p.Team, position: p.Position,
  }));
  result.settings.projection_sources = Object.fromEntries(result.salaryCatalog.map(p => [p.player_id, "ScoreSense"]));
  result.settings.build_snapshot.content.input_pool = result.salaryCatalog;
  result.settings.build_snapshot.content.eligible_players = result.salaryCatalog.map(p => ({
    player_id: p.player_id, dfs_id: p.dfs_id, name: p.Player, team: p.Team, position: p.Position,
    salary: p.salary, proj: 10, floor: 5, ceiling: 15, cpt_dfs_id: null, cpt_salary: null,
    injury_status: "", on_bye: false,
  }));
  return result;
}

test("full player-pool snapshots download and restore above 120 collected lineups", () => {
  const batches = Array.from({ length: 7 }, (_, i) => fullPoolBatch(i * 20, 20));
  const limits = { p0: 140 };
  const json = writePortfolioBackup(batches, limits, timestamp);
  assert.ok(new TextEncoder().encode(json).length < PORTFOLIO_BACKUP_MAX_BYTES);
  const restored = readPortfolioBackup(json);
  assert.deepEqual(restored.batches, batches);
  assert.deepEqual(restored.appearanceLimits, limits);
  assert.equal(auditPortfolio(restored.batches, limits).unique, 140);
});

test("v2 shares repeated immutable history and reduces the measured 140-lineup full-pool backup", t => {
  const batches = Array.from({ length: 7 }, (_, i) => fullPoolBatch(i * 20, 20));
  const limits = { p0: 140 };
  const v1 = writePortfolioBackup(batches, limits, timestamp, { version: 1 });
  const v2 = writePortfolioBackup(batches, limits, timestamp);
  const size = value => new TextEncoder().encode(value).length;
  const wire = JSON.parse(v2);
  assert.equal(wire.version, 2);
  assert.ok(wire.shared.length > 0);
  assert.ok(size(v2) < size(v1) / 4, `${size(v2)} / ${size(v1)} bytes`);
  assert.deepEqual(readPortfolioBackup(v2).batches, readPortfolioBackup(v1).batches);
  assert.equal(Object.isFrozen(readPortfolioBackup(v2).batches[6].settings.build_snapshot.content.input_pool[0]), true);
  t.diagnostic(`Synthetic 7-batch / 140-lineup / 700-player fixture: v1 ${size(v1)} bytes; v2 ${size(v2)} bytes (${(100 * size(v2) / size(v1)).toFixed(1)}%).`);
});

test("v2 rejects unknown, cyclic, malformed and unused references before returning replacement state", () => {
  const current = original(), before = structuredClone(current);
  const valid = JSON.parse(writePortfolioBackup(current, {}, timestamp));
  const mutations = [
    d => { d.batches = { $ref: "https://example.invalid/private" }; },
    d => { d.batches = { $ref: "c999999" }; },
    d => { d.batches = { $ref: "c0", extra: true }; },
    d => { d.batches = { $ref: 0 }; },
    d => { d.batches = { $ref: "c00" }; },
    d => { d.shared[0] = [{ $ref: "c0" }]; d.batches = { $ref: "c0" }; },
    d => { d.shared[0] = [{ $ref: "c1" }]; d.shared[1] = [{ $ref: "c0" }]; d.batches = { $ref: "c0" }; },
    d => { d.shared.push({ unreferenced: true }); },
    d => { d.batches = { $literal: [["constructor", "hidden"]] }; },
    d => { d.batches = { $literal: [["x", 1], ["x", 2]] }; },
  ];
  for (const mutate of mutations) {
    const d = structuredClone(valid); mutate(d);
    assert.throws(() => restore(d));
    assert.deepEqual(current, before);
  }
});

test("v2 checks aggregate expansion bytes and values before expanding compact reference graphs", () => {
  const base = { schema: "scoresense_classic_portfolio", version: 2, exportedAt: timestamp, appearanceLimits: {}, batches: { $ref: "c1" } };
  const long = "x".repeat(20_000), byteBomb = { ...base, shared: [[long], Array.from({ length: Math.ceil(PORTFOLIO_BACKUP_MAX_EXPANDED_BYTES / long.length) + 1 }, () => ({ $ref: "c0" }))] };
  assert.ok(JSON.stringify(byteBomb).length < PORTFOLIO_BACKUP_MAX_BYTES);
  assert.throws(() => restore(byteBomb), /expanded|recovery limit/);
  const nodeBomb = { ...base, shared: [Array(10_000).fill(0), Array.from({ length: Math.ceil(PORTFOLIO_BACKUP_MAX_EXPANDED_NODES / 10_000) + 1 }, () => ({ $ref: "c0" }))] };
  assert.throws(() => restore(nodeBomb), /expanded|recovery limit/);
  const deep = { ...base, shared: Array.from({ length: 25 }, (_, i) => i === 24 ? [] : [{ $ref: `c${i + 1}` }]), batches: { $ref: "c0" } };
  assert.throws(() => restore(deep));
});

test("v2 escapes literal reference-like historical fields without resolving or rewriting them", () => {
  const batches = structuredClone(original());
  batches[0].settings.build_snapshot.content.research = { $ref: "https://example.invalid/data" };
  batches[1].settings.build_snapshot.content.research = { $literal: [["example", { $ref: "c999" }]] };
  const json = writePortfolioBackup(batches, {}, timestamp);
  assert.deepEqual(readPortfolioBackup(json).batches, batches);
});

test("collection review rules survive v1/v2 recovery with violations visible and export blocked", () => {
  const batches = [batch(0, 2)], rules = { version: 1, players: { p0: { max: "1", target: "1.25" }, p169: { min: 1 } },
    groups: [{ id: "core:pair", player_ids: ["p2", "p1"], min: 0, target: 1.5, max: 1 }] };
  const expected = { version: 1, players: { p0: { target: 1.25, max: 1 }, p169: { min: 1 } },
    groups: [{ id: "core:pair", player_ids: ["p1", "p2"], min: 0, target: 1.5, max: 1 }] };
  for (const version of [1, 2]) {
    const restored = readPortfolioBackup(writePortfolioBackup(batches, {}, timestamp, { version, reviewRules: rules }));
    assert.deepEqual(restored.reviewRules, expected);
    const audit = auditPortfolio(restored.batches, restored.appearanceLimits, restored.reviewRules);
    assert.equal(audit.bounds.errors.length, 3);
    assert.equal(Object.isFrozen(restored.reviewRules.groups[0].player_ids), true);
    const t = template(), assignments = Object.fromEntries(t.entries.slice(0, 2).map((e, i) => [e.id, i]));
    assert.throws(() => buildPortfolioEntryCsv(t, restored.batches, assignments, restored.appearanceLimits, restored.reviewRules), /maximum|minimum/);
  }
  const invalid = [
    { ...rules, players: { unknown: { max: 1 } } },
    { ...rules, players: { p0: { min: 2, max: 1 } } },
    { ...rules, players: { p0: { min: 1.5 } } },
    { ...rules, groups: [{ ...rules.groups[0], label: "Untrusted label" }] },
    { ...rules, groups: [...rules.groups, { ...rules.groups[0], id: "other" }] },
  ];
  for (const reviewRules of invalid) {
    assert.throws(() => writePortfolioBackup(batches, {}, timestamp, { reviewRules }));
    const d = JSON.parse(writePortfolioBackup(batches, {}, timestamp)); d.reviewRules = reviewRules;
    assert.throws(() => restore(d));
  }
  assert.equal(readPortfolioBackup(writePortfolioBackup(batches, {}, timestamp, { version: 1 })).reviewRules, undefined);
});

test("recovery rejects padded canonical IDs instead of restoring an evadable hard player bound", () => {
  const current = [batch(0, 1)], before = structuredClone(current);
  const malformed = structuredClone(current);
  malformed[0].salaryCatalog[0].player_id = " p0 ";
  malformed[0].lineups[0].lineup[0].player_id = " p0 ";
  const reviewRules = { version: 1, players: { " p0 ": { max: 0 } }, groups: [] };
  // Simulate an older backup containing the inconsistent identity, rather than
  // relying on the current writer to manufacture invalid recovery data.
  const wire = JSON.parse(writePortfolioBackup(current, {}, timestamp, { version: 1 }));
  wire.batches = malformed; wire.reviewRules = reviewRules;
  assert.throws(() => restore(wire), /canonical player ID/);
  for (const version of [1, 2]) {
    assert.throws(() => writePortfolioBackup(malformed, {}, timestamp, { version, reviewRules }), /canonical player ID/);
  }
  assert.deepEqual(current, before);
});

test("flat single-lineup replacement history survives both backup versions with complete candidate inputs", () => {
  const original = batch(0, 2), candidate = batch(20, 2);
  const source = Object.fromEntries(["context", "slateName", "lineups", "settings", "salaryCatalog", "salarySnapshot"].map(key => [key, candidate[key]]));
  const preview = previewPortfolioReplacement([original], original.id, source, {}, null, { lineupIndex: 1, candidateIndex: 0 });
  assert.equal(preview.canApply, true);
  const batches = preview.candidateBatches;
  for (const version of [1, 2]) {
    const restored = readPortfolioBackup(writePortfolioBackup(batches, {}, timestamp, { version }));
    assert.deepEqual(restored.batches, batches);
    assert.equal(Object.isFrozen(restored.batches[0].settings.replacement_manifest.replacements[0].candidate_source.settings.build_snapshot.content.input_pool), true);
  }
  const wire = JSON.parse(writePortfolioBackup(batches, {}, timestamp, { version: 1 }));
  const mutations = [
    m => { m.replacements[0].lineup_index = 2; },
    m => { m.replacements[0].candidate_lineup_index = 2; },
    m => { m.replacements.push(structuredClone(m.replacements[0])); },
    m => { m.replacements[0].candidate_source.settings.replacement_manifest = structuredClone(m); },
    m => { m.replacements[0].candidate_source.settings.credentials = "hidden"; },
    m => { m.replacements[0].candidate_source.context.week++; },
    m => { m.replacements[0].candidate_lineup_index = 1; },
    m => { m.replacements[0].candidate_source.lineups[0].lineup[0].dfs_id = "999999"; },
  ];
  for (const mutate of mutations) {
    const d = structuredClone(wire); mutate(d.batches[0].settings.replacement_manifest);
    assert.throws(() => restore(d));
  }
});

test("optional undefined JavaScript values keep the existing JSON omission behavior", () => {
  const batches = structuredClone(original());
  batches[0].settings.note = undefined;
  batches[0].settings.projection_sources = { p0: undefined, p1: "ScoreSense" };
  batches[0].settings.build_snapshot.content.optional_values = [undefined, , 1];
  for (const version of [1, 2]) {
    const restored = readPortfolioBackup(writePortfolioBackup(batches, {}, timestamp, { version }));
    assert.equal(Object.hasOwn(restored.batches[0].settings, "note"), false);
    assert.deepEqual(restored.batches[0].settings.projection_sources, { p1: "ScoreSense" });
    assert.deepEqual(restored.batches[0].settings.build_snapshot.content.optional_values, [null, null, 1]);
  }
});

test("a 150-lineup batch preserves a full supported salary catalog in its backup", () => {
  const batches = [fullPoolBatch(0, 150, 5000)];
  const json = writePortfolioBackup(batches, {}, timestamp);
  assert.ok(new TextEncoder().encode(json).length < PORTFOLIO_BACKUP_MAX_BYTES);
  assert.deepEqual(readPortfolioBackup(json).batches, batches);
});

function template() {
  return readEntryTemplate(csvLines([["Entry ID", "Contest ID", "Contest Name", "Entry Fee", "QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST", "Note"],
    ...Array.from({ length: 151 }, (_, i) => [String(i + 1), "900", "Reserved Classic", "$3.00", ...Array(9).fill("Keep"), "Metadata"])]).join("\n"), "draftkings");
}

test("150-lineup round trip preserves all historical JSON, timestamps, limits, identities, audit and CSV", () => {
  const batches = original(), limits = { p0: "150", p1: "", removed: null };
  const json = writePortfolioBackup(batches, limits, timestamp), backup = readPortfolioBackup(json);
  assert.deepEqual(backup.batches, batches); assert.deepEqual(backup.appearanceLimits, limits);
  assert.equal(backup.exportedAt, timestamp);
  assert.deepEqual(backup.batches.flatMap(b => b.lineups.map(classicLineupKey)), batches.flatMap(b => b.lineups.map(classicLineupKey)));
  assert.deepEqual(auditPortfolio(backup.batches, backup.appearanceLimits), auditPortfolio(batches, limits));
  assert.throws(() => { backup.batches[0].settings.build_snapshot.content.input_pool[0].salary = 1; }, TypeError);
  const t = template(), assignments = Object.fromEntries(t.entries.slice(0, 150).map((e, i) => [e.id, i]));
  assert.deepEqual(buildPortfolioEntryCsv(t, backup.batches, assignments, backup.appearanceLimits), buildPortfolioEntryCsv(t, batches, assignments, limits));
  assert.equal(portfolioBuildPayload(backup.batches[0]).settings.snapshot_at, timestamp);
});

test("restores duplicate lineups and exceeded limits without repair, and both export gates remain", () => {
  const d = document(); d.batches[1].lineups[0] = structuredClone(d.batches[0].lineups[0]);
  d.appearanceLimits.p0 = "149";
  const restored = restore(d), audit = auditPortfolio(restored.batches, restored.appearanceLimits);
  assert.equal(audit.total, 150); assert.equal(audit.unique, 149); assert.equal(audit.duplicates.length, 1);
  assert.match(audit.errors[0], /150 appearances exceeds/);
  const t = template(), assignments = Object.fromEntries(t.entries.slice(0, 150).map((e, i) => [e.id, i]));
  assert.throws(() => buildPortfolioEntryCsv(t, restored.batches, assignments, restored.appearanceLimits), /duplicate/);
  const limitsOnly = restore({ ...document(), appearanceLimits: { p0: 149 } });
  assert.throws(() => buildPortfolioEntryCsv(t, limitsOnly.batches, assignments, limitsOnly.appearanceLimits), /exceeds/);
});

test("malformed, unsupported and oversized files reject before returning a replacement", async () => {
  for (const value of ["", "{", "null", "[]", '{"schema":"other"}']) assert.throws(() => readPortfolioBackup(value));
  const d = document(); d.version = 3; assert.throws(() => restore(d), /supported version/);
  assert.throws(() => readPortfolioBackup(" ".repeat(PORTFOLIO_BACKUP_MAX_BYTES + 1)), /20 MiB/);
  let read = false;
  await assert.rejects(readPortfolioBackupFile({ size: PORTFOLIO_BACKUP_MAX_BYTES + 1, text: () => { read = true; } }), /20 MiB/);
  assert.equal(read, false);
});

test("strict schema rejects altered rosters, identities, catalogs, dates, limits and internal fields", () => {
  const mutations = [
    d => { d.batches[0].lineups[0].lineup.pop(); },
    d => { d.batches[0].lineups[0].lineup[1].slot = "QB"; },
    d => { d.batches[0].lineups[0].lineup[0].player_id = "unknown"; },
    d => { d.batches[0].lineups[0].lineup[0].dfs_id = "999"; },
    d => { d.batches[0].lineups[0].lineup[0].salary++; },
    d => { d.batches[0].lineups[0].lineup[0].proj = "10"; },
    d => { d.batches[0].salaryCatalog[1].player_id = "p0"; },
    d => { d.batches[0].salaryCatalog[1].dfs_id = "1"; },
    d => { d.batches[0].settings.snapshot_at = "yesterday"; },
    d => { d.batches[0].settings.snapshot_at = "2026-02-31T12:00:00Z"; },
    d => { d.batches[0].settings.build_snapshot = { id: "missing-historical-content" }; },
    d => { d.batches[0].settings.salary_snapshot_id = "different"; },
    d => { d.batches[1].id = d.batches[0].id; },
    d => { d.appearanceLimits.p0 = "bad"; },
    d => { d.appearanceLimits.p0 = -1; },
    d => { d.appearanceLimits.p0 = 1.5; },
    d => { d.appearanceLimits.p0 = false; },
    d => { d.batches[0].settings.build_snapshot.content.credentials = { token: "secret" }; },
    d => { d.batches[0].settings.build_snapshot.content["__proto__"] = null; Object.defineProperty(d.batches[0].settings, "constructor", { value: "unsafe", enumerable: true }); },
    d => { d.batches[0].salarySnapshot.scoring_verified = true; },
    d => { d.batches[0].extra = "unknown"; },
    d => { d.assignments = { 1: 0 }; },
    d => { d.portfolioBuildIds = { "batch-0": "foreign-build" }; },
  ];
  for (const mutate of mutations) { const d = document(); mutate(d); assert.throws(() => restore(d)); }
});

test("mixed slate, season, week, source and catalog imports are incompatible", () => {
  for (const mutate of [b => { b.context.slateId = "other"; }, b => { b.context.week = 6; },
    b => { b.context.season = 2025; }, b => { b.context.source = "upload"; },
    b => { b.salarySnapshot.id = "other"; }, b => { b.salaryCatalog[169].salary++; },
    b => { b.context.site = "draftkings_showdown"; }]) {
    const d = document(); mutate(d.batches[1]); assert.throws(() => restore(d));
  }
});

test("bounds cover batches, lineup totals, catalog rows, nested data and nonfinite numbers", () => {
  const d = document(); d.batches = Array(51).fill(d.batches[0]); assert.throws(() => restore(d));
  const oversized = document(); oversized.batches[0].salaryCatalog = Array(5001).fill(oversized.batches[0].salaryCatalog[0]); assert.throws(() => restore(oversized));
  const tooMany = document(); tooMany.batches[0].lineups = Array(151).fill(tooMany.batches[0].lineups[0]); assert.throws(() => restore(tooMany));
  const total = document(); total.batches = Array.from({ length: 7 }, (_, i) => ({ ...total.batches[0], id: `batch-${i}` })); assert.throws(() => restore(total));
  const nested = document(); let cursor = nested.batches[0].settings.build_snapshot.content;
  for (let i = 0; i < 25; i++) cursor = cursor.child = {};
  assert.throws(() => restore(nested));
  const longString = document(); longString.batches[0].settings.build_snapshot.content.notes = "x".repeat(20_001);
  assert.throws(() => restore(longString));
  const longArray = document(); longArray.batches[0].settings.build_snapshot.content.values = Array(10_001).fill(0);
  assert.throws(() => restore(longArray));
  assert.throws(() => readPortfolioBackup(JSON.stringify(document()).replace('"total_points":90', '"total_points":1e999')));
  const changed = structuredClone(original()); changed[0].lineups[0].total_points = NaN;
  assert.throws(() => writePortfolioBackup(changed, {}));
});

test("uploaded salary history and explicit null snapshots round trip without live rebinding", () => {
  const changed = structuredClone(original());
  changed.forEach(b => {
    b.context.source = "upload"; b.context.slateId = ""; b.settings.slate_id = null;
    b.settings.build_snapshot = null; b.settings.salary_snapshot_id = null; b.salarySnapshot = null;
  });
  assert.deepEqual(readPortfolioBackup(writePortfolioBackup(changed, {})).batches, changed);
});

test("backup excludes extra runtime saved mappings and does not manufacture ownership", () => {
  const changed = structuredClone(original()); changed[0].savedBuild = { id: "foreign" };
  const json = writePortfolioBackup(changed, {}), backup = readPortfolioBackup(json);
  assert.equal(json.includes("foreign"), false); assert.equal(backup.batches[0].savedBuild, undefined);
  assert.equal(backup.batches[0].salarySnapshot.scoring_verified, false);
  const payload = portfolioBuildPayload(backup.batches[0]);
  assert.equal(payload.id, undefined); assert.equal(payload.owner, undefined);
  assert.equal(payload.settings.build_snapshot.id, "snapshot-0");
});
