import assert from "node:assert/strict";
import test from "node:test";
import {
  TRADE_WEEK_COPY,
  tradeWeekDeltaLine,
  tradeWeekEmptyCopy,
  tradeWeekFaceRows,
  tradeWeekSupport,
  tradeWeekTone,
} from "./tradeWeekPreviewPresentation.js";

test("delta line uses one decimal and a signed swing", () => {
  assert.equal(
    tradeWeekDeltaLine({
      available: true,
      before_p50: 112.4,
      after_p50: 118.1,
      delta: 5.7,
    }),
    "112.4 → 118.1 (+5.7)",
  );
  assert.equal(
    tradeWeekDeltaLine({
      available: true,
      before_p50: 100,
      after_p50: 94.2,
      delta: -5.8,
    }),
    "100.0 → 94.2 (-5.8)",
  );
  assert.equal(tradeWeekDeltaLine({ available: false }), "");
});

test("tone is teal up, amber down, and even stays neutral", () => {
  assert.equal(tradeWeekTone(5.7), "up");
  assert.equal(tradeWeekTone(-1), "down");
  assert.equal(tradeWeekTone(0), "even");
});

test("support names a bump or a lost starter", () => {
  assert.equal(
    tradeWeekSupport({
      bumped_starters: [{ player_name: "Puka Nacua", position: "WR", slot: "WR2" }],
      lost_starters: [{ player_name: "RB Two", position: "RB", slot: "RB2" }],
    }),
    "Incoming WR bumps your RB2.",
  );
  assert.equal(
    tradeWeekSupport({
      bumped_starters: [{ player_name: "Puka Nacua", position: "WR" }],
      lost_starters: [],
    }),
    "Incoming Puka Nacua starts.",
  );
  assert.equal(
    tradeWeekSupport({
      bumped_starters: [],
      lost_starters: [{ player_name: "CMC", position: "RB" }],
    }),
    "You lose starting CMC.",
  );
  assert.equal(tradeWeekSupport({ bumped_starters: [], lost_starters: [] }), TRADE_WEEK_COPY.private);
});

test("empty week uses This Week copy and never a zero lie", () => {
  assert.equal(
    tradeWeekEmptyCopy({ emptyRoster: true, draftCompleted: false }),
    "Lineups open after the draft.",
  );
  assert.equal(
    tradeWeekEmptyCopy({ projectionsMissing: true }),
    "Cannot trust a swap yet.",
  );
  assert.equal(tradeWeekEmptyCopy({}), TRADE_WEEK_COPY.missing);
  assert.doesNotMatch(TRADE_WEEK_COPY.missing, /\$0|Submit|Draft Hub/i);
  assert.doesNotMatch(TRADE_WEEK_COPY.empty, /Submit|Draft Hub|permission/i);
  assert.doesNotMatch(TRADE_WEEK_COPY.private, /Submit|Draft Hub/i);
});

test("face row caps at two names plus overflow", () => {
  const { shown, overflow } = tradeWeekFaceRows({
    bumped_starters: [{ player_id: "a" }, { player_id: "b" }],
    lost_starters: [{ player_id: "c" }],
  });
  assert.equal(shown.length, 2);
  assert.equal(overflow, 1);
});
