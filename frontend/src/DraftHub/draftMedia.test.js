import test from "node:test";
import assert from "node:assert/strict";
import {
  headshotCandidates,
  lookupPlayerMedia,
  paintMediaUrl,
  playerFaceInitials,
  playerInitials,
  teamLogoUrl,
} from "./draftMedia.js";

test("player initials fall back to id or a mark when the name is missing", () => {
  assert.equal(playerInitials(undefined), "?");
  assert.equal(playerInitials(""), "?");
  assert.equal(playerFaceInitials({ player_id: "00-1" }), "00");
  assert.equal(playerFaceInitials({ player_name: "Puka Nacua" }), "PN");
  assert.equal(playerFaceInitials(null, "RB"), "RB");
});

test("lookupPlayerMedia accepts numeric or string ids", () => {
  const media = { "00-1": { headshot_url: "https://img/a.png" } };
  assert.equal(lookupPlayerMedia(media, "00-1").headshot_url, "https://img/a.png");
});

test("headshotCandidates prefers sleeper then espn", () => {
  const shots = headshotCandidates({
    headshot_url: "https://sleeper/a.jpg",
    espn_headshot_url: "https://espn/a.png",
  });
  assert.deepEqual(shots, ["https://sleeper/a.jpg", "https://espn/a.png"]);
});

test("paintMediaUrl requests ESPN combiner and Sleeper thumb at the painted size", () => {
  assert.equal(
    paintMediaUrl("https://a.espncdn.com/i/headshots/nfl/players/full/1.png", 28),
    "https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/1.png&w=48&h=48",
  );
  assert.equal(
    teamLogoUrl("KC", { width: 28 }),
    "https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500/kc.png&w=48&h=48",
  );
  assert.equal(
    paintMediaUrl("https://sleepercdn.com/content/nfl/players/4881.jpg", 48),
    "https://sleepercdn.com/content/nfl/players/thumb/4881.jpg",
  );
  assert.equal(
    paintMediaUrl("https://sleepercdn.com/content/nfl/players/4881.jpg", 256),
    "https://sleepercdn.com/content/nfl/players/4881.jpg",
  );
  const shots = headshotCandidates(
    { headshot_url: "https://sleepercdn.com/content/nfl/players/9.jpg" },
    [],
    { width: 48 },
  );
  assert.equal(shots[0], "https://sleepercdn.com/content/nfl/players/thumb/9.jpg");
});
