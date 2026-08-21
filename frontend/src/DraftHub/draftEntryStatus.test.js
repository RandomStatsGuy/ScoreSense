import test from "node:test";
import assert from "node:assert/strict";
import {
  draftEntryPhase,
  draftFormatLabel,
  draftParticipantSummary,
  formatDraftWait,
  utcIsoToWall,
} from "./draftEntryStatus.js";

test("draftFormatLabel uses salary cap auction when auction rules exist", () => {
  assert.equal(draftFormatLabel({ auction: { min_bid: 1 }, salary_cap: 200 }), "Salary cap auction");
  assert.equal(draftFormatLabel(null), "Salary cap auction");
  assert.equal(draftFormatLabel({ salary_cap: 200 }), "Auction");
});

test("draftEntryPhase maps season and practice states", () => {
  assert.equal(draftEntryPhase({ draftCompleted: true }).label, "In season");
  assert.equal(draftEntryPhase({ testMode: true }).id, "practice");
  assert.equal(
    draftEntryPhase({ leagueId: "abc", inDraftSetup: true }).label,
    "Pre-draft · ready",
  );
  assert.equal(draftEntryPhase({ usingHubLeague: true }).id, "pre_draft");
  assert.equal(draftEntryPhase({}).label, "Solo prep");
});

test("draftParticipantSummary excludes bots when humans exist", () => {
  const withHumans = draftParticipantSummary({
    teams: [
      { id: "1", is_bot: false },
      { id: "2", is_bot: false },
      { id: "b", is_bot: true },
    ],
    teamCount: 12,
    hasLeague: true,
  });
  assert.equal(withHumans.label, "2 / 12");
  assert.match(withHumans.detail, /open/);

  const solo = draftParticipantSummary({
    hasLeague: false,
    botCount: 7,
    teamCount: 12,
  });
  assert.equal(solo.label, "8 / 12");
});

test("formatDraftWait and utcIsoToWall", () => {
  assert.equal(formatDraftWait(30), "30s");
  assert.equal(formatDraftWait(120), "2m");
  assert.match(formatDraftWait(3700), /1h/);
  const wall = utcIsoToWall("2026-09-01T00:00:00.000Z", "UTC");
  assert.equal(wall, "2026-09-01T00:00");
});
