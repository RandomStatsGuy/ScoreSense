import test from "node:test";
import assert from "node:assert/strict";
import { rosterStateForCapabilities, normalizeRosterState } from "./rosterBoardState.js";
import { capabilitiesFromRules } from "./leagueCapabilities.js";
import { rosterBoardRows, rosterVisibleRows } from "./leagueRostersPresentation.js";
for (const draft_type of ["snake", "linear"]) test(`${draft_type}: old salary filters cannot hide active players`, () => {
  const state = rosterStateForCapabilities(normalizeRosterState({view:"deals",value:"above",sort:"salary",page:3,teamId:"a"}), capabilitiesFromRules({draft_type}).uses_salaries);
  const roster = Array.from({length:24}, (_,i) => ({player_id:String(i),player_name:`Player ${i}`,salary:0,fair_value:i%2 ? null : 10}));
  const rows = rosterBoardRows([{team:{id:"a"},roster}],state);
  assert.equal(state.view,"teams"); assert.equal(state.sort,"name");
  assert.equal(rosterVisibleRows(rows,state.view,state.page).length,24);
  assert.equal(state.teamId,"a");
});
test("salary leagues retain comparison preferences", () => {
  const state = normalizeRosterState({view:"deals",value:"above",sort:"salary",page:3});
  assert.deepEqual(rosterStateForCapabilities(state,true),state);
});
