import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { approvePairingQb, approvedPairingIds, assertShowdownAvailable, availablePairingQbs, groupedShowdownFindings, makeShowdownReview, missingPairingTeams, newShowdownRules, normalizedBuildStatus, readShowdownReview, showdownComparisonPool, showdownExposures, showdownPlayerGaps, showdownRulesFromSettings, showdownScore, showdownSlatePool } from "./dfsShowdownReview.js";
import { captainComparisonRequest } from "./dfsCaptainComparisonRequest.js";
import { buildLineupDetailCsv, buildSiteLineupCsv } from "./dfsExport.js";
import { DFS_SHOWDOWN_COPY as C } from "./dfsToolPresentation.js";

const row = (id, slot = "FLEX1") => ({ player_id: id, dfs_id: String(100 + Number(id.slice(1))), player: `Synthetic ${id}`, slot, team: id === "p2" ? "LA" : "BUF", position: "WR", salary: slot === "CPT" ? 9000 : 6000,
  proj: slot === "CPT" ? 15 : 10, floor: slot === "CPT" ? 3 : 2, ceiling: slot === "CPT" ? 30 : 20, diagnostics: { build_injury_status: "Questionable", injury_status_at: "2026-10-12T16:00:00Z" } });
const entry = () => ({ total_salary: 39000, lineup: Array.from({ length: 6 }, (_, i) => row(`p${i + 1}`, i ? `FLEX${i}` : "CPT")) });
test("ceiling uses slot-weighted P90 once and separates the projection sum", () => {
  const value = showdownScore(entry(), "ceiling");
  assert.equal(value.objective_score, 130); assert.equal(value.projection_sum, 65);
  assert.equal(value.objective_label, "P90-input score"); assert.match(value.objective_semantics, /Not a predicted lineup percentile/);
  assert.equal(value.objective_units, "points");
});
test("median inputs with unknown statistic remain unknown and value has distinct units", () => {
  const median = showdownScore(entry(), "median"), value = showdownScore(entry(), "value");
  assert.equal(median.projection_statistic, "unknown"); assert.match(median.projection_label, /unknown/);
  assert.doesNotMatch(median.objective_label, /expected|P50|lineup median/i);
  assert.equal(value.objective_units, "points per $1,000"); assert.match(value.objective_semantics, /not fantasy points/);
  assert.ok(Math.abs(value.objective_score - (15 / 9000 + 50 / 6000) * 1000) < 1e-10);
});
test("backend metadata agrees within declared slot precision and mismatches are withheld", () => {
  const value = entry(); value.score_metadata = { objective_key: "ceiling", objective_score: 130.01, projection_sum: 65, precision: 2, projection_statistic: "median", projection_label: "Sum of player medians" };
  assert.equal(showdownScore(value).consistent, true);
  value.score_metadata.objective_score = 195; assert.equal(showdownScore(value).consistent, false); assert.equal(showdownScore(value).objective_score, null);
});
test("exact coefficients avoid renderer-rounding drift and Captain salary is used once", () => {
  const value = entry(); value.lineup.forEach(p => { p.objective_coefficient = 1.234567; p.projection_coefficient = 5.6789; });
  const result = showdownScore(value, "value"); assert.ok(Math.abs(result.objective_score - 1.234567 * 6) < 1e-10); assert.ok(Math.abs(result.projection_sum - 5.6789 * 6) < 1e-10);
  assert.equal(value.lineup[0].salary, 9000);
});
for (const [input, expected] of [["Q", "questionable"], ["Questionable", "questionable"], ["D", "doubtful"], ["Out", "out"], ["IR", "ir"], ["reserve/injured", "ir"], ["Limited", "limited"], ["", "unknown"], [null, "unknown"], ["Active", "active"]]) {
  test(`status ${String(input)} stays explicit`, () => assert.equal(normalizedBuildStatus({ "Injury Status": input }), expected));
}
test("at-build status is independent from later updates, which gate exports", () => {
  const built = entry(), before = structuredClone(built), latest = [{ player_id: "p1", "Injury Status": "Out" }];
  assert.throws(() => assertShowdownAvailable([built], latest), /Current unavailable/);
  assert.equal(normalizedBuildStatus(built.lineup[0]), "questionable"); assert.deepEqual(built, before);
  assert.doesNotThrow(() => assertShowdownAvailable([built], [{ player_id: "p1", "Injury Status": "Unknown" }]));
  assert.throws(() => assertShowdownAvailable([built], null), /could not be checked/);
});
test("new configurations require pairing but historical missing keys remain absent", () => {
  assert.equal(newShowdownRules().receiver_captain_qb, "require"); assert.equal(showdownRulesFromSettings({ objective: "ceiling" }), null);
  const saved = { showdown_rules: { receiver_captain_qb: "off", approved_qb_ids: { BUF: ["qa"] } } };
  const copy = showdownRulesFromSettings(saved); copy.approved_qb_ids.BUF.push("backup"); assert.deepEqual(saved.showdown_rules.approved_qb_ids.BUF, ["qa"]);
});
test("pairing choices expose every QB without guessing a starter from row order", () => {
  const pool = [{ player_id: "backup", Team: "BUF", Position: "QB" }, { player_id: "starter", Team: "BUF", Position: "QB", verified_starting_qb: true }, { player_id: "rb", Team: "BUF", Position: "RB" }];
  assert.deepEqual(availablePairingQbs(pool).map(([team, qbs]) => [team, qbs.map(p => p.player_id)]), [["BUF", ["backup", "starter"]]]);
  assert.deepEqual(newShowdownRules().approved_qb_ids, {});
});
test("clearing an approved QB removes the key instead of sending an invalid empty mapping", () => {
  const original = { receiver_captain_qb: "require", approved_qb_ids: { BUF: ["qa"], LA: ["qb"] } };
  assert.deepEqual(approvePairingQb(original, "BUF", ""), { receiver_captain_qb: "require", approved_qb_ids: { LA: ["qb"] } });
  assert.deepEqual(original.approved_qb_ids.BUF, ["qa"]);
  assert.deepEqual(missingPairingTeams([{ player_id: "qa", Team: "BUF", Position: "QB" }, { player_id: "wr", Team: "BUF", Position: "WR" }], newShowdownRules()), ["BUF"]);
});

