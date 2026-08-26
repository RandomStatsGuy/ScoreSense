import test from "node:test";
import assert from "node:assert/strict";
import {
  HUB_POSITION_FILTERS,
  filterRowsByHubPosition,
  normalizeHubPosition,
} from "./hubPositions.js";

test("hub position filters list TE as its own chip", () => {
  assert.deepEqual(HUB_POSITION_FILTERS, ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"]);
});

test("normalizeHubPosition keeps WR/TE and maps DST/REC", () => {
  assert.equal(normalizeHubPosition("TE"), "TE");
  assert.equal(normalizeHubPosition("WR"), "WR");
  assert.equal(normalizeHubPosition("REC"), "WR");
  assert.equal(normalizeHubPosition("DST"), "DEF");
  assert.equal(normalizeHubPosition("D/ST"), "DEF");
  assert.equal(normalizeHubPosition("D"), "DEF");
});

test("TE filter returns only tight ends", () => {
  const rows = [
    { player_id: "1", player: "Puka", position: "WR", season_proj: 300 },
    { player_id: "2", player: "Pitts", position: "TE", season_proj: 180 },
    { player_id: "3", player: "Kelce", position: "te", season_proj: 170 },
    { player_id: "4", player: "Mahomes", position: "QB", season_proj: 400 },
  ];
  const tes = filterRowsByHubPosition(rows, "TE");
  assert.deepEqual(tes.map((r) => r.player_id), ["2", "3"]);
  assert.equal(filterRowsByHubPosition(rows, "WR").length, 1);
});
