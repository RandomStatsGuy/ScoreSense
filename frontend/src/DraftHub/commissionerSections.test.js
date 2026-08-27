import assert from "node:assert/strict";
import test from "node:test";
import {
  commissionerIntro,
  sheetsDefaultHint,
  sheetsGuideCopy,
  shouldAutoOpenSheetsGuide,
  markSheetsGuideSeen,
  SHEETS_GUIDE_STORAGE_KEY,
  tabsWithGroupLabels,
} from "./commissionerSections.js";

test("commissionerIntro marks admin boundary for staff", () => {
  const staff = commissionerIntro(true);
  assert.match(staff.purpose, /League-wide contracts/i);
  assert.equal(staff.title, "Roster management");
});

test("commissionerIntro keeps the member framing read-only", () => {
  const member = commissionerIntro(false);
  assert.match(member.purpose, /stay with commissioners/i);
});

test("sheetsGuideCopy keeps caveat out of default hint", () => {
  assert.doesNotMatch(sheetsDefaultHint(), /not live mid-season/i);
  const guide = sheetsGuideCopy(2026);
  assert.match(guide.paragraphs[0], /2026 sheet/);
  assert.match(guide.paragraphs[0], /not a live mid-season/i);
});

test("sheets guide first-use uses localStorage flag", () => {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
  };
  assert.equal(shouldAutoOpenSheetsGuide(storage), true);
  markSheetsGuideSeen(storage);
  assert.equal(store.get(SHEETS_GUIDE_STORAGE_KEY), "1");
  assert.equal(shouldAutoOpenSheetsGuide(storage), false);
});

test("tabsWithGroupLabels inserts roster, records, and league-operation labels", () => {
  const items = tabsWithGroupLabels([
    { id: "current", label: "Contracts", group: "rosters" },
    { id: "historic", label: "Salary sheets", group: "records" },
    { id: "members", label: "Members", group: "league" },
    { id: "access", label: "Access & imports", group: "league" },
  ]);
  const labels = items.filter((x) => x.type === "label").map((x) => x.label);
  assert.deepEqual(labels, ["Rosters", "Records", "League operations"]);
  assert.equal(items.filter((x) => x.type === "tab").length, 4);
});
