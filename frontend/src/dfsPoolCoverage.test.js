import assert from "node:assert/strict";
import test from "node:test";
import { dfsPlayerStatus, dfsPoolCoverage, dfsPoolFreshness, DFS_WORKSPACE_COPY as C } from "./dfsToolPresentation.js";
const player = { Position: "WR", "Low (P10)": 0, "Projected Points": 8, "High (P90)": 20, projection_source: "ScoreSense" };
test("coverage partitions missing and unavailable players without treating a zero as missing", () => {
  const ready = { ...player };
  const missing = { ...player, "High (P90)": null };
  const unavailable = { ...player, "Injury Status": "IR", "Projected Points": null };
  const bye = { ...player, on_bye: true };
  const imported = { ...player, projection_source: "Imported" };
  const unknown = { ...player, projection_source: "__proto__" };
  const coverage = dfsPoolCoverage([ready, missing, unavailable, bye, imported, unknown]);
  assert.deepEqual(coverage.available, [ready, imported, unknown]);
  assert.deepEqual(coverage.missing, [missing]);
  assert.deepEqual(coverage.unavailable, [unavailable, bye]);
  assert.deepEqual(coverage.sources, { ScoreSense: 1, Imported: 1, Other: 1 });
});
test("all three finite estimates are required, but negative defense outcomes and questionable players stay available", () => {
  for (const value of [null, undefined, "", Infinity, NaN, "unknown"]) {
    for (const key of ["Low (P10)", "Projected Points", "High (P90)"]) {
      assert.equal(dfsPlayerStatus({ ...player, [key]: value }), "missing");
    }
  }
  assert.equal(dfsPlayerStatus({ ...player, "Injury Status": "Questionable" }), "available");
  assert.equal(dfsPlayerStatus({ ...player, Position: "DST", "Low (P10)": -4, "Injury Status": "OUT" }), "available");
  assert.equal(dfsPlayerStatus({ ...player, Position: "DST", on_bye: true }), "unavailable");
});
const now = Date.parse("2026-09-28T18:00:00Z");
const status = { now, checkedAt: now, season: 2026, week: 4, refresh: { last_success_at: new Date(now - 60000).toISOString(), refresh_interval_seconds: 300, season: 2026, week: 4, stale: false, status: "ok" } };
test("freshness identifies the pool check and projection refresh separately", () => {
  const result = dfsPoolFreshness(status);
  assert.equal(result.tone, "good");
  assert.match(result.label, /^Pool checked /);
  assert.match(result.detail, /Projections refreshed .*Checks every 5 min while visible/);
  assert.equal(dfsPoolFreshness({ ...status, refresh: {} }).label, C.freshnessUnknown);
});
test("successful fetches cannot hide overdue projections or a failed server job", () => {
  for (const refresh of [
    { ...status.refresh, stale: true },
    { ...status.refresh, status: "error" },
    { ...status.refresh, last_success_at: new Date(now - 600001).toISOString() },
  ]) {
    assert.equal(dfsPoolFreshness({ ...status, refresh }).label, C.freshnessStale);
  }
  assert.equal(dfsPoolFreshness({ ...status, checkedAt: now - 600001 }).label, C.freshnessStale);
});
test("refresh status for another selected season or week cannot claim current projections", () => {
  for (const context of [{ week: 3 }, { season: 2025 }]) {
    const result = dfsPoolFreshness({ ...status, ...context });
    assert.equal(result.tone, "neutral");
    assert.equal(result.label, C.freshnessHistorical);
  }
});
test("uploaded inputs stay frozen and pending or failed loads have distinct states", () => {
  assert.equal(dfsPoolFreshness({ ...status, source: "upload", failed: true }).label, C.uploadedPool);
  assert.equal(dfsPoolFreshness({}).label, C.freshnessPending);
  assert.equal(dfsPoolFreshness({ busy: true }).label, C.freshnessLoading);
  assert.equal(dfsPoolFreshness({ failed: true }).label, C.freshnessLoadFailed);
  assert.equal(dfsPoolFreshness({ ...status, failed: true }).label, C.freshnessFailed);
});
