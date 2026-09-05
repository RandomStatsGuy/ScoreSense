/**
 * Run with: node --test frontend/src/DraftHub/atmosphereCatalog.test.js
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAtmospherePatch,
  identityMediaUrl,
  lockerNameplate,
  mergeAtmospherePrefs,
  mergeFocus,
  mergeTeamIdentity,
  shouldShowAtmosphere,
  snapHubMediaWidth,
  withHubMediaWidth,
} from "./atmosphereCatalog.js";

test("mergeAtmospherePrefs stays off unless a known theme is chosen", () => {
  assert.equal(mergeAtmospherePrefs(null).atmosphere, "none");
  assert.equal(mergeAtmospherePrefs({ atmosphere: "snow" }).atmosphere, "snow");
  assert.equal(mergeAtmospherePrefs({ atmosphere: "cozy" }).atmosphere, "cozy");
  assert.equal(mergeAtmospherePrefs({ atmosphere: "casino" }).atmosphere, "none");
});

test("mergeAtmospherePrefs normalizes the tailoring options", () => {
  const defaults = mergeAtmospherePrefs({ atmosphere: "cozy" });
  assert.deepEqual(
    { motion: defaults.motion, pile: defaults.pile, wash: defaults.wash, intensity: defaults.intensity },
    { motion: true, pile: true, wash: true, intensity: "standard" },
  );
  const custom = mergeAtmospherePrefs({
    atmosphere: "cozy",
    atmosphere_motion: false,
    atmosphere_pile: "off",
    atmosphere_wash: "true",
    atmosphere_intensity: "lively",
  });
  assert.equal(custom.motion, false);
  assert.equal(custom.pile, false);
  assert.equal(custom.wash, true);
  assert.equal(custom.intensity, "lively");
  assert.equal(mergeAtmospherePrefs({ atmosphere_intensity: "chaos" }).intensity, "standard");
});

test("applyAtmospherePatch overlays one option without resetting the rest", () => {
  const next = applyAtmospherePatch(
    {
      atmosphere: "cozy",
      motion: true,
      pile: true,
      wash: true,
      intensity: "lively",
    },
    { atmosphere_motion: false },
  );
  assert.equal(next.atmosphere, "cozy");
  assert.equal(next.motion, false);
  assert.equal(next.pile, true);
  assert.equal(next.wash, true);
  assert.equal(next.intensity, "lively");
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

test("atmosphere stays off in live draft; reduced motion only freezes it", () => {
  assert.equal(shouldShowAtmosphere("snow"), true);
  assert.equal(shouldShowAtmosphere("cozy"), true);
  assert.equal(shouldShowAtmosphere("snow", { liveDraft: true }), false);
  // Reduced motion keeps the static wash/pile visible; the layer itself
  // disables falling particles and reactions.
  assert.equal(shouldShowAtmosphere("snow", { reducedMotion: true }), true);
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

test("hub media widths snap 22 and 84 onto one 96 file", () => {
  assert.equal(snapHubMediaWidth(22), 48);
  assert.equal(snapHubMediaWidth(84), 96);
  assert.equal(snapHubMediaWidth(200), 256);
  assert.equal(
    withHubMediaWidth("/api/hub/media/abc", 22),
    "/api/hub/media/abc?w=48",
  );
  assert.equal(
    withHubMediaWidth("/api/hub/media/abc", 84),
    "/api/hub/media/abc?w=96",
  );
  assert.equal(
    withHubMediaWidth("/api/hub/media/abc?w=96", 256),
    "/api/hub/media/abc?w=96",
  );
  assert.equal(withHubMediaWidth("https://a.espncdn.com/i/x.png", 48), "https://a.espncdn.com/i/x.png");
});

test("identityMediaUrl appends painted width for marks and leaves studio full", () => {
  const identity = { photo_media_id: "logo-1", banner_media_id: "ban-1" };
  assert.equal(identityMediaUrl(identity, "photo"), "/api/hub/media/logo-1");
  assert.equal(
    identityMediaUrl(identity, "photo", { width: 96 }),
    "/api/hub/media/logo-1?w=96",
  );
  assert.equal(
    identityMediaUrl(identity, "banner", { width: 256 }),
    "/api/hub/media/ban-1?w=256",
  );
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
