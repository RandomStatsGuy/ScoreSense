import test from "node:test";
import assert from "node:assert/strict";
import {
  availabilityBestHeading,
  availabilityChip,
  availabilityEmptyBest,
  availabilityHeading,
  availabilityHoursHint,
  availabilitySaveLabel,
  availabilityStateNote,
  availabilitySupport,
  bestSlotLines,
  formatHourLabel,
  groupDatesByMonth,
  heatTone,
  peopleLine,
  slotKey,
  slotsEqual,
} from "./draftAvailabilityPresentation.js";

test("availability copy names the calendar consequence", () => {
  assert.equal(availabilityHeading(), "When can you draft?");
  assert.equal(availabilityBestHeading(), "Nights that already overlap");
  assert.match(availabilityEmptyBest(), /starting point/i);
  assert.match(availabilityHoursHint({ canEdit: true }), /Tap the hours/i);
  assert.match(availabilitySupport({ state: "open" }), /same calendar/i);
  assert.match(availabilitySupport({ state: "upcoming" }), /31 days/i);
  assert.match(availabilitySupport({ state: "closed" }), /day before kickoff/i);
  assert.equal(availabilityChip({ state: "open", submitted: 3, teamCount: 12 }), "3 marked");
  assert.match(availabilityStateNote({
    state: "open",
    opens_on: "2026-08-10",
    closes_on: "2026-09-09",
    first_game_date: "2026-09-10",
  }), /Open through/i);
});

test("hour and overlap helpers stay compact", () => {
  assert.equal(formatHourLabel(20), "8 p.m.");
  assert.equal(formatHourLabel(12), "12 p.m.");
  assert.equal(slotKey("2026-08-22", 20), "2026-08-22|20");
  assert.equal(slotsEqual([{ date: "2026-08-22", hour: 20 }], [{ hour: 20, date: "2026-08-22" }]), true);
  assert.equal(heatTone(0, 4), "empty");
  assert.equal(heatTone(4, 4), "best");
  assert.equal(heatTone(2, 4), "strong");
  const lines = bestSlotLines([
    { date: "2026-08-22", hour: 20, count: 8, people: [{ name: "Ada" }] },
  ]);
  assert.match(lines[0].label, /Aug 22/i);
  assert.match(lines[0].label, /8 p.m./);
  assert.equal(peopleLine(["Ada", "Bea"]), "Ada and Bea");
  assert.equal(availabilitySaveLabel({ dirty: true }), "Save times");
});

test("dates group by month for one calendar", () => {
  const groups = groupDatesByMonth(["2026-08-30", "2026-08-31", "2026-09-01"]);
  assert.equal(groups.length, 2);
  assert.match(groups[0].label, /August/i);
  assert.equal(groups[0].dates.length, 2);
  assert.match(groups[1].label, /September/i);
});
