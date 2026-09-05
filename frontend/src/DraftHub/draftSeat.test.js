import assert from "node:assert/strict";
import test from "node:test";
import { seatAction, seatModel, seatState, seatWho } from "./draftSeat.js";

test("idle Draft seats are Open · Take, Yours, or Taken", () => {
  assert.deepEqual(seatModel({ variant: "tile" }), {
    state: "open",
    who: "Open",
    action: "Take",
    slot: undefined,
  });
  assert.equal(seatState({ mine: true }), "you");
  assert.equal(seatAction({ state: "you" }), "Yours");
  assert.equal(seatWho({ state: "taken", name: "Alex P" }), "Alex P");
});

test("Mock and live marks are YOU / 2 / 3 from the same model", () => {
  assert.deepEqual(seatModel({ variant: "mark", mine: true, slot: 1 }), {
    state: "you",
    who: "YOU",
    action: "",
    slot: 1,
  });
  assert.equal(seatWho({ state: "open", variant: "mark", slot: 2 }), "2");
  assert.equal(seatWho({ state: "taken", variant: "mark", slot: 3 }), "3");
});
