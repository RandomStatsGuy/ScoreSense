import test from "node:test";
import assert from "node:assert/strict";
import {
  altLockSummary,
  lobbyAbsoluteUrl,
  lobbyChipLabel,
  lobbyChipTone,
  lobbyPath,
  startDraftIsPrimary,
  roomHeading,
  roomSupport,
  slotHint,
  slotLabel,
} from "./draftLobby.js";

test("lobbyPath uppercases the room code", () => {
  assert.equal(lobbyPath("ab12cd"), "/lobby/AB12CD");
  assert.equal(lobbyPath(""), "/lobby");
});

test("lobbyAbsoluteUrl prefixes origin", () => {
  assert.equal(lobbyAbsoluteUrl("ab12", "https://app.example.com"), "https://app.example.com/lobby/AB12");
});

test("slot copy depends on draft type", () => {
  assert.equal(slotLabel("snake"), "Draft position");
  assert.equal(slotLabel("auction"), "Nomination order");
  assert.match(slotHint("snake"), /snakes/i);
});

test("room strip copy stays one line", () => {
  assert.equal(roomHeading(), "The room");
  assert.match(roomSupport({}), /Take a seat/);
  assert.doesNotMatch(roomSupport({}), /Draft Hub|Submit|permission/i);
  assert.equal(altLockSummary({}), "Lock a night that is not on the calendar");
  assert.match(altLockSummary({ locked: true }), /Move the locked night/i);
});

test("lobbyChipLabel counts seated managers", () => {
  assert.equal(lobbyChipLabel({ claimed: 3, teamCount: 12 }), "3 of 12 seated");
  assert.equal(lobbyChipLabel({ claimed: 12, teamCount: 12 }), "Room full");
  assert.equal(lobbyChipLabel({ live: true }), "Drafting");
  assert.equal(lobbyChipTone({ claimed: 1, teamCount: 12 }), "caution");
  assert.equal(lobbyChipTone({ claimed: 12, teamCount: 12 }), "ready");
  assert.equal(startDraftIsPrimary({ scheduled: false, claimed: 1, teamCount: 12 }), false);
  assert.equal(startDraftIsPrimary({ scheduled: true, claimed: 1, teamCount: 12 }), true);
  assert.equal(startDraftIsPrimary({ scheduled: false, claimed: 12, teamCount: 12 }), true);
});
