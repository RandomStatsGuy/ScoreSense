import assert from "node:assert/strict";
import test from "node:test";
import { leagueBoardEmpty } from "./leagueBoardEmpty.js";

test("native pre-draft empty board locks a night on Draft", () => {
  const empty = leagueBoardEmpty({ emptyRoster: true, sleeperLinked: false, draftCompleted: false });
  assert.equal(empty.kind, "lock-night");
  assert.equal(empty.action.kind, "room");
  assert.equal(empty.action.label, "Lock a night");
  assert.equal(empty.rail, "Waiting on roster");
  assert.doesNotMatch(empty.support, /League settings|Rate vibes|Draft Hub/i);
});

test("unlinked Sleeper after draft points at Access & imports", () => {
  const empty = leagueBoardEmpty({ emptyRoster: true, sleeperLinked: false, draftCompleted: true });
  assert.equal(empty.kind, "link-sleeper");
  assert.equal(empty.action.kind, "office-access");
  assert.match(empty.support, /Access & imports/);
});

test("linked empty board names the strip sync", () => {
  const empty = leagueBoardEmpty({
    emptyRoster: true,
    sleeperLinked: true,
    draftCompleted: true,
    sleeperStale: true,
  });
  assert.equal(empty.kind, "strip-sync");
  assert.equal(empty.action.kind, "strip-sync");
  assert.match(empty.support, /overwrite contracts/i);
});

test("populated roster has no empty block", () => {
  assert.equal(leagueBoardEmpty({ emptyRoster: false }), null);
});
