import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureLeagueFreshness,
  freshnessInflightCount,
  freshnessUrl,
  peekLeagueFreshness,
  resetLeagueFreshnessForTests,
} from "./leagueFreshness.js";
import { getFreshnessCache, setFreshnessCache } from "./hubDataCache.js";

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

test("failed shared freshness requests preserve the last snapshot and allow retry", async () => {
  resetLeagueFreshnessForTests();
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let now = 100_000;
  Date.now = () => now;
  const saved = { available: true, league_id: "lg-failed", synced_at: "last-success" };
  setFreshnessCache("lg-failed", saved);
  now += 31_000;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? new Response("Service unavailable", { status: 503 })
      : Response.json({ available: true, league_id: "lg-failed", synced_at: "recovered" });
  };
  try {
    const first = ensureLeagueFreshness("lg-failed");
    const second = ensureLeagueFreshness("lg-failed");
    assert.equal(first, second);
    const results = await Promise.allSettled([first, second]);
    for (const result of results) {
      assert.equal(result.status, "rejected");
      assert.equal(result.reason.status, 503);
    }
    // Give detached rejections a turn to surface to Node's test runner.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.equal(freshnessInflightCount(), 0);
    assert.equal(peekLeagueFreshness("lg-failed"), saved);
    assert.equal(getFreshnessCache("lg-failed").at, 100_000);
    const recovered = await ensureLeagueFreshness("lg-failed");
    assert.equal(recovered.synced_at, "recovered");
    assert.equal(calls, 2);
    assert.equal(freshnessInflightCount(), 0);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    resetLeagueFreshnessForTests();
  }
});

test("network freshness failures reach callers without an orphan rejection", async () => {
  resetLeagueFreshnessForTests();
  const originalFetch = globalThis.fetch;
  const failure = new TypeError("Network unavailable");
  globalThis.fetch = async () => { throw failure; };
  try {
    await assert.rejects(ensureLeagueFreshness("lg-offline"), (error) => error === failure);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(freshnessInflightCount(), 0);
    assert.equal(peekLeagueFreshness("lg-offline"), null);
  } finally {
    globalThis.fetch = originalFetch;
    resetLeagueFreshnessForTests();
  }
});
