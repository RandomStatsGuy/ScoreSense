import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatOpportunityAdjustmentPct,
  pickOpportunityAdjustment,
  slateHasOpportunityAdjustment,
} from "./opportunityAdjustment.js";

test("pickOpportunityAdjustment prefers Opportunity Adjustment over Injury Boost", () => {
  assert.equal(
    pickOpportunityAdjustment({
      "Opportunity Adjustment": 0.15,
      "Injury Boost": 0.05,
    }),
    0.15,
  );
});

test("pickOpportunityAdjustment falls back to Injury Boost alias", () => {
  assert.equal(pickOpportunityAdjustment({ "Injury Boost": 0.12 }), 0.12);
  assert.equal(pickOpportunityAdjustment({ injury_boost: 0.08 }), 0.08);
});

test("pickOpportunityAdjustment skips nested opportunity_adjustment objects", () => {
  assert.equal(
    pickOpportunityAdjustment({
      opportunity_adjustment: { points: 2.1, included: true },
      "Injury Boost": 0.1,
    }),
    0.1,
  );
});

test("formatOpportunityAdjustmentPct and slateHasOpportunityAdjustment", () => {
  assert.equal(formatOpportunityAdjustmentPct({ "Injury Boost": 0.15 }), "+15%");
  assert.equal(formatOpportunityAdjustmentPct(0), null);
  assert.equal(
    slateHasOpportunityAdjustment([{ "Opportunity Adjustment": 0.1 }, { "Injury Boost": 0 }]),
    true,
  );
  assert.equal(slateHasOpportunityAdjustment([{ "Injury Boost": 0 }]), false);
});
