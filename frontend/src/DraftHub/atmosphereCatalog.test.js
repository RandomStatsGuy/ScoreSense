/**
 * Run with: node --test frontend/src/DraftHub/atmosphereCatalog.test.js
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  lockerNameplate,
  mergeAtmospherePrefs,
  mergeFocus,
  mergeTeamIdentity,
  shouldShowAtmosphere,
} from "./atmosphereCatalog.js";

test("mergeAtmospherePrefs stays off unless a known theme is chosen", () => {
  assert.equal(mergeAtmospherePrefs(null).atmosphere, "none");
  assert.equal(mergeAtmospherePrefs({ atmosphere: "snow" }).atmosphere, "snow");
  assert.equal(mergeAtmospherePrefs({ atmosphere: "casino" }).atmosphere, "none");
});

test("mergeTeamIdentity keeps locker picks short and valid", () => {
  const merged = mergeTeamIdentity({
    photo_preset: "storm",
    room_theme: "locker",
    locker_player_ids: ["a", "a", "b", "c", "d", "e", "f", "g", "h", "i"],
  });
  assert.equal(merged.photo_preset, "storm");
  assert.equal(merged.room_theme, "locker");
  assert.deepEqual(merged.locker_player_ids, ["a", "b", "c", "d", "e", "f", "g", "h"]);
});

test("atmosphere stays off in live draft and reduced motion", () => {
  assert.equal(shouldShowAtmosphere("snow"), true);
  assert.equal(shouldShowAtmosphere("snow", { liveDraft: true }), false);
  assert.equal(shouldShowAtmosphere("snow", { reducedMotion: true }), false);
  assert.equal(shouldShowAtmosphere("none"), false);
});

test("lockerNameplate uses the last name", () => {
  assert.equal(lockerNameplate("Josh Allen"), "Allen");
  assert.equal(lockerNameplate("Amon-Ra St. Brown"), "Brown");
});

test("mergeFocus clamps pan and zoom", () => {
  assert.deepEqual(mergeFocus({ x: -10, y: 140, zoom: 8 }), { x: 0, y: 100, zoom: 2.5 });
  assert.deepEqual(mergeFocus({ x: "25", y: "n/a", zoom: 1.2 }), { x: 25, y: 50, zoom: 1.2 });
});

test("mergeTeamIdentity keeps crop focus", () => {
  const merged = mergeTeamIdentity({
    photo_focus: { x: 12, y: 88, zoom: 1.4 },
    banner_focus: { x: 90 },
  });
  assert.deepEqual(merged.photo_focus, { x: 12, y: 88, zoom: 1.4 });
  assert.equal(merged.banner_focus.x, 90);
  assert.equal(merged.banner_focus.y, 50);
});
