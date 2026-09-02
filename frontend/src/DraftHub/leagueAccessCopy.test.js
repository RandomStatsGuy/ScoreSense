import test from "node:test";
import assert from "node:assert/strict";
import {
  CREATE_LEAGUE_VALUE,
  SOLO_VALUE,
  interpretLeagueSwitcherValue,
  draftInviteLabel,
  draftInviteExplainer,
  draftInviteRailHint,
  draftInviteWhatHappens,
  draftLobbyHeroSupport,
  draftLobbyRailHeading,
  draftLobbyReadiness,
  draftJoinSupport,
  draftJoinAccountNote,
  memberInviteExplainer,
  emailManagersHint,
  liveDraftMembersOnlyMessage,
  managerClaimExplainer,
  managerClaimLabel,
  managerClaimWhatHappens,
  managerClaimTextBody,
  managerClaimCopyTextLabel,
  managerClaimTextCopied,
  shareableAppUrl,
  draftNightEmpty,
  draftNightHeading,
  draftNightLockAction,
  draftNightSupport,
  draftNightUnlockAction,
  franchiseResizeHint,
  addFranchiseLabel,
  addFranchiseSupport,
  removeFranchiseLabel,
  franchiseSeatSummary,
} from "./leagueAccessCopy.js";

test("league switcher treats create as its own action", () => {
  assert.deepEqual(
    interpretLeagueSwitcherValue(CREATE_LEAGUE_VALUE, "lg-1"),
    { action: "create" },
  );
  assert.deepEqual(
    interpretLeagueSwitcherValue(SOLO_VALUE, "lg-1"),
    { action: "solo" },
  );
  assert.deepEqual(
    interpretLeagueSwitcherValue("lg-2", "lg-1"),
    { action: "switch", leagueId: "lg-2" },
  );
  assert.deepEqual(
    interpretLeagueSwitcherValue("lg-1", "lg-1"),
    { action: "noop" },
  );
});

test("live draft invite copy is members-only", () => {
  const live = draftInviteExplainer();
  assert.match(live, /already on this league/i);
  assert.match(live, /does not let strangers/i);
  assert.doesNotMatch(live, /no account is required/i);
  assert.equal(draftInviteLabel(), "Member draft link");
  assert.match(draftInviteRailHint(), /already belong/i);
  assert.match(draftLobbyHeroSupport(), /invite link/i);
  assert.match(draftInviteWhatHappens(), /already has their team/i);
});

test("practice draft invite copy keeps the real league untouched", () => {
  const mock = draftInviteExplainer({ testMode: true });
  assert.match(mock, /practice/i);
  assert.match(mock, /real league is unchanged/i);
  assert.equal(draftInviteLabel({ testMode: true }), "Practice draft link");
  assert.match(draftInviteRailHint({ testMode: true }), /practice room/i);
});

test("draft lobby readiness keeps launch status concise", () => {
  assert.equal(draftLobbyRailHeading({ isCommissioner: true }), "Ready to start?");
  assert.equal(
    draftLobbyRailHeading({ isCommissioner: true, testMode: true }),
    "Ready to practice?",
  );
  assert.equal(draftLobbyRailHeading(), "Waiting on the commissioner");

  const openRoom = draftLobbyReadiness({ claimed: 7, teamCount: 10 });
  assert.deepEqual(openRoom.map((item) => item.tone), ["attention", "neutral", "ready"]);
  assert.match(openRoom[0].label, /7 of 10 managers seated/i);
  assert.match(openRoom[1].label, /commissioner launches/i);

  const readyRoom = draftLobbyReadiness({ claimed: 10, teamCount: 10, scheduled: true });
  assert.equal(readyRoom[0].label, "Every seat is claimed");
  assert.equal(readyRoom[1].label, "Draft night locked");
});

test("join page tells live visitors they must already be members", () => {
  const copy = draftJoinSupport({
    canJoin: true,
    leagueName: "Sunday Cap",
    membersOnly: true,
  });
  assert.match(copy, /Sunday Cap/);
  assert.match(copy, /members only/i);
  assert.match(draftJoinSupport({ canJoin: false }), /already underway/i);
});

test("join account note blocks guests on live drafts", () => {
  assert.match(draftJoinAccountNote({ membersOnly: true, authenticated: false }), /guests cannot/i);
  assert.match(draftJoinAccountNote({ membersOnly: true, authenticated: true }), /on the league/i);
  assert.match(draftJoinAccountNote({ authenticated: false }), /practice draft/i);
});

test("member email invite is how people join the league", () => {
  const copy = memberInviteExplainer();
  assert.match(copy, /invite link/i);
  assert.match(copy, /claim a team/i);
  assert.match(managerClaimLabel(), /Invite link/i);
  assert.equal(
    shareableAppUrl("https://app.example.com/hub/draft?claim=abc", "http://127.0.0.1:5173"),
    "http://127.0.0.1:5173/hub/draft?claim=abc",
  );
  assert.match(managerClaimExplainer(), /text this link/i);
  assert.match(managerClaimExplainer(), /mark nights/i);
  assert.match(managerClaimWhatHappens(), /claims an open team/i);
  assert.match(managerClaimWhatHappens(), /mark nights/i);
  assert.match(emailManagersHint(), /member-only/i);
  assert.match(liveDraftMembersOnlyMessage(), /league members/i);
});

test("claim text is a paste-ready group message", () => {
  const body = managerClaimTextBody({
    leagueName: "Sunday Cap",
    url: "https://app.example.com/hub/draft?claim=abc",
  });
  assert.match(body, /Sunday Cap/);
  assert.match(body, /claim your team/i);
  assert.match(body, /mark nights that work/i);
  assert.match(body, /hub\/draft\?claim=abc/);
  assert.doesNotMatch(body, /Draft Hub|Submit|permission/i);
  assert.equal(managerClaimCopyTextLabel({}), "Copy text");
  assert.equal(managerClaimCopyTextLabel({ copied: true }), "Text copied");
  assert.match(managerClaimTextCopied(), /group text/i);
  assert.match(
    managerClaimTextBody({ url: "https://app.example.com/hub/draft?claim=x" }),
    /the league/,
  );
});

test("draft night copy names the lock time", () => {
  assert.equal(draftNightHeading(), "Draft night");
  assert.equal(draftNightEmpty(), "Not locked yet");
  assert.match(draftNightSupport({ scheduled: false }), /overlaps/i);
  assert.match(draftNightSupport({ scheduled: true }), /locked/i);
  assert.equal(draftNightLockAction({}), "Lock this night");
  assert.equal(draftNightUnlockAction(), "Unlock");
});

test("franchise resize copy names the next auction consequence", () => {
  assert.equal(addFranchiseLabel(), "Add franchise");
  assert.equal(removeFranchiseLabel(), "Remove franchise");
  assert.match(franchiseResizeHint(), /next auction/i);
  assert.doesNotMatch(franchiseResizeHint(), /Submit|Draft Hub|permission/i);
  assert.match(addFranchiseSupport({ nextCount: 11, cap: 200 }), /11 teams/);
  assert.match(addFranchiseSupport({ nextCount: 11, cap: 200 }), /\$200/);
  assert.equal(franchiseSeatSummary({ configured: 12, actual: 10 }), "10 franchises · 12 seats");
  assert.equal(franchiseSeatSummary({ configured: 10, actual: 10 }), "10 franchises");
});
