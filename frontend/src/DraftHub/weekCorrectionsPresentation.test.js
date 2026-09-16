import assert from "node:assert/strict";
import test from "node:test";
import { correctionTeamRows, correctionSlots, correctionSlotRows, assignCorrectionPlayer } from "./weekCorrectionsPresentation.js";
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


test("empty repeated and FLEX slots remain visible without creating player records", () => {
  const slots = correctionSlots({QB:1,RB:2,FLEX:1,K:0});
  const players = [{player_id:"one",position:"RB",slot:"RB2"}];
  const rows = correctionSlotRows(players, slots);
  assert.deepEqual(rows.map(row => row.id), ["QB1","RB1","RB2","FLEX1"]);
  assert.deepEqual(rows.filter(row => !row.player).map(row => row.id), ["QB1","RB1","FLEX1"]);
  assert.equal(players.length,1);
});

test("moving a starter leaves their old slot empty and benches the displaced player", () => {
  const old = [{player_id:"a",position:"RB",slot:"RB1"},{player_id:"b",position:"RB",slot:"FLEX1"}];
  const next = assignCorrectionPlayer(old,old[0],"FLEX1");
  assert.equal(next.find(row => row.player_id === "b").slot,"BN");
  assert.equal(correctionSlotRows(next,correctionSlots({RB:1,FLEX:1}))[0].player,null);
  assert.equal(old[0].slot,"RB1");
});

test("assigning a search result does not duplicate a prefixed historical player", () => {
  const rows = assignCorrectionPlayer([{player_id:"sleeper-123",slot:"BN"}],{player_id:"123"},"QB1");
  assert.equal(rows.length,1);
});
