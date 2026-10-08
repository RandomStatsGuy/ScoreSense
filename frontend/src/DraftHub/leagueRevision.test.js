import test from "node:test";
import assert from "node:assert/strict";
import { leagueRevisionKey, nextLeagueRevision } from "./leagueRevision.js";

test("first read is the baseline, not a change", () => {
  assert.deepEqual(nextLeagueRevision(null, { live_roster_revision: 7 }), { known: "7:0", changed: false });
});

test("a trade or sync that bumps the live revision is a change", () => {
  assert.equal(nextLeagueRevision("7:0", { live_roster_revision: 8, historic_snapshot_revision: 0 }).changed, true);
});

test("a historic correction is a change", () => {
  assert.equal(nextLeagueRevision("7:0", { live_roster_revision: 7, historic_snapshot_revision: 1 }).changed, true);
});

test("the same revision is not a change", () => {
  assert.equal(nextLeagueRevision("7:2", { live_roster_revision: 7, historic_snapshot_revision: 2 }).changed, false);
});

test("missing fields read as zero", () => {
  assert.equal(leagueRevisionKey({}), "0:0");
  assert.equal(leagueRevisionKey(null), "0:0");
});
