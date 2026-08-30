import test from "node:test";
import assert from "node:assert/strict";
import {
  CREATE_LEAGUE_VALUE,
  SOLO_VALUE,
  interpretLeagueSwitcherValue,
  draftInviteLabel,
  draftInviteExplainer,
  draftInviteWhatHappens,
  draftLobbyHeroSupport,
  draftJoinSupport,
  draftJoinAccountNote,
  memberInviteExplainer,
  emailManagersHint,
  liveDraftMembersOnlyMessage,
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
  assert.match(draftLobbyHeroSupport(), /for league members/i);
  assert.match(draftInviteWhatHappens(), /already has their team/i);
});

test("practice draft invite copy keeps the real league untouched", () => {
  const mock = draftInviteExplainer({ testMode: true });
  assert.match(mock, /practice/i);
  assert.match(mock, /real league is unchanged/i);
  assert.equal(draftInviteLabel({ testMode: true }), "Practice draft link");
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
  assert.match(copy, /named team/i);
  assert.match(copy, /creates an account/i);
  assert.match(copy, /does not let anyone walk in/i);
  assert.match(emailManagersHint(), /member-only/i);
  assert.match(liveDraftMembersOnlyMessage(), /league members/i);
});
