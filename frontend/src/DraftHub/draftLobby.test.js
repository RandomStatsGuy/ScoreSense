import test from "node:test";
import assert from "node:assert/strict";
import {
  lobbyAbsoluteUrl,
  lobbyChipLabel,
  lobbyPath,
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

test("lobbyChipLabel counts seated managers", () => {
  assert.equal(lobbyChipLabel({ claimed: 3, teamCount: 12 }), "3 of 12 seated");
  assert.equal(lobbyChipLabel({ claimed: 12, teamCount: 12 }), "Room full");
  assert.equal(lobbyChipLabel({ live: true }), "Drafting");
});
