import assert from "node:assert/strict";
import test from "node:test";
import {
  BID_PULSE_MS,
  SOLD_HOLD_MS,
  clockRingOffset,
  clockUrgency,
  pinAuctionStage,
  positionChipTone,
  shouldHoldSoldCard,
} from "./draftAuctionTheater.js";

test("clock urgency is amber under 10 and red under 5", () => {
  assert.equal(clockUrgency(28), "ok");
  assert.equal(clockUrgency(10), "late");
  assert.equal(clockUrgency(4), "urgent");
  assert.equal(clockUrgency(3, { paused: true }), "idle");
});

test("clock ring drains from full to empty", () => {
  const circ = 100;
  assert.equal(clockRingOffset(30, 30, circ), 0);
  assert.equal(clockRingOffset(15, 30, circ), 50);
  assert.equal(clockRingOffset(0, 30, circ), 100);
});

test("sold hold is live auction only", () => {
  assert.equal(SOLD_HOLD_MS, 1000);
  assert.equal(BID_PULSE_MS, 150);
  assert.equal(shouldHoldSoldCard({ event: { event_type: "win" } }), true);
  assert.equal(shouldHoldSoldCard({ event: { event_type: "win" }, simulating: true }), false);
  assert.equal(shouldHoldSoldCard({ event: { event_type: "pick" } }), false);
});

test("position chips fill teal, overflow amber, empty muted", () => {
  assert.equal(positionChipTone({ count: 0, min: 2, max: 4 }), "empty");
  assert.equal(positionChipTone({ count: 2, min: 2, max: 4 }), "filled");
  assert.equal(positionChipTone({ count: 4, min: 2, max: 4 }), "filled");
  assert.equal(positionChipTone({ count: 5, min: 2, max: 4 }), "over");
  assert.equal(positionChipTone({ count: 0, min: 0, max: 2 }), "empty");
  assert.equal(positionChipTone({ count: 1, min: 0, max: 2 }), "filled");
});

test("simulate pins the auction stage without a nominee", () => {
  assert.equal(pinAuctionStage({ simulating: true }), true);
  assert.equal(pinAuctionStage({ soldHold: { player_name: "Puka" } }), true);
  assert.equal(pinAuctionStage({}), false);
});
