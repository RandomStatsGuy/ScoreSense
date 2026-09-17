import assert from "node:assert/strict";
import test from "node:test";
import { loadTradeBootstrap } from "./tradeBootstrap.js";

test("slow or failed insights cannot delay a seeded trade builder", async () => {
  let releaseRoster, releaseInbox;
  const events = [];
  const pending = loadTradeBootstrap({
    loadRosters: () => new Promise(resolve => { releaseRoster = resolve; }),
    applyRosters: rows => events.push(rows),
    onReady: () => events.push("ready"),
    secondary: [
      () => { events.push("inbox"); return new Promise(resolve => { releaseInbox = resolve; }); },
      () => { throw Error("insights unavailable"); },
    ],
  });
  assert.deepEqual(events, []);
  releaseRoster("seed applied to roster");
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ["seed applied to roster", "ready", "inbox"]);
  releaseInbox();
  const result = await pending;
  assert.equal(result[0].status, "fulfilled");
  assert.equal(result[1].status, "rejected");
});

test("leaving a league before rosters resolve never consumes the trade seed", async () => {
  const controller = new AbortController();
  let release;
  const unexpected = () => assert.fail("old league applied after navigation");
  const pending = loadTradeBootstrap({
    loadRosters: () => new Promise(resolve => { release = resolve; }),
    applyRosters: unexpected, onReady: unexpected, secondary: [unexpected], signal: controller.signal,
  });
  controller.abort();
  release([]);
  assert.deepEqual(await pending, []);
});
