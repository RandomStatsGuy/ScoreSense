import assert from "node:assert/strict";
import test from "node:test";

import {
  homeCacheKey,
  poolCacheKey,
  resetValueSheetInflightForTests,
  runValueSheetRequest,
  valueSheetInflightCount,
  valueSheetRequestKey,
} from "./hubDataCache.js";

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
