import assert from "node:assert/strict";
import test from "node:test";
import { insightsIdentityParts, scoringSummary, spendComparisonRows } from "./insightsPresentation.js";

test("season names lead with the team; career names lead with mapped manager", () => {
  const row = {team_name:"Panda · Express",owner_name:"Josh C"};
  assert.deepEqual(insightsIdentityParts(row, null, true), {primary:"Panda · Express",secondary:"Josh C"});
  assert.deepEqual(insightsIdentityParts(row), {primary:"Josh C",secondary:"Panda · Express"});
  assert.deepEqual(insightsIdentityParts({team_name:"Pandas"}, {Pandas:"Josh C"}, true), {primary:"Pandas",secondary:"Josh C"});
  assert.deepEqual(insightsIdentityParts({team_name:"Josh C",owner_name:"Josh C"}), {primary:"Josh C",secondary:""});
});

test("scoring separates total and average winners and weights the league by scored weeks", () => {
  const summary = scoringSummary({standings:[
    {owner_id:"a",team_name:"Total leader",owner_name:"Josh C",total_points:500,weeks_scored:5},
    {owner_id:"b",team_name:"Average leader",total_points:400,weeks_scored:2},
    {owner_id:"c",team_name:"Unplayed",total_points:999,weeks_scored:0},
    {owner_id:"d",total_points:null,weeks_scored:3},
    {owner_id:"e",total_points:0,weeks_scored:1}],
    weeks:[{week:1,teams:[{owner_id:"a",team_name:"Total leader",points:250},{owner_id:"b",points:null}]}]});
  assert.equal(summary.rows[0].owner_id,"a");
  assert.equal(summary.highestAverage.owner_id,"b");
  assert.equal(summary.leagueAverage,112.5);
  assert.equal(summary.bestWeek.owner_name,"Josh C");
  assert.equal(summary.rows.length,3);
  assert.equal(summary.rows[2].total_points,0);
});

test("missing production stays missing and recorded zero still wins a zero week", () => {
  assert.equal(scoringSummary({}).leagueAverage,null);
  assert.equal(scoringSummary({weeks:[{teams:[{points:null},{points:"invalid"}]}]}).bestWeek,null);
  assert.equal(scoringSummary({weeks:[{teams:[{points:0}]}]}).bestWeek.points,0);
});

test("spending ranks the chosen position and respects the saved average cap share", () => {
  const teams=[{team_id:"a",committed:200,pct_committed:60,spend_by_position:{QB:5},pct_by_position:{QB:2}},
    {team_id:"b",committed:180,pct_committed:90,spend_by_position:{QB:40},pct_by_position:{QB:20}}];
  assert.equal(spendComparisonRows(teams,"all","dollars")[0].team_id,"a");
  assert.equal(spendComparisonRows(teams,"all","pct")[0].team_id,"b");
  assert.equal(spendComparisonRows(teams,"QB","dollars")[0].team_id,"b");
  assert.equal(teams[0].team_id,"a");
});


test("career weekly highlights use saved awards when chart weeks are omitted", () => {
  const summary = scoringSummary({weeks:[],awards:[{id:"weekly_nuke",amount:212.5,owner_name:"Josh C"}]});
  assert.equal(summary.bestWeek.points,212.5);
  assert.equal(summary.bestWeek.owner_name,"Josh C");
  assert.equal(scoringSummary({awards:[{id:"weekly_nuke",amount:null}]}).bestWeek,null);
});
