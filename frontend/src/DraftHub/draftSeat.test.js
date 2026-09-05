import assert from "node:assert/strict";
import test from "node:test";
import { seatAction, seatModel, seatOwnership, seatState, seatWho } from "./draftSeat.js";

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

test("empty or missing team ids stay open, not taken", () => {
  assert.deepEqual(seatOwnership({}), { mine: false, taken: false });
  assert.deepEqual(seatOwnership({ teamId: null, myTeamId: null }), { mine: false, taken: false });
  assert.deepEqual(seatOwnership({ teamId: "", myTeamId: "" }), { mine: false, taken: false });
  assert.deepEqual(seatOwnership({ teamId: "t1", myTeamId: "t1" }), { mine: true, taken: false });
  assert.deepEqual(seatOwnership({ teamId: "t2", myTeamId: "t1" }), { mine: false, taken: true });
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
