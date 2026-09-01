import assert from "node:assert/strict";
import test from "node:test";
import { hubTeamInitialsName, hubTeamLabel, hubTeamParts } from "./hubTeamLabel.js";

test("hubTeamLabel leads with owner and can list the team", () => {
  const team = { name: "White Supremacists", sleeper_team_name: "White Supremacists", owner_name: "Caleb K" };
  assert.deepEqual(hubTeamParts(team), { owner: "Caleb K", team: "White Supremacists" });
  assert.equal(hubTeamLabel(team), "Caleb K · White Supremacists");
  assert.equal(hubTeamLabel(team, { includeTeam: false }), "Caleb K");
});

test("hubTeamLabel does not show team names exclusively when an owner exists", () => {
  const team = { name: "Daddio of the Pandio", owner_name: "Colby L" };
  assert.notEqual(hubTeamLabel(team), "Daddio of the Pandio");
  assert.match(hubTeamLabel(team), /^Colby L/);
});

test("hubTeamLabel falls back to the team nickname when no owner is known", () => {
  assert.equal(hubTeamLabel({ sleeper_team_name: "Panda Fraud", name: "Commissioner" }), "Panda Fraud");
  assert.equal(hubTeamLabel({ name: "Bot Alpha" }), "Bot Alpha");
});

test("hubTeamInitialsName uses the owner, not the combined Owner · Team label", () => {
  const team = { name: "White Supremacists", sleeper_team_name: "White Supremacists", owner_name: "Caleb K" };
  assert.equal(hubTeamLabel(team), "Caleb K · White Supremacists");
  assert.equal(hubTeamInitialsName(team), "Caleb K");
  assert.equal(hubTeamInitialsName({ name: "Panda Fraud" }), "Panda Fraud");
});
