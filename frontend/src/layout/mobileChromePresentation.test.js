import assert from "node:assert/strict";
import test from "node:test";
import {
  MOBILE_CHROME_COPY,
  chooseDestinationLabel,
  projectionDestinationItems,
  resolveMobileDestination,
  selectAndDismissDestination,
  toolDestinationItems,
} from "./mobileChromePresentation.js";

test("phone header names the destination, not the product area", () => {
  assert.equal(resolveMobileDestination({ view: "projections", projectionsTab: "weekly" }).title, "Weekly");
  assert.equal(resolveMobileDestination({ view: "projections", projectionsTab: "season" }).picker, "projections");
  assert.equal(resolveMobileDestination({ view: "tools", toolsTab: "dfs" }).title, "DFS");
  assert.equal(resolveMobileDestination({ view: "hub", hubTitle: "This Week" }).title, "This Week");
  assert.equal(resolveMobileDestination({ view: "hub", hubNeedsSignIn: true }).title, "Sign in");
  assert.equal(resolveMobileDestination({ view: "hub", hubNeedsSignIn: true }).picker, null);
  assert.equal(resolveMobileDestination({ view: "model" }).title, "Model accuracy");
});

test("destination picker copy names the goal, not Draft Hub", () => {
  assert.match(chooseDestinationLabel("Home"), /Home/);
  assert.doesNotMatch(MOBILE_CHROME_COPY.fantasySheet, /Draft Hub|Submit|permission/i);
  assert.equal(projectionDestinationItems()[0].hint, MOBILE_CHROME_COPY.weeklyHint);
  assert.equal(toolDestinationItems().length, 3);
});

test("tapping the current destination still dismisses the picker", () => {
  const calls = [];
  selectAndDismissDestination("weekly", (id) => calls.push(`select:${id}`), () => calls.push("close"));
  assert.deepEqual(calls, ["select:weekly", "close"]);
});
