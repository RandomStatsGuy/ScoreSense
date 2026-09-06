import test from "node:test";
import assert from "node:assert/strict";
import {
  availabilityBestHeading,
  availabilityChip,
  availabilityEmptyBest,
  availabilityHeading,
  availabilityHoursHint,
  availabilityLockLabel,
  availabilitySaveLabel,
  availabilityStateNote,
  availabilityUnsavedHint,
  availabilitySupport,
  bestSlotLines,
  calendarTodayIso,
  firstSelectableDate,
  formatHourLabel,
  groupDatesByMonth,
  heatTone,
  isSlotCurrentOrFuture,
  peopleLine,
  preferDateStrip,
  slotKey,
  slotToWall,
  slotsEqual,
  visibleHoursForDate,
  wallToSlot,
  availabilityTimezone,
  availabilityLockHourLabel,
  availabilityStatusChip,
  formatLockedNightDisclosure,
  leagueTimeLabel,
} from "./draftAvailabilityPresentation.js";

test("availability copy names the calendar consequence", () => {
  assert.equal(availabilityHeading(), "When can you draft?");
  assert.equal(availabilityBestHeading(), "Nights that already overlap");
  assert.match(availabilityEmptyBest(), /overlapping nights|Lock a night/i);
  assert.match(availabilityHoursHint({ canEdit: true }), /Tap hours/i);
  assert.match(availabilitySupport({ state: "open" }), /same nights/i);
  assert.match(availabilitySupport({ state: "upcoming" }), /31 days/i);
  assert.match(availabilitySupport({ state: "closed" }), /day before kickoff/i);
  assert.match(availabilitySupport({ locked: true }), /locked/i);
  assert.equal(availabilityChip({ state: "open", submitted: 3, teamCount: 12 }), "3 marked");
  assert.equal(availabilityChip({ locked: true, submitted: 3, teamCount: 12 }), "Night locked");
  assert.equal(availabilityLockLabel({}), "Lock this night");
  assert.equal(availabilityLockLabel({ locked: true }), "Locked in");
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
  assert.equal(availabilityUnsavedHint(), "Unsaved until you save.");
  assert.doesNotMatch(availabilityUnsavedHint(), /Submit|Draft Hub|permission/i);
});

test("dates group by month for one calendar", () => {
  const groups = groupDatesByMonth(["2026-08-30", "2026-08-31", "2026-09-01"]);
  assert.equal(groups.length, 2);
  assert.match(groups[0].label, /August/i);
  assert.equal(groups[0].dates.length, 2);
  assert.match(groups[1].label, /September/i);
});

test("calendar keeps only current and future hours", () => {
  assert.equal(isSlotCurrentOrFuture("2026-09-01", 18, "2026-09-02", 16), false);
  assert.equal(isSlotCurrentOrFuture("2026-09-02", 14, "2026-09-02", 16), false);
  assert.equal(isSlotCurrentOrFuture("2026-09-02", 16, "2026-09-02", 16), true);
  assert.equal(isSlotCurrentOrFuture("2026-09-03", 12, "2026-09-02", 22), true);
  assert.deepEqual(
    visibleHoursForDate("2026-09-02", [12, 14, 16, 18, 22], "2026-09-02", 16),
    [16, 18, 22],
  );
  assert.equal(firstSelectableDate(["2026-09-02", "2026-09-03"], [12, 18], "2026-09-02", 20), "2026-09-03");
  assert.equal(preferDateStrip(["2026-09-02", "2026-09-03"]), true);
  assert.equal(preferDateStrip(Array.from({ length: 20 }, (_, i) => `2026-08-${String(i + 10).padStart(2, "0")}`)), false);
  assert.equal(slotToWall("2026-09-02", 19), "2026-09-02T19:00");
  assert.deepEqual(wallToSlot("2026-09-02T19:00"), { date: "2026-09-02", hour: 19 });
  assert.equal(availabilityTimezone(""), "America/New_York");
  assert.equal(availabilityTimezone(null), "America/New_York");
  assert.equal(availabilityTimezone("America/Los_Angeles"), "America/Los_Angeles");
  assert.match(calendarTodayIso(new Date("2026-09-02T20:00:00Z"), "UTC"), /2026-09-02/);
  assert.equal(availabilityLockHourLabel({ date: "2026-09-05", hour: 19 }), "Lock Sat 7 p.m.");
  assert.equal(leagueTimeLabel("America/New_York"), "League time: Eastern");
  assert.equal(availabilityStatusChip({ locked: true }), "Night locked");
  assert.match(formatLockedNightDisclosure("2026-09-05T23:00:00.000Z"), /Move it/);
});
