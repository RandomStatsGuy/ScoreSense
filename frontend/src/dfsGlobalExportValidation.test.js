import assert from "node:assert/strict";
import test from "node:test";
import { buildEntryCsv, readEntryTemplate } from "./dfsEntryExport.js";
import { auditPortfolio, buildPortfolioEntryCsv, createPortfolioBatch } from "./dfsPortfolio.js";
import { csvLines } from "./dfsCsv.js";
import { readPortfolioBackup, writePortfolioBackup } from "./dfsPortfolioBackup.js";
import { DEFAULT_CLASSIC_STACK_RULES } from "./dfsClassicStackRules.js";
import { createBuildPlan, previewBuildPlan } from "./dfsBuildPlans.js";

const slots = ["QB", "RB1", "RB2", "WR1", "WR2", "WR3", "TE", "FLEX", "DST"];
const positions = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "WR", "DST"];
function source() {
  const salaryCatalog = Array.from({ length: 12 }, (_, i) => ({ player_id: `p${i}`, dfs_id: String(100 + i),
    Player: `Synthetic ${i}`, Team: i === 8 ? "LAR" : "BUF", Opponent: i === 8 ? "SEA" : "KC",
    Position: positions[i] || "WR", salary: 4000 }));
  const lineups = [0, 1].map(n => ({ total_salary: 36000, total_points: 90, lineup: slots.map((slot, i) => {
    const p = salaryCatalog[i === 5 && n ? 9 : i];
    return { slot, player_id: p.player_id, dfs_id: p.dfs_id, player: p.Player, team: p.Team,
      position: p.Position, salary: p.salary, proj: 10, floor: 5, ceiling: 15 };
  }) }));
  return { context: { site: "draftkings", season: 2026, week: 5, slateId: "synthetic", source: "upload" },
    slateName: "Synthetic", lineups, salaryCatalog, salarySnapshot: null,
    settings: { site: "draftkings", slate_id: "synthetic", portfolio_mode: "global", lineup_count: 2,
      max_exposure: 1, max_overlap: 8, locked_player_ids: ["p0"], excluded_player_ids: ["p11"],
      player_exposure_limits: { p5: { min: { count: 1 }, max: { count: 1 }, target: { count: 2 } } },
      group_exposure_limits: [], block_qb_opposing_dst: true,
      snapshot_at: "2026-10-11T12:00:00Z", build_snapshot: null } };
}
function template(count = 2) {
  return readEntryTemplate(csvLines([["Entry ID", "Contest Name", "Contest ID", "Entry Fee", "QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"],
    ...Array.from({ length: count }, (_, i) => [String(i + 1).padStart(4, "0"), "Synthetic", "001", "$0.25", ...slots.map(() => "Keep")])]).join("\n"), "draftkings");
}
const mappings = { "0001": 0, "0002": 1 };
const exportCurrent = snapshot => buildEntryCsv(template(), snapshot.lineups, mappings, snapshot.salaryCatalog, { buildSource: snapshot });

test("T10/T29 forged global bounds cannot bypass current-build export independently of solver claims", () => {
  for (const mutate of [
    s => { s.settings.lineup_count = 3; },
    s => { s.settings.max_exposure = .5; },
    s => { s.settings.player_exposure_limits.p5.min = { count: 2 }; s.settings.player_exposure_limits.p5.max = { count: 2 }; },
    s => { s.settings.player_exposure_limits.p5.max = { count: 0 }; },
    s => { s.settings.max_overlap = 7; },
    s => { s.settings.locked_player_ids = ["p10"]; },
    s => { s.settings.excluded_player_ids = ["p0"]; },
    s => { s.settings.group_exposure_limits = [{ id: "core", player_ids: ["p0", "p1"], max: { count: 1 } }]; },
    s => { s.lineups[1] = structuredClone(s.lineups[0]); },
  ]) {
    const s = source(); mutate(s);
    assert.throws(() => exportCurrent(s), /global|exposure|overlap|lock|skip|duplicate|count|core|bound/i);
  }
  // A soft target miss is valid; changing projections to meet it is unnecessary.
  assert.equal(exportCurrent(source()).changed, 2);
});

