import assert from "node:assert/strict";
import test from "node:test";
import {
  bidBlockedByCeiling,
  parseWalkaway,
  readWalkaway,
  suggestedFaBid,
  walkawayChipAmber,
  walkawayStorageKey,
  writeWalkaway,
} from "./faWalkaway.js";

test("storage key is league and player scoped", () => {
  assert.equal(walkawayStorageKey("L1", "p1"), "ss_fa_walkaway:L1:p1");
});

test("parseWalkaway keeps positive dollars", () => {
  assert.equal(parseWalkaway("12"), 12);
  assert.equal(parseWalkaway(12.4), 12);
  assert.equal(parseWalkaway(0), null);
  assert.equal(parseWalkaway(-3), null);
});

test("read and write survive a refresh-style store", () => {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
  };
  assert.equal(readWalkaway("L1", "p1", storage), null);
  assert.equal(writeWalkaway("L1", "p1", 9, storage), 9);
  assert.equal(readWalkaway("L1", "p1", storage), 9);
});

test("suggested bid prefers fair value then model hint", () => {
  assert.equal(suggestedFaBid({ fair_value: 11, model_bid_hint: 8 }), 11);
  assert.equal(suggestedFaBid({ model_bid_hint: 8 }), 8);
  assert.equal(suggestedFaBid({}), 1);
});

test("block and amber when the bid is above the ceiling", () => {
  assert.equal(bidBlockedByCeiling(13, 12), true);
  assert.equal(bidBlockedByCeiling(12, 12), false);
  assert.equal(bidBlockedByCeiling(10, 12), false);
  assert.equal(walkawayChipAmber(14, 12), true);
  assert.equal(walkawayChipAmber(10, 12), false);
});
