import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultOfficeTab,
  isOfficeTabAllowed,
  visibleOfficeTabs,
} from "./hubOfficeTabs.js";

test("roster management contains commissioner operations and no chat tab", () => {
  assert.deepEqual(
    visibleOfficeTabs(true).map((tab) => tab.id),
    ["current", "historic", "members", "access"],
  );
  assert.deepEqual(
    visibleOfficeTabs(true).map((tab) => tab.label),
    ["Contracts", "Salary sheets", "Members", "Access & imports"],
  );
  assert.equal(visibleOfficeTabs(true).some((tab) => tab.type === "label"), false);
  assert.equal(visibleOfficeTabs(false).length, 0);
  assert.equal(isOfficeTabAllowed("chat", true), false);
  assert.equal(defaultOfficeTab(true), "current");
});
