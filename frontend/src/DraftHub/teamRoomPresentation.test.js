import { test } from "node:test";
import assert from "node:assert/strict";
import { roomNumber, roomDelta, roomResult } from "./rosterPresentation.js";
test("missing scores stay distinct from zero and negatives", () => {
  assert.equal(roomNumber(null), "—");
  assert.equal(roomNumber(0), "0.0");
  assert.equal(roomNumber(-2.4), "-2.4");
});
test("only final scores can be compared to a known projection", () => {
  assert.equal(roomDelta({ points: 0, projection: 12 }, "live"), null);
  assert.equal(roomDelta({ points: 0, projection: 12 }, "final"), -12);
  assert.equal(roomDelta({ points: 20, projection: null }, "final"), null);
});
test("matchup result includes wins losses ties and unknown scores", () => {
  assert.equal(
    roomResult({ state: "final", score: 154.4, opponent: { score: 139.1 } }),
    "Won by 15.3",
  );
  assert.equal(
    roomResult({ state: "live", score: 0, opponent: { score: 3 } }),
    "Trailing by 3.0",
  );
  assert.equal(
    roomResult({ state: "final", score: 0, opponent: { score: 0 } }),
    "Finished tied",
  );
  assert.equal(roomResult({ score: null, opponent: { score: 0 } }), "");
});
