import assert from "node:assert/strict";
import test from "node:test";
import { auctionViewerGradeCopy, draftLiveCopy, soldPriceLine, soldTone } from "./draftLivePresentation.js";

test("sold copy names the price against fair", () => {
  assert.equal(draftLiveCopy.soldStamp, "SOLD");
  assert.match(soldPriceLine({ amount: 18, fair: 24 }), /under fair/);
  assert.match(soldPriceLine({ amount: 30, fair: 24 }), /over fair/);
  assert.equal(soldTone({ amount: 18, fair: 24 }), "discount");
  assert.equal(soldTone({ amount: 30, fair: 24 }), "reach");
});

test("auction grade leads with a letter and a verdict", () => {
  const bought = auctionViewerGradeCopy({ steals: 1, reaches: 7, leftover: 4, spent: 196, cap: 200 });
  assert.equal(bought.grade, "B−");
  assert.match(bought.summary, /bought the room|ran out/i);
  assert.doesNotMatch(bought.summary, /Submit|Draft Hub|permission/i);
});