test("T29 restored global batches are checked on their original N without reinterpreting combined batches", () => {
  const original = source(), batch = createPortfolioBatch(original, "Original", "original");
  const packageValue = JSON.parse(writePortfolioBackup([batch], {}, undefined, { version: 1 }));
  packageValue.batches[0].settings.player_exposure_limits.p5.min = { count: 2 };
  packageValue.batches[0].settings.player_exposure_limits.p5.max = { count: 2 };
  const restored = readPortfolioBackup(JSON.stringify(packageValue));
  assert.match(auditPortfolio(restored.batches).errors[0], /global|minimum|actual/i);
  assert.throws(() => buildPortfolioEntryCsv(template(), restored.batches, mappings), /global|minimum|bound/i);
  const legacy = source(); delete legacy.settings.portfolio_mode; legacy.settings.max_exposure = .5;
  assert.equal(buildPortfolioEntryCsv(template(), [createPortfolioBatch(legacy, "Legacy", "legacy")], mappings).changed, 2);
});

test("T08 global exports recheck opposing DST and unknown provenance, with explicit override preserved", () => {
  const conflict = source(); conflict.salaryCatalog[8].Team = "KC";
  conflict.lineups.forEach(l => { l.lineup[8].team = "KC"; });
  assert.throws(() => exportCurrent(conflict), /opposing|quarterback|DST/i);
  conflict.settings.block_qb_opposing_dst = false;
  assert.equal(exportCurrent(conflict).changed, 2);
  const unknown = source(); unknown.salaryCatalog.forEach(p => { delete p.Opponent; });
  assert.throws(() => exportCurrent(unknown), /unknown|opponent|DST/i);
});

test("T10 original global count bounds stay per batch when two approved builds are collected", () => {
  const a = source(), b = source();
  b.lineups.forEach(entry => {
    const player = b.salaryCatalog[10];
    entry.lineup[3] = { ...entry.lineup[3], player_id: player.player_id, dfs_id: player.dfs_id, player: player.Player };
  });
  const batches = [createPortfolioBatch(a, "First", "first"), createPortfolioBatch(b, "Second", "second")];
  const entries = template(4), mapping = Object.fromEntries(entries.entries.map((entry, i) => [entry.id, i]));
  const exported = buildPortfolioEntryCsv(entries, batches, mapping);
  assert.equal(exported.changed, 4);
  assert.deepEqual(exported.manifest.globalBuilds.map(build => build.requestedCount), [2, 2]);
  assert.deepEqual(exported.manifest.globalBuilds.map(build => build.bounds.find(rule => rule.id === "p5").actual), [1, 1]);
});

test("T35 immutable input parameters cannot be stripped or replaced to evade the global audit", () => {
  const original = source();
  original.settings.build_snapshot = { id: "synthetic", captured_at: original.settings.snapshot_at,
    content: { schema_version: "dfs_build_inputs_v1", parameters: { portfolio_mode: "global", lineup_count: 2,
      player_exposure_limits: structuredClone(original.settings.player_exposure_limits) } } };
  const changed = structuredClone(original); changed.settings.player_exposure_limits.p5.min = { count: 0 };
  assert.throws(() => exportCurrent(changed), /snapshot|original|parameter/i);
  const stripped = structuredClone(original); delete stripped.settings.portfolio_mode;
  assert.throws(() => exportCurrent(stripped), /snapshot|global|original/i);
  const engineOnly = structuredClone(stripped);
  delete engineOnly.settings.build_snapshot.content.parameters;
  engineOnly.settings.build_snapshot.content.engine = { version: "global_candidate_milp_v1" };
  assert.throws(() => exportCurrent(engineOnly), /snapshot|global|original/i);
  assert.equal(exportCurrent(original).changed, 2);
});

test("T10 fractional soft count strings retain the API contract while hard counts stay numeric integers", () => {
  const s = source(); s.settings.player_exposure_limits.p5.target = { count: "1.95" };
  assert.equal(exportCurrent(s).changed, 2);
  s.settings.player_exposure_limits.p5.min = { count: "1" };
  assert.throws(() => exportCurrent(s), /count bound/i);
});

