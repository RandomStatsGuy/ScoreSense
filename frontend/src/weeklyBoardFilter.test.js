import assert from "node:assert/strict";
import test from "node:test";
import {
  filterWeeklyBoardRows,
  weeklyActiveFilterChips,
  weeklyResultLabel,
  weeklyWindowRange,
} from "./weeklyBoardFilter.js";

const rows = [
  { Player: "Lamar Jackson", Team: "BAL", player_id: "lj", rank_delta: 0 },
  { Player: "Josh Allen", Team: "BUF", player_id: "ja", rank_delta: 5, p50_delta: 2, movement_material: true },
  { Player: "Patrick Mahomes", Team: "KC", player_id: "pm", rank_delta: -4, p50_delta: -2, movement_material: true },
];

test("filterWeeklyBoardRows searches name and team", () => {
  assert.equal(filterWeeklyBoardRows(rows, { search: "lamar" }).length, 1);
  assert.equal(filterWeeklyBoardRows(rows, { search: "buf" })[0].Player, "Josh Allen");
  assert.equal(filterWeeklyBoardRows(rows, { teamsFilter: ["KC"] }).length, 1);
});

test("filterWeeklyBoardRows applies movement after search", () => {
  const risers = filterWeeklyBoardRows(rows, {
    showFilters: true,
    movementFilter: "risers",
  });
  assert.equal(risers.length, 1);
  assert.equal(risers[0].player_id, "ja");
});

test("weeklyResultLabel names the count and selection", () => {
  assert.equal(weeklyResultLabel(1), "1 player");
  assert.equal(weeklyResultLabel(78), "78 players");
  assert.equal(weeklyResultLabel(12, 2), "12 results · 2 selected");
});

test("weeklyActiveFilterChips lists only committed extras", () => {
  assert.deepEqual(weeklyActiveFilterChips({ movementFilter: "all" }), []);
  const chips = weeklyActiveFilterChips({
    search: "Lamar",
    teams: ["BAL"],
    movementFilter: "risers",
    movementFilters: [{ id: "risers", label: "Risers" }],
  });
  assert.deepEqual(chips.map((c) => c.label), ["Lamar", "BAL", "Risers"]);
});

test("weeklyWindowRange keeps a short overscan window", () => {
  const slice = weeklyWindowRange({
    count: 78,
    scrollTop: 1080,
    viewportHeight: 700,
    rowHeight: 108,
    overscan: 4,
  });
  assert.ok(slice.end - slice.start < 30);
  assert.ok(slice.start > 0);
  assert.ok(slice.end < 78);
  assert.deepEqual(weeklyWindowRange({ count: 0 }), { start: 0, end: 0 });
});
