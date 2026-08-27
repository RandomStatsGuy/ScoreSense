import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLiveRosterAddBody,
  isRosterReassignConflict,
  playerIdFromSuggestion,
} from "./liveRosterAdd.js";

test("playerIdFromSuggestion prefers Sleeper id", () => {
  assert.equal(
    playerIdFromSuggestion({ sleeper_player_id: "4039", player_id: "00-0035676" }),
    "4039",
  );
  assert.equal(playerIdFromSuggestion({ player_id: "00-0035676" }), "00-0035676");
  assert.equal(playerIdFromSuggestion({ player_name: "Nobody" }), "");
});

test("buildLiveRosterAddBody maps suggestion onto POST /roster payload", () => {
  const body = buildLiveRosterAddBody({
    suggestion: {
      sleeper_player_id: "4039",
      player_name: "Ja'Marr Chase",
      position: "WR",
      team: "CIN",
    },
    salary: 12,
    years: 2,
    contractType: "rookie",
    teamId: "team-1",
    force: true,
  });
  assert.equal(body.player_id, "4039");
  assert.equal(body.player_name, "Ja'Marr Chase");
  assert.equal(body.team, "CIN");
  assert.equal(body.position, "WR");
  assert.equal(body.salary, 12);
  assert.equal(body.contract_years, 2);
  assert.equal(body.contract_type, "rookie");
  assert.equal(body.team_id, "team-1");
  assert.equal(body.sleeper_player_id, "4039");
  assert.equal(body.force, true);
  assert.equal(body.staff_edit, true);
});

test("buildLiveRosterAddBody returns null without a player id or name", () => {
  assert.equal(
    buildLiveRosterAddBody({
      suggestion: { player_name: "Ghost" },
      salary: 1,
      years: 1,
      contractType: "veteran",
      teamId: "t",
    }),
    null,
  );
  assert.equal(
    buildLiveRosterAddBody({
      suggestion: { sleeper_player_id: "1" },
      salary: 1,
      years: 1,
      contractType: "veteran",
      teamId: "t",
    }),
    null,
  );
});

test("isRosterReassignConflict detects commissioner confirm 409 copy", () => {
  assert.equal(
    isRosterReassignConflict("Ja'Marr Chase is already on Alpha's roster. Confirm to reassign them to Disappointment."),
    true,
  );
  assert.equal(isRosterReassignConflict("Ja'Marr Chase is already on this roster"), false);
});
