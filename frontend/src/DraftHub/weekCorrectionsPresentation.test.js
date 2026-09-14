import assert from "node:assert/strict";
import test from "node:test";
import { correctionTeamRows } from "./weekCorrectionsPresentation.js";
import { buildAppPath, parseAppPath } from "../routes.js";

test("missing history stays empty instead of copying current players", () => {
  assert.deepEqual(correctionTeamRows({ teams: [{ id: "first" }], roster: [{ player_id: "today" }] }),
    [{ team_id: "first", players: [] }]);
});

test("historical players stay attached to their recorded team", () => {
  const result = correctionTeamRows({ teams: [{ id: "first" }, { id: "second" }],
    lineups: [{ team_id: "second", player_id: "past", position: "QB", slot: "QB1" }] });
  assert.equal(result[0].players.length, 0);
  assert.equal(result[1].players[0].player_id, "past");
});

test("Corrections has a stable roster-management URL", () => {
  assert.equal(buildAppPath({ view: "hub", hubSubView: "office", officeTab: "corrections" }), "/hub/roster-management/corrections");
  assert.equal(parseAppPath("/hub/roster-management/corrections").officeTab, "corrections");
});
