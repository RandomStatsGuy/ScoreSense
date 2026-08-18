import test from "node:test";
import assert from "node:assert/strict";
import {
  formatP50Move,
  formatRankMove,
  hasMovement,
} from "./projectionMovement.js";

test("formatP50Move hides zero and missing deltas", () => {
  assert.equal(formatP50Move(0), null);
  assert.equal(formatP50Move(0.0), null);
  assert.equal(formatP50Move("0.0"), null);
  assert.equal(formatP50Move(null), null);
  assert.equal(formatP50Move(undefined), null);
});

test("formatP50Move keeps signed non-zero moves", () => {
  assert.equal(formatP50Move(1.2), "+1.2");
  assert.equal(formatP50Move(-0.8), "−0.8");
});

test("formatRankMove hides unchanged ranks", () => {
  assert.equal(
    formatRankMove({
      previousRank: 1,
      currentRank: 1,
      rankDelta: 0,
      position: "QB",
    }),
    null,
  );
  assert.equal(
    formatRankMove({
      previousRank: 1,
      currentRank: 1,
      position: "QB",
    }),
    null,
  );
});

test("formatRankMove keeps real rank changes", () => {
  assert.equal(
    formatRankMove({
      previousRank: 18,
      currentRank: 11,
      rankDelta: 7,
      position: "RB",
    }),
    "RB18 → RB11 ▲7",
  );
  assert.equal(
    formatRankMove({
      previousRank: 2,
      currentRank: 5,
      rankDelta: -3,
      position: "QB",
    }),
    "QB2 → QB5 ▼3",
  );
});

test("hasMovement ignores zero-delta rows", () => {
  assert.equal(hasMovement({ p50_delta: 0, rank_delta: 0 }), false);
  assert.equal(hasMovement({ p50_delta: 0.4, rank_delta: 0 }), true);
  assert.equal(hasMovement({ p50_delta: 0, rank_delta: -2 }), true);
});
