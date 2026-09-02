import test from "node:test";
import assert from "node:assert/strict";
import {
  draftEntryPhase,
  draftFormatLabel,
  draftParticipantSummary,
  formatDraftWait,
  isPickDraft,
  joinWallDateTime,
  splitWallDateTime,
  utcIsoToWall,
} from "./draftEntryStatus.js";

test("draftFormatLabel uses salary cap auction when auction rules exist", () => {
  assert.equal(draftFormatLabel({ auction: { min_bid: 1 }, salary_cap: 200 }), "Salary cap auction");
  assert.equal(draftFormatLabel(null), "Salary cap auction");
  assert.equal(draftFormatLabel({ salary_cap: 200 }), "Auction");
  assert.equal(draftFormatLabel({ draft_type: "snake" }), "Snake draft");
  assert.equal(draftFormatLabel({ draft_type: "linear", auction: { min_bid: 1 } }), "Linear draft");
  assert.equal(isPickDraft({ draft_type: "snake" }), true);
  assert.equal(isPickDraft({ draft_type: "auction" }), false);
});

test("draftEntryPhase maps season and practice states", () => {
  assert.equal(draftEntryPhase({ draftCompleted: true }).label, "In season");
  assert.equal(draftEntryPhase({ testMode: true }).id, "practice");
  assert.equal(
    draftEntryPhase({ leagueId: "abc", inDraftSetup: true }).label,
    "Lobby open",
  );
  assert.equal(draftEntryPhase({ usingHubLeague: true }).id, "pre_draft");
  assert.equal(draftEntryPhase({}).label, "Solo prep");
});

test("draftParticipantSummary excludes bots when humans exist", () => {
  const withHumans = draftParticipantSummary({
    teams: [
      { id: "1", is_bot: false, user_sub: "a" },
      { id: "2", is_bot: false, user_sub: "b" },
      { id: "b", is_bot: true },
    ],
    teamCount: 12,
    hasLeague: true,
  });
  assert.equal(withHumans.label, "2 / 12");
  assert.match(withHumans.detail, /open/);

  const stubsUnclaimed = draftParticipantSummary({
    teams: [
      { id: "1", is_bot: false, user_sub: "a" },
      { id: "stub", is_bot: false },
    ],
    teamCount: 12,
    hasLeague: true,
  });
  assert.equal(stubsUnclaimed.label, "1 / 12");
  assert.equal(stubsUnclaimed.detail, "11 open");

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
  assert.deepEqual(splitWallDateTime(wall), { date: "2026-09-01", time: "00:00" });
  assert.equal(joinWallDateTime("2026-09-06", "19:00"), "2026-09-06T19:00");
});
