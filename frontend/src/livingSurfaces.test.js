import assert from "node:assert/strict";
import test from "node:test";
import {
  CHROME,
  LIVING_SURFACES,
  SHARED,
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
  const roomSeats = resolveLivingSurfaceFromText("The room open seats look cramped");
  assert.equal(roomSeats.page, "frontend/src/DraftHub/DraftLobby.jsx");
  const takeAPick = resolveLivingSurfaceFromText("Take a pick spacing on the seat tiles");
  assert.equal(takeAPick.page, "frontend/src/DraftHub/DraftLobby.jsx");
  assert.equal(resolveLivingSurfaceFromText("Not scheduled on Home").label, "Home");
  assert.equal(resolveLivingSurfaceFromText("Suggested bid has no context").label, "Strategy");
  assert.equal(resolveLivingSurfaceFromText("Hub PPR leaks on Strategy").label, "Strategy");
  assert.equal(resolveLivingSurfaceFromText("Lock a night that is not on the calendar").label, "Draft");
  assert.equal(resolveLivingSurfaceFromText("Mark yours on a closed calendar").label, "Draft");
  assert.equal(resolveLivingSurfaceFromText("Mark draft complete on Contracts").label, "Contracts");
  assert.equal(resolveLivingSurfaceFromText("Remember to capture this correction"), null);
  const cap = resolveLivingSurfaceFromText("Cap planner overage");
  assert.equal(cap.label, "Cap");
  const vibes = resolveLivingSurfaceFromText("mock up vibe rankings with swipe");
  assert.equal(vibes.label, "Vibes");
  assert.equal(vibes.page, "frontend/src/DraftHub/VibeRankings.jsx");
  const profile = resolveLivingSurfaceFromText("fun facts about the player like a real tinder profile");
  assert.equal(profile.label, "Vibes");
  assert.ok(profile.also.includes("frontend/src/DraftHub/vibeProfile.js"));
  const more = resolveLivingSurfaceFromText("see more on the card with the info arrow");
  assert.equal(more.label, "Vibes");
  assert.ok(more.also.includes("frontend/src/DraftHub/vibeMatchup.js"));
  const va = resolveLivingSurfaceFromText("rename the table to vibe adjusted projections");
  assert.equal(va.label, "Vibes");
  const draftStrategy = resolveLivingSurfaceFromText("the draft strategy page should feel like a bid board");
  assert.equal(draftStrategy.label, "Strategy");
  const rankings = resolveLivingSurfaceFromText("View my rankings should look like site vs mine");
  assert.equal(rankings.label, "Strategy");
  const faceoff = resolveLivingSurfaceFromText("strategy face-off cards are a whole page");
  assert.equal(faceoff.page, "frontend/src/DraftHub/StrategyBoard.jsx");
  const locker = resolveLivingSurfaceFromText("tighten the locker note on the inspector");
  assert.equal(locker.label, "Player inspector");
  const weeklyCompare = resolveLivingSurfaceFromText("weekly compare checkboxes on the board");
  assert.equal(weeklyCompare.page, "frontend/src/WeeklyTable.jsx");
  const rbWeekly = resolveLivingSurfaceFromText("running back weekly table chips");
  assert.equal(rbWeekly.page, "frontend/src/WeeklyTable.jsx");
  const phone = resolveLivingSurfaceFromText("phone projections need denser rows");
  assert.equal(phone.page, "frontend/src/WeeklyTable.jsx");
  const mobileWeekly = resolveLivingSurfaceFromText("mobile weekly compare checkbox");
  assert.equal(mobileWeekly.page, "frontend/src/WeeklyTable.jsx");
});

test("contracts pane owns the pending-write copy module", () => {
  const row = LIVING_SURFACES["hub.office.current"];
  assert.equal(row.page, "frontend/src/DraftHub/CommissionerLeagueRosters.jsx");
  assert.equal(row.copy, "frontend/src/DraftHub/officeContractsPresentation.js");
  assert.match(row.doNot, /pending-changes tray/);
});

test("file lookup returns the surfaces that own a page", () => {
  const hits = surfacesForFile("frontend/src/DraftHub/ValueSheetTable.jsx");
  assert.deepEqual(hits.map((row) => row.id), ["hub.available"]);
  const strategy = surfacesForFile("frontend/src/DraftHub/StrategyBoard.jsx");
  assert.equal(strategy[0].id, "hub.value");
  const rank = surfacesForFile("frontend/src/DraftHub/strategyRank.js");
  assert.equal(rank[0].id, "hub.value");
  assert.equal(LIVING_SURFACES["hub.value"].copy, "frontend/src/DraftHub/strategyRankPresentation.js");
});

test("every registered chrome is in the CHROME list", () => {
  for (const row of Object.values(LIVING_SURFACES)) {
    assert.ok(CHROME.includes(row.chrome), row.chrome);
  }
});

test("admin portal resolves with staff copy", () => {
  const admin = resolveLivingSurface({ section: "admin" });
  assert.equal(admin.label, "Admin");
  assert.equal(admin.page, "frontend/src/AdminPortal.jsx");
  assert.equal(admin.copy, "frontend/src/adminPresentation.js");
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
  const sms = resolveLivingSurfaceFromText("build the SMS opt-in web form");
  assert.equal(sms.page, "frontend/src/legal/SmsAlertsPage.jsx");
  const report = resolveLivingSurfaceFromText("add a bug report page for the pickup board");
  assert.equal(report.label, "Report a bug");
  assert.equal(report.page, "frontend/src/BugReportPage.jsx");
  assert.equal(report.copy, "frontend/src/bugReportPresentation.js");
});

test("shared tokens include the product spacing rhythm", () => {
  assert.ok(SHARED.tokens.includes("frontend/src/styles/product-rhythm.css"));
  assert.ok(SHARED.tokens.includes("frontend/src/styles/tokens.css"));
  assert.ok(SHARED.tokens.includes("frontend/src/styles/fantasy-phone.css"));
});

test("shared mobile chrome resolves from the header files", () => {
  const hits = surfacesForFile("frontend/src/layout/MobileHeader.jsx");
  assert.equal(hits[0].id, "shared");
});

test("shared chat chrome resolves from the dock and copy module", () => {
  assert.equal(surfacesForFile("frontend/src/DraftHub/FantasyChatDock.jsx")[0].id, "shared");
  assert.equal(surfacesForFile("frontend/src/DraftHub/fantasyChatPresentation.js")[0].id, "shared");
});

test("league chat phrases resolve to Home", () => {
  const moved = resolveLivingSurfaceFromText("move the league chat button around");
  assert.equal(moved.label, "Home");
  const bubble = resolveLivingSurfaceFromText("the chat bubble should be draggable");
  assert.equal(bubble.label, "Home");
});
