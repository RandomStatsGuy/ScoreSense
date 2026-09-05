import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureLeagueFreshness,
  freshnessInflightCount,
  freshnessUrl,
  resetLeagueFreshnessForTests,
} from "./leagueFreshness.js";

const mem = {};
globalThis.localStorage = {
  getItem: (k) => (Object.hasOwn(mem, k) ? mem[k] : null),
  setItem: (k, v) => {
    mem[k] = String(v);
  },
  removeItem: (k) => {
    delete mem[k];
  },
};

test("freshness URL is one league path", () => {
  assert.equal(
    freshnessUrl("abc"),
    "/api/hub/league/abc/freshness",
  );
  assert.equal(
    freshnessUrl("abc", { demo: true }),
    "/api/hub/demo/league/abc/freshness",
  );
});

test("ensureLeagueFreshness coalesces concurrent GETs for one league", async () => {
  resetLeagueFreshnessForTests();
  let calls = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return new Response(JSON.stringify({ available: true, league_id: "lg1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const first = ensureLeagueFreshness("lg1");
    const second = ensureLeagueFreshness("lg1");
    assert.equal(freshnessInflightCount(), 1);
    const [a, b] = await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.equal(a.league_id, "lg1");
    assert.equal(b.league_id, "lg1");
    const third = await ensureLeagueFreshness("lg1");
    assert.equal(calls, 1);
    assert.equal(third.league_id, "lg1");
  } finally {
    globalThis.fetch = orig;
    resetLeagueFreshnessForTests();
  }
});