test("T29 global export recomputes original custom salary and team hard limits", () => {
  const expensive = source(); expensive.settings.salary_cap = 45000;
  expensive.salaryCatalog.forEach(player => { player.salary = 5500; });
  expensive.lineups.forEach(entry => { entry.total_salary = 49500; entry.lineup.forEach(row => { row.salary = 5500; }); });
  assert.throws(() => exportCurrent(expensive), /salary|cap/i);
  const tooCheap = source(); tooCheap.settings.min_salary = 37000;
  assert.throws(() => exportCurrent(tooCheap), /salary|minimum/i);
  const teamLimit = source(); teamLimit.settings.max_per_team = 7;
  assert.throws(() => exportCurrent(teamLimit), /team|maximum/i);
  const reviewed = source(); reviewed.settings.salary_cap = 36000;
  reviewed.settings.min_salary = 36000; reviewed.settings.max_per_team = 8;
  assert.equal(exportCurrent(reviewed).changed, 2);
});

test("T07 export independently distinguishes native minimum, exact, maximum and receiving-RB declarations", () => {
  const s = source(); s.settings.classic_stack_rules = structuredClone(DEFAULT_CLASSIC_STACK_RULES);
  s.settings.classic_stack_rules.attachments = { mode: "minimum", count: 1, receiving_rb_ids: [] };
  assert.equal(exportCurrent(s).manifest.globalBuild.stack_audit[0].attachments.actual_count, 5);
  s.settings.classic_stack_rules.attachments.mode = "exact";
  assert.throws(() => exportCurrent(s), /attachments.*exact 1.*actual 5/i);
  s.settings.classic_stack_rules.attachments = { mode: "exact", count: 6, receiving_rb_ids: ["p1"] };
  s.settings.locked_player_ids.push("p1");
  assert.equal(exportCurrent(s).manifest.globalBuild.stack_audit[0].attachments.actual_count, 6);
  s.settings.classic_stack_rules.attachments.receiving_rb_ids = [];
  assert.throws(() => exportCurrent(s), /attachments.*actual 5/i);
  s.settings.classic_stack_rules.attachments = { mode: "maximum", count: 4, receiving_rb_ids: [] };
  assert.throws(() => exportCurrent(s), /attachments.*maximum 4/i);
  s.settings.classic_stack_rules.attachments = { mode: "forbidden", count: 0, receiving_rb_ids: [] };
  assert.throws(() => exportCurrent(s), /attachments.*forbidden/i);
});

test("T07 bring-back audits count existing locked offense, exclude DST and preserve optional semantics", () => {
  const s = source(); s.settings.classic_stack_rules = structuredClone(DEFAULT_CLASSIC_STACK_RULES);
  assert.equal(exportCurrent(s).changed, 2);
  s.settings.classic_stack_rules.bring_back = { mode: "minimum", count: 1 };
  assert.throws(() => exportCurrent(s), /bring-back.*minimum 1.*actual 0/i);
  s.salaryCatalog[2].Team = "KC"; s.lineups.forEach(entry => { entry.lineup[2].team = "KC"; });
  s.settings.locked_player_ids.push("p2");
  s.settings.classic_stack_rules.bring_back.mode = "exact";
  assert.deepEqual(exportCurrent(s).manifest.globalBuild.stack_audit[0].bring_back.player_ids, ["p2"]);
  s.settings.classic_stack_rules.bring_back = { mode: "optional", count: 0 };
  assert.equal(exportCurrent(s).changed, 2);
  s.settings.classic_stack_rules.bring_back = { mode: "forbidden", count: 0 };
  assert.throws(() => exportCurrent(s), /bring-back.*forbidden/i);
  const dstOnly = source(); dstOnly.settings.block_qb_opposing_dst = false;
  dstOnly.salaryCatalog[8].Team = "KC"; dstOnly.lineups.forEach(entry => { entry.lineup[8].team = "KC"; });
  dstOnly.settings.classic_stack_rules = structuredClone(DEFAULT_CLASSIC_STACK_RULES);
  dstOnly.settings.classic_stack_rules.bring_back = { mode: "forbidden", count: 0 };
  assert.equal(exportCurrent(dstOnly).manifest.globalBuild.stack_audit[0].bring_back.actual_count, 0);
});