test("Showdown approvals and warnings use exact salary identities instead of all league teams", () => {
  const selected = [
    { player_id: "qa", Team: "BUF", Position: "QB", salary: 10000 },
    { player_id: "qb", Team: "LAR", Position: "QB", salary: 9000 },
    { player_id: "wa", Team: "BUF", Position: "WR", salary: 6000 },
    { player_id: "wb", Team: "LA", Position: "TE", salary: 200 },
  ];
  const offSlate = Array.from({ length: 30 }, (_, i) => [
    { player_id: `q${i}`, Team: `TEAM${i}`, Position: "QB", salary: null },
    { player_id: `w${i}`, Team: `TEAM${i}`, Position: "WR", salary: null },
  ]).flat();
  const pool = [...selected, ...offSlate, { player_id: "another-buf-qb", Team: "BUF", Position: "QB", salary: 6000 }];
  const before = structuredClone(pool), slate = showdownSlatePool(pool, selected);
  assert.deepEqual(slate.map(player => player.player_id), ["qa", "qb", "wa", "wb"]);
  assert.deepEqual(availablePairingQbs(slate).map(([team]) => team), ["BUF", "LA"]);
  assert.deepEqual(missingPairingTeams(slate, newShowdownRules()), ["BUF", "LA"]);
  const approved = { receiver_captain_qb: "require", approved_qb_ids: { BUF: ["qa"], LAR: ["qb"] } };
  assert.deepEqual(missingPairingTeams(slate, approved), []);
  assert.deepEqual(approvedPairingIds(approved, "LA"), ["qb"]);
  assert.deepEqual(approvePairingQb(approved, "LA", "qb").approved_qb_ids, { BUF: ["qa"], LA: ["qb"] });
  assert.deepEqual(pool, before);
});

test("salary scope handles provider IDs and fails closed when a known catalog does not match", () => {
  const pool = [{ player_id: "wa", dfs_id: "10", salary: 600 }, { player_id: "wb", dfs_id: "11", salary: 200 }];
  assert.deepEqual(showdownSlatePool(pool, [{ dfs_id: 10, salary: 600 }]).map(player => player.player_id), ["wa"]);
  assert.deepEqual(showdownSlatePool(pool, [{ player_id: "absent", salary: 600 }]), []);
  assert.deepEqual(showdownSlatePool([...pool, { player_id: "missing", salary: null }]).map(player => player.player_id), ["wa", "wb"]);
});

