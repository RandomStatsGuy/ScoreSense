import test from "node:test";
import assert from "node:assert/strict";
import { pinPlayerCardContext, playerCardUrl, readPlayerCardWithRecovery } from "./playerCardRead.js";

const payload = (status, values = {}) => ({ ...values, meta: { season: 2026, week: 7, recovery: { status } } });
function harness(options = {}) {
  const data = [], recovery = [], errors = [], requests = [];
  let settled = 0, elapsed = 0;
  const controller = new AbortController();
  return {
    data, recovery, errors, requests, controller,
    run: readCard => readPlayerCardWithRecovery({
      request: { playerId: "8137", scope: "season", applyInjuryAdjustments: false },
      readCard: async context => { requests.push({ ...context }); return readCard(context); },
      signal: controller.signal, onData: value => data.push(value), onRecovery: value => recovery.push(value),
      onError: value => errors.push(value), onSettled: () => { settled += 1; },
      wait: async delay => { elapsed += delay; }, now: () => elapsed,
      ...options,
    }),
    get settled() { return settled; },
  };
}

test("recovery refresh paints completed data, pins omitted period, and preserves read dimensions", async () => {
  const h = harness();
  const steps = [payload("queued"), payload("running"), payload("completed", { weekly_projection: { "Projected Points": 0 } })];
  await h.run(() => steps.shift());
  assert.equal(h.requests.length, 3);
  assert.deepEqual(h.requests[1], { playerId: "8137", scope: "season", applyInjuryAdjustments: false, season: 2026, week: 7, position: undefined });
  assert.equal(h.data.at(-1).weekly_projection["Projected Points"], 0);
  assert.deepEqual(h.recovery.map(row => row.status), ["queued", "running", "completed"]);
  assert.equal(h.settled, 1);
});

test("explicit historical context cannot be replaced by server metadata", () => {
  const request = { playerId: "8137", season: 2025, week: 18, position: "te" };
  assert.deepEqual(pinPlayerCardContext(request, payload("queued")), request);
  const url = playerCardUrl({ ...request, playerId: "sleeper-8137", applyInjuryAdjustments: false, scope: "season" });
  assert.equal(url, "/api/player/sleeper-8137/card?season=2025&week=18&scope=season&position=te&apply_injury_adjustments=false");
});

for (const status of ["failed", "unsupported", "idle", "completed", "unknown"]) {
  test(`terminal ${status} never retries an empty projection`, async () => {
    const h = harness();
    await h.run(() => payload(status, { weekly_projection: null }));
    assert.equal(h.requests.length, 1);
    assert.equal(h.errors.length, 0);
    assert.equal(h.settled, 1);
  });
}

test("refresh count and elapsed time separately bound an active job", async () => {
  const count = harness({ maxRefreshes: 2 });
  await count.run(() => payload("running"));
  assert.equal(count.requests.length, 3);
  assert.equal(count.recovery.at(-1).status, "timed_out");
  const time = harness({ maxDurationMs: 4_000 });
  await time.run(() => payload("running"));
  assert.equal(time.requests.length, 2);
  assert.equal(time.recovery.at(-1).status, "timed_out");
});

test("background network failure retains the successful card and stops retrying", async () => {
  const h = harness();
  let calls = 0;
  await h.run(() => { if (calls++) throw new Error("offline"); return payload("running", { player_name: "George Pickens" }); });
  assert.equal(h.requests.length, 2);
  assert.equal(h.data.at(-1).player_name, "George Pickens");
  assert.equal(h.errors[0].message, "offline");
});

test("aborted body parsing cannot publish old player or week data", async () => {
  const h = harness();
  let finish;
  const running = h.run(() => new Promise(resolve => { finish = resolve; }));
  h.controller.abort();
  finish(payload("completed", { player_name: "Previous player" }));
  await running;
  assert.deepEqual(h.data, []);
  assert.deepEqual(h.recovery, []);
  assert.deepEqual(h.errors, []);
  assert.equal(h.settled, 0);
});

test("closing during recovery wait cancels all remaining reads", async () => {
  const controller = new AbortController();
  const h = harness({ signal: controller.signal, wait: async () => { controller.abort(); } });
  await h.run(() => payload("queued"));
  assert.equal(h.requests.length, 1);
  assert.equal(h.settled, 0);
});
