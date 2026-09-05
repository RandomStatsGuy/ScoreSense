import assert from "node:assert/strict";
import test from "node:test";

import {
  resetValueSheetInflightForTests,
  runValueSheetRequest,
  valueSheetInflightCount,
  valueSheetRequestKey,
} from "./hubDataCache.js";

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
