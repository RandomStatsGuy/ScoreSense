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
  const liveRoom = resolveLivingSurfaceFromText("not the lobby, the live room");
  assert.equal(liveRoom.chrome, "draft-live");
  const calendar = resolveLivingSurfaceFromText("make the draft calendar more prominent");
  assert.equal(calendar.page, "frontend/src/DraftHub/DraftLobby.jsx");
  const invite = resolveLivingSurfaceFromText("league invite lands on draft");
  assert.equal(invite.label, "Draft");
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

test("login and create account resolve to the session pages", () => {
  const login = resolveLivingSurfaceFromText("mock up a better login page");
  assert.equal(login.label, "Sign in");
  assert.equal(login.page, "frontend/src/AuthSessionPage.jsx");
  const create = resolveLivingSurfaceFromText("create account page with google auth");
  assert.equal(create.label, "Create account");
  assert.equal(create.copy, "frontend/src/authPresentation.js");
  const signIn = resolveLivingSurfaceFromText("especially the sign in screen on mobile");
  assert.equal(signIn.label, "Sign in");
  const privacy = resolveLivingSurfaceFromText("update the privacy policy for SMS");
  assert.equal(privacy.page, "frontend/src/legal/PrivacyPage.jsx");
  const terms = resolveLivingSurfaceFromText("terms of service must name Twilio");
  assert.equal(terms.page, "frontend/src/legal/TermsPage.jsx");
});

test("shared mobile chrome resolves from the header files", () => {
  const hits = surfacesForFile("frontend/src/layout/MobileHeader.jsx");
  assert.equal(hits[0].id, "shared");
});

test("shared chat chrome resolves from the dock and copy module", () => {
  assert.equal(surfacesForFile("frontend/src/DraftHub/FantasyChatDock.jsx")[0].id, "shared");
  assert.equal(surfacesForFile("frontend/src/DraftHub/fantasyChatPresentation.js")[0].id, "shared");
});
