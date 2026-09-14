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
    ["current", "historic", "corrections", "members", "access"],
  );
  assert.deepEqual(
    visibleOfficeTabs(true).map((tab) => tab.label),
    ["Contracts", "Salary sheets", "Corrections", "Members", "Access & imports"],
  );
  assert.equal(visibleOfficeTabs(true).some((tab) => tab.type === "label"), false);
  assert.equal(visibleOfficeTabs(false).length, 0);
  assert.equal(isOfficeTabAllowed("chat", true), false);
  assert.equal(defaultOfficeTab(true), "current");
});

test("no-money roster management swaps Contracts for Roster moves", () => {
  const caps = { uses_contracts: false, uses_salaries: false };
  assert.deepEqual(
    visibleOfficeTabs(true, caps).map((tab) => tab.id),
    ["rosters", "members", "access"],
  );
  assert.deepEqual(
    visibleOfficeTabs(true, caps).map((tab) => tab.label),
    ["Roster moves", "Members", "Access & imports"],
  );
  assert.equal(isOfficeTabAllowed("current", true, caps), false);
  assert.equal(isOfficeTabAllowed("rosters", true, caps), true);
  // Staff land on roster work, not the members list.
  assert.equal(defaultOfficeTab(true, caps), "rosters");
});

test("salary leagues never see Roster moves — Contracts already carries it", () => {
  const caps = { uses_contracts: true, uses_salaries: true };
  assert.equal(visibleOfficeTabs(true, caps).some((tab) => tab.id === "rosters"), false);
  assert.equal(isOfficeTabAllowed("rosters", true, caps), false);
  // Default capabilities (undefined) behave like a salary league.
  assert.equal(visibleOfficeTabs(true).some((tab) => tab.id === "rosters"), false);
});
