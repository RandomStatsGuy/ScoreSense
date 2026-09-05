import assert from "node:assert/strict";
import test from "node:test";
import { lockerWallPlayers } from "./lockerWall.js";

const roster = [
  { player_id: "a", player_name: "Alpha", salary: 40, roster_status: "active" },
  { player_id: "b", player_name: "Bravo", salary: 12, roster_status: "active" },
  { player_id: "c", player_name: "Cut", salary: 8, roster_status: "cut_before_draft" },
  { player_id: "d", player_name: "Delta", salary: 22, roster_status: "active" },
];

test("empty locker picks default to top active players by cap hit", () => {
  const wall = lockerWallPlayers(roster, []);
  assert.deepEqual(wall.players.map((row) => row.player_id), ["a", "d", "b"]);
  assert.equal(wall.caption, "Top 3 by cap hit");
  assert.equal(wall.curated, false);
});

test("curated locker ids keep order and name the subset", () => {
  const wall = lockerWallPlayers(roster, ["d", "a", "missing"]);
  assert.deepEqual(wall.players.map((row) => row.player_id), ["d", "a"]);
  assert.equal(wall.caption, "Your lockers · 2 of 3 active");
  assert.equal(wall.curated, true);
});
