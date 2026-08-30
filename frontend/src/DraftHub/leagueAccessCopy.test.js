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

test("draft invite copy says the link is this league, not a side room", () => {
  const live = draftInviteExplainer();
  assert.match(live, /this league/i);
  assert.match(live, /not a separate/i);
  assert.match(live, /no account/i);
  assert.match(live, /signed in/i);
  assert.equal(draftInviteLabel(), "League draft link");
});

test("practice draft invite copy keeps the real league untouched", () => {
  const mock = draftInviteExplainer({ testMode: true });
  assert.match(mock, /practice/i);
  assert.match(mock, /real league is unchanged/i);
  assert.equal(draftInviteLabel({ testMode: true }), "Practice draft link");
});

test("join page tells guests they are entering the league", () => {
  const copy = draftJoinSupport({ canJoin: true, leagueName: "Sunday Cap" });
  assert.match(copy, /Sunday Cap/);
  assert.match(copy, /same league/);
  assert.match(draftJoinSupport({ canJoin: false }), /already underway/i);
});

test("join account note distinguishes signed-in vs guest", () => {
  assert.match(draftJoinAccountNote({ authenticated: true }), /your team/i);
  assert.match(draftJoinAccountNote({ authenticated: false }), /no account needed/i);
  assert.match(draftJoinAccountNote({ authenticated: false }), /league home/i);
});

test("member email invite is distinct from the walk-in draft link", () => {
  const copy = memberInviteExplainer();
  assert.match(copy, /named team/i);
  assert.match(copy, /creates an account/i);
  assert.match(copy, /draft lobby link/i);
  assert.match(emailManagersHint(), /already on this league/i);
});

test("lobby hero and what-happens copy stay concrete", () => {
  assert.match(draftLobbyHeroSupport(), /this league/i);
  assert.match(draftInviteWhatHappens(), /join page/i);
  assert.match(draftInviteWhatHappens(), /do not have to create an account/i);
});
