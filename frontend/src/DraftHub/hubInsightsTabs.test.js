import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultInsightTab,
  isInsightTabAllowed,
  visibleInsightsTabs,
} from "./hubInsightsTabs.js";

test("salary leagues keep the Spend tab", () => {
  const caps = { uses_salaries: true, uses_contracts: true };
  assert.deepEqual(
    visibleInsightsTabs(true, caps).map((t) => t.id),
    ["overview", "cap", "scoring", "ownership"],
  );
  assert.equal(isInsightTabAllowed("cap", true, caps), true);
  // Legacy URLs still land on Spend.
  assert.equal(isInsightTabAllowed("salaries", true, caps), true);
});

test("no-money leagues drop Spend from Insights", () => {
  const caps = { uses_salaries: false, uses_contracts: false };
  assert.deepEqual(
    visibleInsightsTabs(true, caps).map((t) => t.id),
    ["overview", "scoring", "ownership"],
  );
  assert.equal(isInsightTabAllowed("cap", true, caps), false);
  // Legacy salary URLs must not sneak the tab back in.
  assert.equal(isInsightTabAllowed("salaries", true, caps), false);
  assert.equal(isInsightTabAllowed("contracts", true, caps), false);
  assert.equal(isInsightTabAllowed("desk", true, caps), false);
  assert.equal(defaultInsightTab(true, caps), "overview");
});

test("unknown capabilities behave like a salary league", () => {
  assert.equal(isInsightTabAllowed("cap", true), true);
  assert.equal(visibleInsightsTabs(true).length, 4);
});
