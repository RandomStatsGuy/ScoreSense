import test from "node:test";
import assert from "node:assert/strict";
import { formatDraftEvent, buildRosterCapacity, canAcquireAtPosition, unmetMinPositions, pinNeedPositions } from "./draftRoomHelpers.js";
import { auctionAwardContractLabel } from "./rosterFormat.js";

test("formatDraftEvent describes mid-draft trades", () => {
  assert.equal(
    formatDraftEvent({ event_type: "trade", payload: { summary: "A ↔ B · Puka (A → B)" } }),
    "Trade · A ↔ B · Puka (A → B)",
  );
  assert.equal(formatDraftEvent({ event_type: "trade", payload: {} }), "Trade completed");
});

test("formatDraftEvent describes nomination timeout skip", () => {
  assert.equal(
    formatDraftEvent({
      event_type: "pass",
      payload: { reason: "nomination_timeout", team_name: "Bob" },
    }),
    "Bob skipped — nomination clock expired",
  );
});

test("formatDraftEvent describes commissioner force nominate", () => {
  assert.equal(
    formatDraftEvent({
      event_type: "force_nominate",
      payload: { player_name: "Puka", team_name: "Bob" },
    }),
    "Commissioner nominated Puka for Bob",
  );
  assert.match(
    formatDraftEvent({
      event_type: "nominate",
      payload: {
        player_name: "Puka",
        position: "WR",
        forced: true,
        nominating_team_name: "Bob",
      },
    }),
    /force-nominated for Bob/,
  );
});

test("formatDraftEvent describes pause resume and commissioner skip", () => {
  assert.equal(formatDraftEvent({ event_type: "pause", payload: {} }), "Draft paused");
  assert.equal(formatDraftEvent({ event_type: "resume", payload: {} }), "Draft resumed");
  assert.equal(
    formatDraftEvent({
      event_type: "pass",
      payload: { reason: "commissioner_skip", team_name: "Bob" },
    }),
    "Bob skipped by commissioner",
  );
});

test("auctionAwardContractLabel describes locked rookie and vet deals", () => {
  assert.equal(
    auctionAwardContractLabel({
      contract_type: "rookie",
      contract_years: 2,
      salary: 39,
      salary_schedule: [39, 39],
    }),
    "Rookie deal · 2y · $39 → $39",
  );
  assert.equal(
    auctionAwardContractLabel({
      contract_type: "veteran",
      contract_years: 2,
      salary: 20,
      step_up_per_year: 5,
      salary_schedule: [20, 25],
    }),
    "Veteran deal · 2y · $20 → $25",
  );
});

test("buildRosterCapacity ignores expirees and flags below_min", () => {
  const rules = {
    roster: {
      wr: { min: 0, max: 8 },
      te: { min: 1, max: 3 },
    },
  };
  const cap = buildRosterCapacity(rules, [
    { player_id: "keep", position: "WR", source: "draft", contract_years: 1 },
    { player_id: "expire", position: "TE", source: "sheet", contract_years: 1 },
  ]);
  assert.equal(cap.WR.count, 1);
  assert.equal(cap.TE.count, 0);
  assert.equal(cap.TE.below_min, true);
  assert.deepEqual(unmetMinPositions(cap), ["TE"]);
});

test("pinNeedPositions lifts unmet-min positions into the visible window", () => {
  const rows = [
    { player_id: "wr1", position: "WR" },
    { player_id: "wr2", position: "WR" },
    { player_id: "te1", position: "TE" },
    { player_id: "wr3", position: "WR" },
  ];
  const visible = pinNeedPositions(rows, ["TE"], 3);
  assert.deepEqual(visible.map((r) => r.player_id), ["te1", "wr1", "wr2"]);
});

test("buildRosterCapacity relaxLimits clears at_max and below_min", () => {
  const rules = {
    roster: {
      wr: { min: 0, max: 1 },
      te: { min: 1, max: 3 },
    },
  };
  const roster = [
    { player_id: "keep", position: "WR", source: "draft", contract_years: 1 },
  ];
  const blocked = buildRosterCapacity(rules, roster);
  assert.equal(blocked.WR.at_max, true);
  assert.equal(blocked.TE.below_min, true);
  assert.equal(canAcquireAtPosition(blocked, "WR"), false);

  const relaxed = buildRosterCapacity(rules, roster, { relaxLimits: true });
  assert.equal(relaxed.WR.at_max, false);
  assert.equal(relaxed.TE.below_min, false);
  assert.equal(canAcquireAtPosition(relaxed, "WR", { relaxLimits: true }), true);
});
