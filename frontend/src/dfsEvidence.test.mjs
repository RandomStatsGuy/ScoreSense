import test from "node:test";
import assert from "node:assert/strict";
import { comparisonInputs, comparisonRequest, commonSnapshotScores, compatibleEvidence, eligibleEvidenceGames, evidenceContext, selectDecisionSnapshot, validateComparisonResponse, portableComparisonReview } from "./dfsEvidence.js";

const builder = () => ({ context: { site: "draftkings", season: 2026, week: 5, slateId: "exact" },
  settings: { objective: "median", maxSalary: 50000 }, locked: [], excluded: [],
  pool: Array.from({ length: 9 }, (_, i) => ({ player_id: `p${i}`, Player: `P${i}`, Team: "BUF", Opponent: "KC", Position: "WR", salary: 5000,
    "Projected Points": 10, "Low (P10)": 5, "High (P90)": 15 })) });

test("an exact slate is required; no all-week evidence fallback", () => {
  const b = builder(); assert.equal(evidenceContext(b).slate_id, "exact");
  b.context.slateId = ""; assert.equal(evidenceContext(b), null);
  const games = eligibleEvidenceGames({ games: [{ game_id: "g1", home: "KC", away: "BUF" }, { game_id: "g2", home: "SEA", away: "LAR" }] }, b.pool);
  assert.deepEqual(games.map(g => g.game_id), ["g1"]);
  assert.equal(eligibleEvidenceGames({ games: games }, []).length, 0);
});
test("missing inputs stay missing, and locked missing players block selection", () => {
  const b = builder(); b.pool.push({ ...b.pool[0], player_id: "missing", "Projected Points": null });
  assert.equal(comparisonInputs(b).pool.length, 9);
  b.locked = ["missing"]; assert.throws(() => comparisonInputs(b), /locked player/i);
});
test("padded and duplicate canonical IDs cannot be silently normalized", () => {
  const b = builder(); b.pool[0].player_id = " padded "; assert.throws(() => comparisonInputs(b), /exact canonical/);
  b.pool[0].player_id = "p1"; assert.throws(() => comparisonInputs(b), /exact canonical/);
});
test("legacy hard attachment controls become native constraints; QB focus remains explicit", () => {
  const b = builder(); b.settings.requireQbStack = true; b.settings.bringBack = true;
  b.stackScope = { teams: ["BUF"], qbIds: ["p0"] };
  const inputs = comparisonInputs(b);
  assert.deepEqual(inputs.classic_stack_rules.attachments, { mode: "minimum", count: 1, receiving_rb_ids: [] });
  assert.deepEqual(inputs.classic_stack_rules.bring_back, { mode: "minimum", count: 1 });
  assert.deepEqual(inputs.stack_qb_ids, ["p0"]);
});
test("selected inputs are detached, evidence scoped, requests omit review-only metadata", async () => {
  const b = builder(), inputs = comparisonInputs(b);
  const evidence = { content_id: "e1", context: inputs.context, games: [] };
  const selected = await selectDecisionSnapshot(inputs, evidence, "2026-10-01T00:00:00Z");
  inputs.pool[0].proj = 90; evidence.games.push({ wrong: true });
  assert.equal(selected.pool[0].proj, 10); assert.equal(selected.evidence.games.length, 0);
  assert.equal(Object.isFrozen(selected.pool[0]), true);
  assert.equal(comparisonRequest(selected).projection_receipts, undefined);
  assert.equal(comparisonRequest(selected).input_snapshot_id, selected.input_snapshot_id);
  assert.equal(compatibleEvidence({ context: { ...selected.context, week: 6 } }, selected.context), false);
  await assert.rejects(selectDecisionSnapshot(inputs, { context: { ...inputs.context, slate_id: "other" } }), /another slate/);
});
test("all saved rosters rescore on the chosen inputs and preserve historical totals", () => {
  const inputs = comparisonInputs(builder());
  const batch = { id: "a", label: "Saved", lineups: [{ total_points: 999, lineup: inputs.pool.map(p => ({ player_id: p.player_id, proj: 999 })) }] };
  assert.equal(commonSnapshotScores(inputs, [batch])[0].objective_score, 90);
  assert.equal(batch.lineups[0].total_points, 999);
  batch.lineups[0].lineup[0].player_id = "unknown";
  assert.equal(commonSnapshotScores(inputs, [batch])[0].objective_score, null);
  assert.equal(commonSnapshotScores(inputs, [batch])[0].status, "unavailable");
});
test("value fallback follows the solver input objective", () => {
  const inputs = comparisonInputs(builder()); inputs.objective = "value";
  const batch = { lineups: [{ lineup: inputs.pool.map(p => ({ player_id: p.player_id })) }] };
  assert.equal(commonSnapshotScores(inputs, [batch])[0].objective_score, 18);
});
test("explicit zero legacy count takes precedence and invalid hard limits never become defaults", () => {
  const b = builder(); b.settings.qbStack = 0; b.settings.requireQbStack = true;
  assert.equal(comparisonInputs(b).classic_stack_rules.attachments.mode, "optional");
  b.settings.maxSalary = 0; assert.throws(() => comparisonInputs(b), /Hard limits/);
});
test("ordinary weighted games identify primary QBs without excluding complementary players", () => {
  const b = builder(); b.pool[0].Position = "QB"; b.pool[0].game_id = "g1";
  b.pool[1].Position = "QB"; b.pool[1].Team = "SEA"; b.pool[1].Opponent = "LAR"; b.pool[1].game_id = "g2";
  b.stackWeights = { g1: 1 }; b.vegasGames = [{ game_id: "g1", away: "BUF", home: "KC" }];
  const result = comparisonInputs(b);
  assert.deepEqual(result.stack_qb_ids, ["p0"]); assert.equal(result.pool.length, 9);
});
test("a response from another selected pool or evidence version cannot replace the review", () => {
  const snapshot = { input_snapshot_id: "decision:one", evidence_id: "e1", objective: "median" };
  const response = { ...snapshot, candidates: [] };
  assert.equal(validateComparisonResponse(snapshot, response), response);
  assert.throws(() => validateComparisonResponse(snapshot, { ...response, evidence_id: "e2" }), /different selected inputs/);
  assert.throws(() => validateComparisonResponse(snapshot, { ...response, input_snapshot_id: "decision:other" }), /different selected inputs/);
});
test("booleans and whitespace cannot become invented zero or one player forecasts", () => {
  for (const value of [true, false, "   "]) { const b = builder(); b.pool[0]["Projected Points"] = value; assert.throws(() => comparisonInputs(b), /complete finite/); }
});
test("portable reviews keep source receipts and frozen user inputs without redistributing raw licensed observations", () => {
  const snapshot = { pool: [{ player_id: "p1" }], evidence_id: "e1", evidence: { content_id: "e1", sources: [{ rights: { redistribution: false } }], observation_ledger: { private_raw: "do not export" } } };
  const exported = portableComparisonReview(snapshot, { snapshot_id: "one" });
  assert.equal(exported.snapshot.evidence_id, "e1"); assert.deepEqual(exported.snapshot.pool, snapshot.pool);
  assert.equal(exported.snapshot.evidence, undefined); assert.equal(exported.snapshot.evidence_reference.content_id, "e1");
  assert.equal(JSON.stringify(exported).includes("private_raw"), false);
});
