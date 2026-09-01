import assert from "node:assert/strict";
import test from "node:test";
import {
  CHROME,
  LIVING_SURFACES,
  resolveLivingSurface,
  resolveLivingSurfaceFromText,
  surfacesForFile,
} from "./livingSurfaces.js";

test("nav-style lookup distinguishes idle draft from live draft", () => {
  const idle = resolveLivingSurface({ section: "hub", hubView: "room" });
  const live = resolveLivingSurface({ section: "hub", hubView: "room", draftLive: true });
  assert.equal(idle.page, "frontend/src/DraftHub/DraftLobby.jsx");
  assert.equal(live.page, "frontend/src/DraftHub/DraftRoom.jsx");
  assert.equal(live.chrome, "draft-live");
});

test("text lookup prefers the longest alias and ignores capture vs cap", () => {
  const fa = resolveLivingSurfaceFromText("Tighten the Free agents filter chips");
  assert.equal(fa.label, "Free agents");
  const mock = resolveLivingSurfaceFromText("Mock draft bot count");
  assert.equal(mock.label, "Mock draft");
  const live = resolveLivingSurfaceFromText("Fix the live draft nominee card");
  assert.equal(live.chrome, "draft-live");
  const nominee = resolveLivingSurfaceFromText("the nominee card is clipped");
  assert.equal(nominee.page, "frontend/src/DraftHub/DraftRoom.jsx");
  assert.equal(resolveLivingSurfaceFromText("Remember to capture this correction"), null);
  const cap = resolveLivingSurfaceFromText("Cap planner overage");
  assert.equal(cap.label, "Cap");
});

test("file lookup returns the surfaces that own a page", () => {
  const hits = surfacesForFile("frontend/src/DraftHub/ValueSheetTable.jsx");
  assert.deepEqual(hits.map((row) => row.id).sort(), ["hub.available", "hub.value"]);
});

test("every registered chrome is in the CHROME list", () => {
  for (const row of Object.values(LIVING_SURFACES)) {
    assert.ok(CHROME.includes(row.chrome), row.chrome);
  }
});
