import test from "node:test";
import assert from "node:assert/strict";
import { rosterEstimateContext, rosterDifference, rosterDifferenceLabel, rosterBoardRows } from "./leagueRostersPresentation.js";
test("minimum-bid values remain visible on team rosters without an above/below comparison", () => {
  const floor = { player_id: "1", salary: 12, fair_value: 1, estimate_status: "minimum_bid" };
  const blocks = [{ team: { id: "a" }, roster: [floor] }];
  assert.equal(rosterDifference(floor), null);
  assert.equal(rosterDifferenceLabel(floor), "Minimum bid");
  assert.equal(rosterBoardRows(blocks).length, 0);
  assert.equal(rosterBoardRows(blocks, { view: "teams" }).length, 1);
  assert.equal(rosterBoardRows(blocks, { view: "teams", value: "above" }).length, 0);
  assert.equal(rosterDifference({ ...floor, estimate_status: "projection" }), 11);
});
test("context labels a real saved calculation time and never substitutes the current time", () => {
  assert.match(rosterEstimateContext({ season: 2026, built_at: "2026-09-15T13:04:00Z" }), /2026 season estimates.*Sep 15, 2026.*1:04 PM UTC/);
  for (const built_at of [null, "", "invalid"]) assert.match(rosterEstimateContext({ season: 2026, built_at }), /calculation time unavailable/);
  assert.match(rosterEstimateContext(null), /Season not provided/);
});
