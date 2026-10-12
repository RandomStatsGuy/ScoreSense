import test from "node:test";
import assert from "node:assert/strict";
import { poolVersion, previewPoolUpdate, workspaceCapabilities, solverEvidence, countUniqueLineups } from "./dfsWorkspaceState.js";
const p = { player_id: "p1", dfs_id: "1001", Player: "Player One", Position: "QB", Team: "KC", salary: 5000, "Projected Points": 20, "Low (P10)": 12, "High (P90)": 30 };
test("pool updates retain exact before/after values and version lineage without rewriting inputs", () => {
  const before = structuredClone(p), after = { ...p, "Projected Points": 22, salary: 5100 };
  const diff = previewPoolUpdate([p], { players: [after], salaries: [] }, { fromVersion: 4 });
  assert.equal(diff.toVersion, 5); assert.equal(diff.changes[0].before["Projected Points"], 20);
  assert.equal(diff.changes[0].after["Projected Points"], 22); assert.deepEqual(p, before);
  assert.notEqual(diff.beforeKey, diff.afterKey);
});
test("pool versions ignore ordering, preserve null versus zero, and identify removals", () => {
  assert.equal(poolVersion([p, { ...p, player_id: "p2" }]), poolVersion([{ ...p, player_id: "p2" }, p]));
  assert.notEqual(poolVersion([{ ...p, "Projected Points": null }]), poolVersion([{ ...p, "Projected Points": 0 }]));
  const diff = previewPoolUpdate([p], { players: [], salaries: [] }); assert.equal(diff.changes[0].kind, "removed");
  assert.throws(() => previewPoolUpdate([p], { players: [p, p] }), /repeated/);
  assert.throws(() => previewPoolUpdate([p], { players: [null] }), /invalid catalog/);
});
test("unique roster counts ignore FLEX order but retain the scoring captain identity", () => {
  const roster = [{ player_id: "p1", slot: "CPT" }, { player_id: "p2", slot: "FLEX1" }, { player_id: "p3", slot: "FLEX2" }];
  const reordered = [roster[0], { ...roster[2], slot: "FLEX1" }, { ...roster[1], slot: "FLEX2" }];
  const newCaptain = [{ ...roster[0], slot: "FLEX1" }, { ...roster[1], slot: "CPT" }, roster[2]];
  assert.equal(countUniqueLineups([{ lineup: roster }, { lineup: reordered }]), 1);
  assert.equal(countUniqueLineups([{ lineup: roster }, { lineup: newCaptain }]), 2);
  assert.equal(countUniqueLineups([{ lineup: roster.map(p => ({ ...p, slot: "FLEX" })) }, { lineup: [...roster].reverse().map(p => ({ ...p, slot: "FLEX" })) }]), 1);
});
test("entry readiness and unavailable models remain separate from usable forecasts", () => {
  const caps = workspaceCapabilities({ pool: [p], salaries: [p], template: {}, assigned: 1, selected: 1, prelockConfirmed: true });
  assert.equal(caps.identity, "available"); assert.equal(caps.forecasts, "available"); assert.equal(caps.entries, "ready");
  for (const k of ["roles", "joint", "field", "returns", "lateSwap"]) assert.equal(caps[k], "unavailable");
  assert.equal(caps.acceptance, "unconfirmed");
  assert.equal(workspaceCapabilities({ pool: [{ ...p, dfs_id: null }], salaries: [p] }).identity, "missing");
  assert.equal(workspaceCapabilities({ pool: [p], salaries: [p], template: {}, assignmentError: "Invalid" }).entries, "blocked");
});
test("solver evidence leaves absent bounds and gaps unknown and preserves time-limit status", () => {
  const result = solverEvidence({ requested_count: 150, selected_count: 120, solver_status: "time_limit", candidate_count: 260 });
  assert.equal(result.status, "time_limit"); assert.equal(result.bound, null); assert.equal(result.gap, null); assert.equal(result.selected, 120);
});
