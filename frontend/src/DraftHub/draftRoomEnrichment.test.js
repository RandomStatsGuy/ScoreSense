import test from "node:test";
import assert from "node:assert/strict";
import {
  enrichmentPlayerHints,
  mergePlayerMedia,
} from "./draftRoomEnrichment.js";

test("enrichment hints de-dupe pool, nominee, and roster rows", () => {
  const hints = enrichmentPlayerHints(
    [{ player_id: "a", player: "Alpha", team: "KC", position: "QB" }],
    [
      { player_id: "a", player_name: "Alpha" },
      { player_id: "b", player_name: "Bravo", team: "BUF", position: "WR" },
    ],
  );
  assert.deepEqual(hints.map((row) => row.player_id), ["a", "b"]);
  assert.equal(hints[0].player_name, "Alpha");
  assert.equal(hints[1].team, "BUF");
});

test("mergePlayerMedia prefers enrichment headshots", () => {
  const merged = mergePlayerMedia(
    { a: { team: "KC" } },
    { a: { headshot_url: "https://img/a.png", team: "KC" } },
  );
  assert.equal(merged.a.headshot_url, "https://img/a.png");
});

test("enrichment hints include sleeper ids when present", () => {
  const hints = enrichmentPlayerHints([
    { player_id: "a", player: "Alpha", team: "KC", sleeper_player_id: "123" },
  ]);
  assert.equal(hints[0].sleeper_id, "123");
});

test("mergePlayerMedia stringifies ids and keeps espn fallbacks", () => {
  const merged = mergePlayerMedia(
    { 1: { team: "KC" } },
    { 1: { espn_headshot_url: "https://img/espn.png", team: "KC" } },
  );
  assert.equal(merged["1"].espn_headshot_url, "https://img/espn.png");
});