test("player comparisons use the frozen slate and cannot gain players from a later catalog", () => {
  const frozen = [{ player_id: "cheap", Player: "Synthetic reserve", salary: 200 }, { player_id: "unsalaried", salary: null }];
  const build = { salaryCatalog: [{ player_id: "new-player", salary: 200 }], settings: { build_snapshot: { content: { input_pool: frozen } }, slate_salaries: [{ player_id: "cheap", salary: 200 }] } };
  const before = structuredClone(build);
  assert.deepEqual(showdownComparisonPool(build).map(player => player.player_id), ["cheap"]);
  assert.deepEqual(showdownComparisonPool(null), []);
  assert.deepEqual(build, before);
});

test("cheap-player review distinguishes absent role, availability and zero chance from a real zero", () => {
  const cheap = { salary: 600, injury_status: "Unknown", diagnostics: { current_role_estimate: {}, predicted_zero_probability: null } };
  const gaps = showdownPlayerGaps(cheap);
  assert.equal(gaps.lowSalary, true); assert.equal(gaps.statusUnknown, true); assert.equal(gaps.roleUnknown, true); assert.equal(gaps.zeroUnknown, true);
  assert.equal(gaps.zeroProbability, null);
  const known = showdownPlayerGaps({ ...cheap, injury_status: "Active", diagnostics: { current_role_estimate: { routes: 12 }, predicted_zero_probability: 0 } });
  assert.equal(known.statusUnknown, false); assert.equal(known.roleUnknown, false); assert.equal(known.zeroUnknown, false); assert.equal(known.zeroProbability, 0);
  for (const invalid of [-1, 2, "unknown", " ", NaN, Infinity, false, true, [], {}]) assert.equal(showdownPlayerGaps({ ...cheap, diagnostics: { predicted_zero_probability: invalid } }).zeroUnknown, true);
  assert.equal(showdownPlayerGaps({ ...cheap, diagnostics: { predicted_zero_probability: "0" } }).zeroProbability, 0);
  for (const invalid of [false, true, NaN, Infinity, "Unavailable", "unknown", { routes: null }]) assert.equal(showdownPlayerGaps({ ...cheap, diagnostics: { current_role_estimate: invalid } }).roleUnknown, true);
});

