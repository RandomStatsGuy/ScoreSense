import assert from "node:assert/strict";
import test from "node:test";

import {
  clearHubDataCache,
  clearInsightsSectionCache,
  insightsBootstrapValid,
  getInsightsSection,
  setInsightsSection,
  getCachedPool,
  getRoomSnapshot,
  getWeeklySnapshot,
  homeCacheKey,
  invalidateRoomSnapshot,
  invalidateWeeklySnapshot,
  poolCacheKey,
  resetValueSheetInflightForTests,
  roomSnapshotKey,
  runValueSheetRequest,
  setCachedPool,
  setRoomSnapshot,
  setWeeklySnapshot,
  valueSheetInflightCount,
  valueSheetRequestKey,
  weeklySnapshotKey,
} from "./hubDataCache.js";

test("draft pool session reuse stays within the account and league", () => {
  const originalStorage = globalThis.sessionStorage;
  const entries = new Map();
  globalThis.sessionStorage = {
    get length() { return entries.size; },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
  const realNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  const rules = { draft_type: "auction", salary_cap: 300 };
  try {
    setCachedPool(2026, rules, { rows: [{ name: "Player" }] }, "alice:one");
    setCachedPool(2026, rules, { rows: [] }, "alice:two");
    assert.deepEqual(getCachedPool(2026, rules, "alice:one"), { rows: [{ name: "Player" }] });
    assert.equal(getCachedPool(2026, rules, "bob:one"), null);
    now += 5 * 60_000;
    assert.equal(getCachedPool(2026, rules, "alice:one"), null);
    setCachedPool(2026, rules, { rows: [] }, "alice:one");
    clearHubDataCache();
    assert.equal(getCachedPool(2026, rules, "alice:one"), null);
    assert.equal(entries.size, 0);
  } finally {
    Date.now = realNow;
    clearHubDataCache();
    if (originalStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = originalStorage;
  }
});

test("weekly and room snapshots are scoped, expire, and invalidate", () => {
  const realNow = Date.now;
  let now = 100;
  Date.now = () => now;
  const weekA = weeklySnapshotKey("alice", "league:one:team:a");
  const weekB = weeklySnapshotKey("bob", "league:one:team:a");
  const roomA = roomSnapshotKey("alice", "one", "a", null);
  const roomB = roomSnapshotKey("alice", "two", "a", null);
  try {
    setWeeklySnapshot(weekA, "one", { marker: "alice" });
    setWeeklySnapshot(weekB, "one", { marker: "bob" });
    setRoomSnapshot(roomA, "one", { marker: "one" });
    setRoomSnapshot(roomB, "two", { marker: "two" });
    assert.deepEqual(getWeeklySnapshot(weekA), { marker: "alice" });
    assert.deepEqual(getWeeklySnapshot(weekB), { marker: "bob" });
    invalidateWeeklySnapshot("one");
    invalidateRoomSnapshot("one");
    assert.equal(getWeeklySnapshot(weekA), null);
    assert.equal(getWeeklySnapshot(weekB), null);
    assert.equal(getRoomSnapshot(roomA), null);
    assert.deepEqual(getRoomSnapshot(roomB), { marker: "two" });
    setWeeklySnapshot(weekA, "one", { marker: "fresh" });
    now += 30_000;
    assert.equal(getWeeklySnapshot(weekA), null);
    now += 30_000;
    assert.equal(getRoomSnapshot(roomB), null);
  } finally {
    Date.now = realNow;
    invalidateWeeklySnapshot();
    invalidateRoomSnapshot();
  }
});

test("pool cache separates auction and pick-draft economics", () => {
  assert.notEqual(
    poolCacheKey(2026, { draft_type: "auction", salary_cap: 200 }),
    poolCacheKey(2026, { draft_type: "snake", salary_cap: 200 }),
  );
});

test("home cache separates capability modes", () => {
  const base = { league_id: "league", team_id: "team", mode: "league" };
  assert.notEqual(
    homeCacheKey({ ...base, capabilities: { version: 1, economics: "salary_cap", acquisition_mode: "bid" } }),
    homeCacheKey({ ...base, capabilities: { version: 1, economics: "none", acquisition_mode: "priority" } }),
  );
});

test("value-sheet inflight coalesces concurrent callers", async () => {
  resetValueSheetInflightForTests();
  let calls = 0;
  const key = valueSheetRequestKey(2026, { salary_cap: 300 }, { forcePool: false });
  const factory = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { rows: [calls] };
  };
  const [a, b] = await Promise.all([
    runValueSheetRequest(key, factory),
    runValueSheetRequest(key, factory),
  ]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.equal(valueSheetInflightCount(), 0);
});


test("refresh invalidation does not join an old in-flight value-sheet request", async () => {
  const { clearHubDataCache } = await import("./hubDataCache.js");
  const before = valueSheetRequestKey(2026, {});
  clearHubDataCache();
  assert.notEqual(valueSheetRequestKey(2026, {}), before);
});


import { loadLeagueRosterRequest, invalidateLeagueRosterRequests } from "./hubDataCache.js";

test("roster reads coalesce and reuse results only within the same account and league", async () => {
  invalidateLeagueRosterRequests();
  let calls = 0;
  const factory = async () => ({ request: ++calls });
  const [a, b] = await Promise.all([
    loadLeagueRosterRequest("alice", "one", factory),
    loadLeagueRosterRequest("alice", "one", factory),
  ]);
  assert.equal(a, b);
  assert.equal(await loadLeagueRosterRequest("alice", "one", factory), a);
  await loadLeagueRosterRequest("bob", "one", factory);
  await loadLeagueRosterRequest("alice", "two", factory);
  assert.equal(calls, 3);
});

test("mutation invalidation rejects a late roster response and refresh bypasses cache", async () => {
  invalidateLeagueRosterRequests();
  let finish;
  const old = loadLeagueRosterRequest("alice", "one", () => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve();
  invalidateLeagueRosterRequests("one");
  const rejected = assert.rejects(old, { name: "AbortError" });
  finish({ old: true });
  await rejected;
  assert.deepEqual(await loadLeagueRosterRequest("alice", "one", async () => ({ value: 1 })), { value: 1 });
  assert.deepEqual(await loadLeagueRosterRequest("alice", "one", async () => ({ value: 2 }), { refresh: true }), { value: 2 });
});

test("failed roster fetches can retry and expired results are reloaded", async () => {
  invalidateLeagueRosterRequests();
  await assert.rejects(loadLeagueRosterRequest("alice", "one", async () => { throw Error("offline"); }));
  const realNow = Date.now;
  let now = 100;
  Date.now = () => now;
  try {
    assert.equal(await loadLeagueRosterRequest("alice", "one", async () => 1), 1);
    now += 30_001;
    assert.equal(await loadLeagueRosterRequest("alice", "one", async () => 2), 2);
  } finally { Date.now = realNow; invalidateLeagueRosterRequests(); }
});


test("successful hub writes and logout invalidate roster reads through apiFetch", async () => {
  const { apiFetch } = await import("../auth.js");
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null };
  globalThis.fetch = async () => ({ ok: true });
  try {
    invalidateLeagueRosterRequests();
    let calls = 0;
    const read = () => loadLeagueRosterRequest("alice", "one", async () => ++calls);
    assert.equal(await read(), 1);
    await apiFetch("/api/hub/roster", { method: "PATCH", body: "{}" });
    assert.equal(await read(), 2);
    await apiFetch("/api/auth/logout", { method: "POST" });
    assert.equal(await read(), 3);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
    invalidateLeagueRosterRequests();
  }
});

test("identity changes invalidate a previous Insights bootstrap", () => {
  const at = Date.now() - 10;
  assert.ok(insightsBootstrapValid("mapping-test", at));
  clearInsightsSectionCache("mapping-test");
  assert.equal(insightsBootstrapValid("mapping-test", at), false);
  assert.ok(insightsBootstrapValid("mapping-other", at));
});

test("name-link invalidation keeps other leagues' saved Insights warm", () => {
  setInsightsSection("link-a", "overview", "current", { name: "old" });
  setInsightsSection("link-b", "overview", "current", { name: "other league" });
  clearInsightsSectionCache("link-a");
  assert.equal(getInsightsSection("link-a", "overview"), null);
  assert.deepEqual(getInsightsSection("link-b", "overview"), { name: "other league" });
});
