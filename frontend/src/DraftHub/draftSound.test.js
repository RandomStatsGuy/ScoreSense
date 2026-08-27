import test from "node:test";
import assert from "node:assert/strict";
import {
  draftEventSoundKey,
  draftToneForEvent,
  loadDraftSoundPreference,
  saveDraftSoundPreference,
} from "./draftSound.js";

test("only meaningful live-draft events receive a sound", () => {
  assert.equal(draftToneForEvent({ event_type: "bid" }), "bid");
  assert.equal(draftToneForEvent({ event_type: "win" }), "win");
  assert.equal(draftToneForEvent({ event_type: "pick" }), "pick");
  assert.equal(draftToneForEvent({ event_type: "nominate" }), null);
  assert.equal(draftToneForEvent({ event_type: "pause" }), null);
});

test("sound preference is opt-in and persistable", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(loadDraftSoundPreference(storage), false);
  saveDraftSoundPreference(true, storage);
  assert.equal(loadDraftSoundPreference(storage), true);
  saveDraftSoundPreference(false, storage);
  assert.equal(loadDraftSoundPreference(storage), false);
});

test("event sound keys prefer stable event ids", () => {
  assert.equal(draftEventSoundKey({ id: 42, event_type: "pick" }), "42");
  assert.equal(
    draftEventSoundKey({ event_type: "pick", payload: { overall: 9 } }),
    "pick::9",
  );
});
