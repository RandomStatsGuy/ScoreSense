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
  assert.match(staff.purpose, /Admin workspace/i);
  assert.match(staff.purpose, /separate/i);
  assert.equal(staff.title, "Commissioner");
});

test("commissionerIntro keeps members on chat-only framing", () => {
  const member = commissionerIntro(false);
  assert.match(member.purpose, /League chat/i);
  assert.doesNotMatch(member.purpose, /Admin workspace/i);
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

test("tabsWithGroupLabels inserts Contracts & sheets and Admin access labels", () => {
  const items = tabsWithGroupLabels([
    { id: "chat", label: "Chat", group: "chat" },
    { id: "current", label: "Contracts", group: "contracts" },
    { id: "historic", label: "Sheets", group: "contracts" },
    { id: "members", label: "Members", group: "membership" },
    { id: "access", label: "Access", group: "access" },
  ]);
  const labels = items.filter((x) => x.type === "label").map((x) => x.label);
  assert.deepEqual(labels, ["Contracts & sheets", "League", "Admin access"]);
  assert.equal(items.filter((x) => x.type === "tab").length, 5);
});
