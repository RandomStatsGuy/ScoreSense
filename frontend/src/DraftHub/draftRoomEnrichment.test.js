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
