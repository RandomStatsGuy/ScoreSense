import assert from "node:assert/strict";
import test from "node:test";
import {
  allowUnsavedNavigation,
  isHubRulesPath,
  setUnsavedNavigationBlocker,
} from "./unsavedNavigation.js";

test("isHubRulesPath matches the Rules destination only", () => {
  assert.equal(isHubRulesPath("/hub/rules"), true);
  assert.equal(isHubRulesPath("/hub/rules?x=1"), true);
  assert.equal(isHubRulesPath("/hub/trades"), false);
  assert.equal(isHubRulesPath("/hub/rules/extra"), false);
});

test("allowUnsavedNavigation asks the registered blocker", async () => {
  setUnsavedNavigationBlocker(async (path) => path === "/hub/home");
  assert.equal(await allowUnsavedNavigation("/hub/home"), true);
  assert.equal(await allowUnsavedNavigation("/hub/trades"), false);
  setUnsavedNavigationBlocker(null);
  assert.equal(await allowUnsavedNavigation("/hub/trades"), true);
});
