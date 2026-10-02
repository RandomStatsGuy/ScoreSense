import assert from "node:assert/strict";
import test from "node:test";
import { ensureLeagueFreshness, resetLeagueFreshnessForTests, syncLeagueProjections } from "./leagueFreshness.js";
import { PROJECTION_SYNC_COPY } from "./leagueAccessCopy.js";

globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

function setup(t, states) {
  resetLeagueFreshnessForTests();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    const state = states[Math.min(calls++, states.length - 1)];
    return new Response(JSON.stringify(state), { status: 200 });
  };
  t.after(() => { globalThis.fetch = original; resetLeagueFreshnessForTests(); });
  let clock = 0;
  const waits = [];
  return {
    calls: () => calls,
    timing: { now: () => clock, wait: async (ms) => { waits.push(ms); clock += ms; }, timeoutMs: 20_000 },
    waits,
  };
}

const saved = { projections: { available: true, stale: true, built_at: "old", recovery: { status: "running" } } };
const fresh = { projections: { available: true, stale: false, built_at: "new", recovery: { status: "ok" } } };

test("forced freshness bypasses the saved timestamp and still coalesces requests", async (t) => {
  const state = setup(t, [saved, fresh]);
  assert.equal((await ensureLeagueFreshness("league")).projections.built_at, "old");
  const a = ensureLeagueFreshness("league", { force: true });
  const b = ensureLeagueFreshness("league", { force: true });
  assert.strictEqual(a, b);
  assert.equal((await a).projections.built_at, "new");
  assert.equal(state.calls(), 2);
});

test("sync keeps the original timestamp while running and reloads values only at completion", async (t) => {
  const state = setup(t, [saved, saved, fresh]);
  const updates = [], displayed = [];
  let reloads = 0;
  const result = await syncLeagueProjections("league", {
    ...state.timing,
    refresh: async () => { displayed.push(++reloads === 1 ? "saved values" : "fresh values"); return { projection_stale: reloads === 1 }; },
    onUpdate: (payload) => updates.push(payload.projections.built_at),
  });
  assert.deepEqual(updates, ["old", "old", "new"]);
  assert.deepEqual(displayed, ["saved values", "fresh values"]);
  assert.equal(result.projections.stale, false);
  assert.deepEqual(state.waits, [5_000, 5_000]);
});

test("a background failure stays a failure even though saved forecasts returned HTTP 200", async (t) => {
  const state = setup(t, [{ projections: { ...saved.projections, recovery: { status: "error" } } }]);
  let reloads = 0;
  await assert.rejects(syncLeagueProjections("league", {
    ...state.timing, refresh: async () => { reloads++; return { projection_stale: true }; },
  }), { message: PROJECTION_SYNC_COPY.failed });
  assert.equal(reloads, 1);
  assert.equal(state.calls(), 1);
});

test("completion uses the timestamp of the values actually reloaded", async (t) => {
  const state = setup(t, [fresh]);
  const result = await syncLeagueProjections("league", {
    ...state.timing,
    refresh: async () => ({ projection_stale: false, projection_built_at: "newer-pool" }),
  });
  assert.equal(result.projections.built_at, "newer-pool");
});

test("a failed value-sheet read cannot report sync completion", async (t) => {
  const state = setup(t, [fresh]);
  await assert.rejects(syncLeagueProjections("league", {
    ...state.timing, refresh: async () => { throw new Error("Forecasts unavailable"); },
  }), /Forecasts unavailable/);
  assert.equal(state.calls(), 0);
});

test("a missing callback result cannot silently report sync completion", async (t) => {
  const state = setup(t, [fresh]);
  await assert.rejects(syncLeagueProjections("league", {
    ...state.timing, refresh: async () => null,
  }), { message: PROJECTION_SYNC_COPY.failed });
  assert.equal(state.calls(), 0);
});

test("ongoing recovery times out with saved-forecast feedback instead of success", async (t) => {
  const state = setup(t, [saved]);
  await assert.rejects(syncLeagueProjections("league", {
    ...state.timing, refresh: async () => ({ projection_stale: true }),
  }), { message: PROJECTION_SYNC_COPY.timeout });
  assert.equal(state.calls(), 4);
});

test("a source update during the final reload keeps sync pending", async (t) => {
  const state = setup(t, [fresh, saved, fresh]);
  let reloads = 0;
  const result = await syncLeagueProjections("league", {
    ...state.timing, refresh: async () => ({ projection_stale: ++reloads < 3 }),
  });
  assert.equal(reloads, 3);
  assert.equal(result.projections.built_at, "new");
  assert.equal(state.calls(), 3);
});

test("a busy worker is retried after its cooldown when the pool is still stale", async (t) => {
  const state = setup(t, [
    { projections: { ...saved.projections, recovery: { status: "busy", retry_after_seconds: 5 } } },
    { projections: { ...saved.projections, recovery: { status: "busy", retry_after_seconds: 0 } } },
    fresh,
  ]);
  let reloads = 0;
  await syncLeagueProjections("league", {
    ...state.timing, refresh: async () => ({ projection_stale: ++reloads < 3 }),
  });
  assert.equal(reloads, 3);
});

test("switching leagues while a status fetch is pending cancels late UI updates", async (t) => {
  setup(t, [fresh]);
  const controller = new AbortController();
  let respond;
  globalThis.fetch = async () => new Promise((resolve) => { respond = resolve; });
  let updates = 0, reloads = 0;
  const sync = syncLeagueProjections("old-league", {
    signal: controller.signal,
    refresh: async () => { reloads++; return { projection_stale: true }; },
    onUpdate: () => updates++,
  });
  while (!respond) await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  respond(new Response(JSON.stringify(fresh), { status: 200 }));
  await assert.rejects(sync, { name: "AbortError" });
  assert.equal(updates, 0);
  assert.equal(reloads, 1);
});

test("a failed freshness request propagates its message and allows a subsequent retry", async (t) => {
  setup(t, [fresh]);
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: "Server unavailable" }), { status: 503 });
  await assert.rejects(ensureLeagueFreshness("league", { force: true }), /Server unavailable/);
  globalThis.fetch = async () => new Response(JSON.stringify(fresh), { status: 200 });
  assert.equal((await ensureLeagueFreshness("league", { force: true })).projections.built_at, "new");
});