test("low-salary attention uses base salary, declared cap and Captain multiplier exactly once", () => {
  assert.equal(showdownPlayerGaps({ salary: 7500, slot: "CPT", multiplier: 1.5 }, 50000).lowSalary, true);
  assert.equal(showdownPlayerGaps({ salary: 7501, slot: "CPT", multiplier: 1.5 }, 50000).lowSalary, false);
  assert.equal(showdownPlayerGaps({ salary: 5000 }, 40000).lowSalary, false);
  assert.equal(showdownPlayerGaps({ salary: 6000, slot: "MVP", multiplier: 1.5 }, 50000).lowSalary, false);
  assert.equal(showdownPlayerGaps({ salary: 0 }).lowSalary, false);
  assert.match(C.lowSalary, /10%/); assert.match(C.lowSalaryHelp, /does not establish workload/);
});
test("all Captain comparisons retain single-lineup Showdown rules and exclusions", () => {
  const request = { showdown_rules: { receiver_captain_qb: "require", approved_qb_ids: { BUF: ["qa"] } }, excluded_player_ids: ["backup"], lineup_count: 20, max_exposure: .5, captain_exposure_limits: { qa: .2 } };
  const original = structuredClone(request), output = captainComparisonRequest(request);
  assert.deepEqual(output.showdown_rules, original.showdown_rules); assert.deepEqual(output.excluded_player_ids, original.excluded_player_ids);
  assert.equal(output.lineup_count, 1); assert.equal(output.max_exposure, null); assert.deepEqual(output.captain_exposure_limits, {}); assert.deepEqual(request, original);
});
test("actual exposure separates 12 total and 8 Captain out of 20 into 60/40/20", () => {
  const lineups = Array.from({ length: 20 }, (_, i) => ({ lineup: i < 12 ? [row("p1", i < 8 ? "CPT" : "FLEX1")] : [row("p2")] }));
  const p = showdownExposures(lineups).find(p => p.player_id === "p1"); assert.deepEqual([p.total_count, p.captain_count, p.flex_count, p.total_share, p.captain_share, p.flex_share], [12, 8, 4, .6, .4, .2]);
});
test("warnings group recurring codes once and count actual affected lineups", () => {
  const warning = { code: "shared_backfield", severity: "warning", player_ids: ["p1", "p2"] };
  const report = groupedShowdownFindings([{ construction_audit: [warning, warning] }, { construction_audit: [warning] }, { construction_audit: [{ ...warning, code: "role_unavailable", severity: "info" }] }]);
  assert.deepEqual(report.affected, [0, 1]); assert.equal(report.groups.length, 1); assert.deepEqual(report.groups[0].indexes, [0, 1]);
});
test("personal review saves immutable input/status/scoring/rules without applying anything", () => {
  const build = { context: { site: "draftkings_showdown" }, salaryCatalog: [], settings: { objective: "ceiling", build_snapshot: { id: "synthetic-snapshot" } }, lineups: [entry()] };
  const before = structuredClone(build), review = makeShowdownReview(build, { objective: "ceiling" });
  assert.deepEqual(readShowdownReview(JSON.stringify(review)), review); assert.deepEqual(build, before);
  review.build.lineups[0].lineup[0].diagnostics.build_injury_status = "Out"; assert.deepEqual(build, before);
  assert.equal(Object.hasOwn(readShowdownReview(JSON.stringify(review)).build.settings, "showdown_rules"), false);
});
test("malformed personal reviews fail atomically", () => {
  for (const input of ["{}", "null", JSON.stringify({ schema_version: "dfs_showdown_personal_review_v1", historical_only: true, build: { context: { site: "draftkings" } } })]) assert.throws(() => readShowdownReview(input));
  assert.throws(() => readShowdownReview(" ".repeat(8 * 1024 * 1024 + 1)));
});
test("detail CSV adds honest score/status metadata while site upload cells stay unchanged", () => {
  const value = entry(), csv = buildLineupDetailCsv([value], { isCaptain: true, objective: "ceiling" });
  assert.match(csv.lines[0], /Objective units.*Projection statistic.*At build status/); assert.match(csv.lines[1], /P90-input score.*130.*65.*unknown.*questionable/);
  assert.equal(buildSiteLineupCsv("draftkings_showdown", [value]).lines[0], '"CPT","FLEX","FLEX","FLEX","FLEX","FLEX"');
  assert.doesNotMatch(buildLineupDetailCsv([value]).lines[0], /Objective|At build status/);
});
test("copy keeps strategy and bounded comparison limitations clear", () => {
  assert.match(C.strategyDefault, /not a contest rule/); assert.match(C.compareHelp, /One lineup.*frozen inputs/);
  assert.match(C.compareHelp, /zero Captain limits stay excluded.*Positive exposure limits.*do not apply/);
  assert.doesNotMatch(Object.values(C.objectives).join(" "), /expected payout|win probability|lineup percentile/);
});
test("actual synthetic engine flat contracts render the exact goal and forecast semantics", () => {
  const fixture = JSON.parse(readFileSync(new URL("../test-fixtures/dfs-showdown-data.json", import.meta.url), "utf8"));
  const value = showdownScore(fixture.build);
  assert.equal(value.consistent, true); assert.equal(value.objective_score, fixture.build.objective_score); assert.equal(value.projection_sum, fixture.build.projection_sum);
  assert.equal(value.projection_statistic, "median"); assert.equal(value.projection_label, "Sum of player medians"); assert.equal(value.availability_conditioning, "conditional_active");
  const result = fixture.player_comparison.player_comparison;
  assert.equal(showdownScore(result.baseline.result).objective_score, result.baseline.objective_score);
  assert.equal(showdownScore(result.forced.result).objective_score, result.forced.objective_score);
  assert.equal(normalizedBuildStatus(fixture.build.lineup.find(row => row.player_id === "wb")), "questionable");
});
