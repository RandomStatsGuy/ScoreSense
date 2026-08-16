/**
 * SCORE-15: Ideas card copy + cap impact helpers.
 * Run with: node --test frontend/src/DraftHub/tradeIdeaHelpers.test.js
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  formatIdeaCapNet,
  ideaCapImpact,
  packageSalaryTotal,
  whyThisHelpsText,
} from "./tradeIdeaHelpers.js";

test("whyThisHelpsText frames surplus and need", () => {
  assert.equal(
    whyThisHelpsText({ fills_needs: ["WR"], moves_surplus: ["TE"] }),
    "Fills your WR need by moving TE surplus.",
  );
  assert.equal(
    whyThisHelpsText({ fills_needs: ["WR", "RB"], moves_surplus: ["TE"] }),
    "Fills your WR / RB needs by moving TE surplus.",
  );
  assert.equal(
    whyThisHelpsText({ fills_needs: ["WR"], moves_surplus: [] }),
    "Fills your WR roster need.",
  );
  assert.equal(
    whyThisHelpsText({ fills_needs: [], moves_surplus: ["TE", "QB"] }),
    "Moves TE / QB surplus you can spare.",
  );
  assert.equal(
    whyThisHelpsText({ rationale: "Fallback rationale" }),
    "Fallback rationale",
  );
});

test("packageSalaryTotal prefers payload then roster row", () => {
  assert.equal(
    packageSalaryTotal(
      [{ player_id: "a", salary: 12 }, { player_id: "b" }],
      { b: { salary: 8 } },
    ),
    20,
  );
  assert.equal(packageSalaryTotal([], {}), 0);
});

test("ideaCapImpact nets receive minus send", () => {
  const impact = ideaCapImpact(
    {
      send: [{ player_id: "a", salary: 10 }],
      receive: [{ player_id: "b", salary: 18 }],
    },
    {},
  );
  assert.deepEqual(impact, { sendSal: 10, recvSal: 18, net: 8 });
});

test("formatIdeaCapNet tones committed vs freed", () => {
  assert.deepEqual(formatIdeaCapNet(0), { text: "Even committed", tone: "" });
  assert.equal(formatIdeaCapNet(12).text, "+$12 committed");
  assert.equal(formatIdeaCapNet(12).tone, "hub-value-delta-neg");
  assert.equal(formatIdeaCapNet(-5).text, "$5 freed");
  assert.equal(formatIdeaCapNet(-5).tone, "hub-value-delta-pos");
});
