import assert from "node:assert/strict";
import test from "node:test";
import { suggestedBidSubLabel } from "./suggestedBidLabel.js";

test("suggested bid sub-label names scoring and risk posture", () => {
  assert.equal(
    suggestedBidSubLabel({ scoringProfile: "hub_ppr", riskTolerance: 0 }),
    "My PPR scoring · Balanced",
  );
  assert.doesNotMatch(
    suggestedBidSubLabel({ scoringProfile: "hub_ppr" }),
    /Hub/i,
  );
});
