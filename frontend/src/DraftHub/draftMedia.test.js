import test from "node:test";
import assert from "node:assert/strict";
import { headshotCandidates, lookupPlayerMedia } from "./draftMedia.js";

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
