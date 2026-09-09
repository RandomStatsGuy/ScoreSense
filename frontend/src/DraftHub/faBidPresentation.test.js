import assert from "node:assert/strict";
import test from "node:test";
import {
  FA_BID_COPY,
  faBidSupport,
  faWalkawayAbove,
  faWalkawayChip,
} from "./faBidPresentation.js";

test("bid copy names the ceiling cost and skips banned verbs", () => {
  assert.equal(FA_BID_COPY.placeBid, "Place bid");
  assert.equal(FA_BID_COPY.pass, "Pass");
  assert.match(FA_BID_COPY.firstCeiling, /walk-away/i);
  assert.doesNotMatch(FA_BID_COPY.placeBid, /Submit|Draft Hub|permission/i);
  assert.doesNotMatch(FA_BID_COPY.pass, /shame|Submit|Draft Hub/i);
  assert.doesNotMatch(faBidSupport("Puka Nacua", 12), /Submit|Draft Hub/i);
});

test("above-ceiling line names the stored max", () => {
  assert.equal(faWalkawayAbove(12), "Above your walk-away ($12)");
  assert.equal(faWalkawayChip(12), "$12");
  assert.equal(faWalkawayChip(null), "Walk-away");
});
