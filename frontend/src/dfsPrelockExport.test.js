import assert from "node:assert/strict";
import test from "node:test";
import { validatePrelockExport } from "./dfsPrelockExport.js";

const now = Date.parse("2026-10-11T17:00:00Z");
const row = (player_id, team) => ({ player_id, team });
const selected = [{ lineup: [row("qb", "BUF"), row("wr", "KC"), row("te", "LA")] }];
const source = kickoff => ({ settings: { game_schedule: [
  { game_id: "game", home: "KC", away: "BUF", kickoff_et: kickoff },
  { game_id: "late", home: "LAR", away: "SEA", kickoff_et: "2026-10-11T20:25:00Z" },
] } });

test("T27 known started games block selected pre-lock exports with actionable copy", () => {
  assert.throws(() => validatePrelockExport(source("2026-10-11T12:59:59-04:00"), selected, { now }),
    /pre-lock.*started.*late swap/i);
});

test("T27 future timezone-bearing schedule is disclosed evidence without claiming verified locks", () => {
  assert.deepEqual(validatePrelockExport(source("2026-10-11T13:00:01-04:00"), [...selected, ...selected], { now }),
    { status: "known_not_started", knownPlayerCount: 3, unknownPlayerCount: 0 });
});

test("T27 unknown, absent, malformed and timezone-free dates remain explicitly unknown", () => {
  for (const kickoff of [undefined, "", "10/11/2026 1:00PM ET", "2026-10-11T13:00:00", "2026-02-30T13:00:00Z"]) {
    assert.deepEqual(validatePrelockExport(source(kickoff), selected, { now }),
      { status: "unknown", knownPlayerCount: 1, unknownPlayerCount: 2 });
  }
  assert.deepEqual(validatePrelockExport(null, selected, { now }),
    { status: "unknown", knownPlayerCount: 0, unknownPlayerCount: 3 });
});

test("T27 exact kickoff boundary blocks and fresh checks catch time elapsed since preparation", () => {
  const saved = source("2026-10-11T13:00:00-04:00");
  assert.equal(validatePrelockExport(saved, selected, { now: now - 1 }).status, "known_not_started");
  assert.throws(() => validatePrelockExport(saved, selected, { now }), /started/i);
});

test("T27 collected schedules inspect selected players without blocking unrelated unassigned games", () => {
  const sources = [source("2026-10-11T12:00:00-04:00"), { settings: {} }];
  assert.deepEqual(validatePrelockExport(sources, [{ lineup: [row("te", "LA")] }], { now }),
    { status: "known_not_started", knownPlayerCount: 1, unknownPlayerCount: 0 });
  assert.throws(() => validatePrelockExport(sources, selected, { now }), /started/i);
});