test("T07/T35 unknown native relationship, mixed legacy settings and changed original rules block export", () => {
  const unknown = source(); unknown.settings.block_qb_opposing_dst = false;
  unknown.salaryCatalog.forEach(player => { delete player.Opponent; });
  unknown.settings.classic_stack_rules = structuredClone(DEFAULT_CLASSIC_STACK_RULES);
  assert.equal(exportCurrent(unknown).manifest.globalBuild.stack_audit[0].bring_back.relationship_known, false);
  unknown.settings.classic_stack_rules.bring_back = { mode: "maximum", count: 1 };
  assert.throws(() => exportCurrent(unknown), /unknown/i);
  const mixed = source(); mixed.settings.classic_stack_rules = structuredClone(DEFAULT_CLASSIC_STACK_RULES);
  mixed.settings.qb_stack_count = 1;
  assert.throws(() => exportCurrent(mixed), /legacy/i);
  mixed.settings.qb_stack_count = 0;
  mixed.settings.build_snapshot = { content: { parameters: { classic_stack_rules: structuredClone(DEFAULT_CLASSIC_STACK_RULES) } } };
  mixed.settings.classic_stack_rules.attachments = { mode: "exact", count: 5, receiving_rb_ids: [] };
  assert.throws(() => exportCurrent(mixed), /original input/i);
  const stripped = source(); delete stripped.settings.portfolio_mode;
  stripped.settings.build_snapshot = { content: { engine: { version: "global_candidate_milp_v2" } } };
  assert.throws(() => exportCurrent(stripped), /global mode/i);
  const contradictory = source(); contradictory.settings.block_qb_opposing_dst = false;
  contradictory.settings.classic_stack_rules = structuredClone(DEFAULT_CLASSIC_STACK_RULES);
  contradictory.salaryCatalog[0].Opponent = "BUF";
  assert.equal(exportCurrent(contradictory).manifest.globalBuild.stack_audit[0].bring_back.relationship_known, false);
  contradictory.settings.classic_stack_rules.bring_back = { mode: "maximum", count: 7 };
  assert.throws(() => exportCurrent(contradictory), /unknown/i);
});

test("T14/T35 independent export audits selected QB scope, original restrictions and applied plan inputs", () => {
  const scoped = source(); scoped.salaryCatalog[10].Position = "QB";
  scoped.settings.stack_qb_ids = ["p10"];
  assert.throws(() => exportCurrent(scoped), /quarterback|QB.*scope|selected QB/i);
  scoped.settings.stack_qb_ids = []; scoped.settings.stack_teams = ["KC"];
  assert.throws(() => exportCurrent(scoped), /quarterback|QB.*scope|selected QB/i);
  scoped.settings.stack_qb_ids = ["p0"];
  assert.equal(exportCurrent(scoped).changed, 2); // Named QB restriction takes precedence, matching the existing API.
  scoped.settings.build_snapshot = { content: { parameters: { stack_qb_ids: ["p10"] } } };
  assert.throws(() => exportCurrent(scoped), /original input/i);
  const planned = source(), validation = { catalog: planned.salaryCatalog, context: planned.context, salarySnapshot: null, games: [] };
  const plan = createBuildPlan({ id: "original-plan", label: "Display only" }, planned.settings, validation);
  planned.settings.plan_manifest = previewBuildPlan(plan, planned.settings, validation).manifest;
  assert.equal(exportCurrent(planned).changed, 2);
  planned.settings.excluded_player_ids = [];
  assert.throws(() => exportCurrent(planned), /excluded_player_ids/i);
});

test("T07 independent native audit treats sentinel team/opponent values as unknown relationships", () => {
  for (const unknown of ["NAN", "NONE", "NULL", "BYE"]) {
    const s = source(); s.settings.block_qb_opposing_dst = false;
    s.settings.classic_stack_rules = structuredClone(DEFAULT_CLASSIC_STACK_RULES);
    s.salaryCatalog[0].Opponent = unknown;
    assert.equal(exportCurrent(s).manifest.globalBuild.stack_audit[0].bring_back.relationship_known, false);
    s.settings.classic_stack_rules.bring_back = { mode: "maximum", count: 7 };
    assert.throws(() => exportCurrent(s), /unknown/i);
  }
  const bye = source(); bye.settings.block_qb_opposing_dst = false;
  bye.settings.classic_stack_rules = structuredClone(DEFAULT_CLASSIC_STACK_RULES);
  bye.salaryCatalog[0].Team = "BYE"; bye.lineups.forEach(entry => { entry.lineup[0].team = "BYE"; });
  bye.settings.classic_stack_rules.attachments = { mode: "maximum", count: 7, receiving_rb_ids: [] };
  assert.throws(() => exportCurrent(bye), /unknown/i);
});
