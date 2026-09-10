import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVibeProfile,
  composeBio,
  hometownFromHighSchool,
  jobLine,
  formatHeight,
} from "./vibeProfile.js";

test("high school town becomes a From line without claiming Wikipedia", () => {
  assert.equal(hometownFromHighSchool("Firebaugh (CA)"), "Firebaugh, CA");
  assert.equal(hometownFromHighSchool("Destrehan (LA)"), "Destrehan, LA");
  assert.equal(hometownFromHighSchool(""), "");
});

test("job line names the work, not a vibe farm", () => {
  assert.equal(jobLine({ position: "QB", team: "BUF", number: 17 }), "#17 · Quarterback for the Bills");
  assert.match(jobLine({ position: "WR", team: "MIN" }), /Receiver for the Vikings/);
});

test("height formats inches", () => {
  assert.equal(formatHeight(77), "6'5\"");
  assert.equal(formatHeight("6'3\""), "6'3\"");
});

test("missing profile facts do not invent a rookie season or first-person fallback", () => {
  assert.equal(composeBio({}), "");
  assert.equal(composeBio({ yearsExp: null }), "");
  assert.equal(composeBio({ yearsExp: "" }), "");
  assert.equal(composeBio({ yearsExp: 0 }), "Rookie season.");
});

test("composed bio uses available facts without inventing player speech", () => {
  const bio = composeBio({
    hometown: "Orem, UT",
    college: "BYU",
    team: "LAR",
    position: "WR",
    yearsExp: 3,
  });
  assert.doesNotMatch(bio, /\\bI\\b|\\bmy\\b|grew up|want the snap/i);
  assert.match(bio, /BYU/);
  assert.match(bio, /Rams/);
  assert.doesNotMatch(bio, /Draft Hub|Wikipedia|Submit/i);
});

test("demo profiles use the same factual bio format", () => {
  const profile = buildVibeProfile({
    player_id: "demo-allen",
    player_name: "Josh Allen",
    position: "QB",
    team: "BUF",
  }, {});
  assert.equal(profile.hometown, "Firebaugh, CA");
  assert.equal(profile.college, "Wyoming");
  assert.match(profile.job, /Bills/);
  assert.match(profile.bio, /College: Wyoming/);
  assert.ok(profile.facts.some((row) => row.id === "from"));
});

test("roster player uses Sleeper media when there is no demo card", () => {
  const profile = buildVibeProfile(
    { player_id: "00-1", player_name: "Puka Nacua", position: "WR", team: "LAR" },
    { "00-1": { college: "BYU", high_school: "Orem (UT)", age: 25, years_exp: 3, jersey_number: "12" } },
  );
  assert.equal(profile.hometown, "Orem, UT");
  assert.equal(profile.college, "BYU");
  assert.match(profile.job, /#12/);
  assert.match(profile.bio, /College: BYU/);
});
