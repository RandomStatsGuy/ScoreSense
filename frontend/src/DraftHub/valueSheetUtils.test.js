import test from "node:test";
import assert from "node:assert/strict";
import { filterAndSortRows } from "./valueSheetUtils.js";

test("missing metrics sort last in both directions, with true zero preserved", () => {
  const rows = [
    { player: "Missing", fair_value: null, per_game_proj: null },
    { player: "Fallback", fair_value: 31, per_game_proj: 0 },
    { player: "Useful", fair_value: 16, per_game_proj: 13.2 },
  ];
  const names = (key, dir) => filterAndSortRows(rows, { sortKey: key, sortDir: dir }).map(r => r.player);
  assert.deepEqual(names("fair_value", "desc"), ["Fallback", "Useful", "Missing"]);
  assert.deepEqual(names("fair_value", "asc"), ["Useful", "Fallback", "Missing"]);
  assert.deepEqual(names("per_game_proj", "desc"), ["Useful", "Fallback", "Missing"]);
  assert.deepEqual(names("per_game_proj", "asc"), ["Fallback", "Useful", "Missing"]);
});
