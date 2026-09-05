import assert from "node:assert/strict";
import test from "node:test";
import {
  commissionerIntro,
  sheetsDefaultHint,
  sheetsGuideCopy,
  shouldAutoOpenSheetsGuide,
  markSheetsGuideSeen,
  SHEETS_GUIDE_STORAGE_KEY,
} from "./commissionerSections.js";

test("commissionerIntro marks admin boundary for staff", () => {
  const staff = commissionerIntro(true);
  assert.match(staff.purpose, /wrong cut/i);
  assert.equal(staff.title, "Roster management");
});

test("commissionerIntro keeps the member framing read-only", () => {
  const member = commissionerIntro(false);
  assert.match(member.purpose, /Commissioner managed/i);
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
