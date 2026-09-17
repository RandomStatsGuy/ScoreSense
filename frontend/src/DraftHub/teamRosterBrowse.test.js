import test from "node:test";
import assert from "node:assert/strict";
import { rosterSelection, rosterVisibleRows, rosterBoardRows } from "./leagueRostersPresentation.js";
const rows = Array.from({ length: 24 }, (_, i) => ({ ownerTeamId: "a", player_id: String(i), player_name: `Player ${i}`, salary: 12, fair_value: i === 2 ? null : 8 }));
test("a fresh board or stale selection never opens the first player's contract", () => {
  assert.equal(rosterSelection(rows, null, false), null);
  assert.equal(rosterSelection(rows, "a:gone", false), null);
  assert.equal(rosterSelection([], "a:0", false), null);
});
test("only an explicit visible player selection opens details", () => {
  assert.equal(rosterSelection(rows, "a:3", false), rows[3]);
  assert.equal(rosterSelection(rows, "a:3", true), null);
  assert.equal(rosterSelection(rows.slice(8), "a:3", false), null);
});
test("team rosters show every active player while comparisons retain eight-row paging", () => {
  assert.equal(rosterVisibleRows(rows, "teams", 2).length, 24);
  assert.deepEqual(rosterVisibleRows(rows, "deals", 1), rows.slice(8, 16));
  const blocks = [{team: {id: "a"}, roster: rows}, {team: {id: "b"}, roster: [{player_id: "other"}]}];
  const roster = rosterBoardRows(blocks, { view: "teams", teamId: "a", sort: "name" });
  assert.equal(roster.length, 24);
  assert.ok(roster.some(row => row.fair_value === null));
  assert.ok(roster.every(row => row.ownerTeamId === "a"));
});
