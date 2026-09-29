import assert from "node:assert/strict";
import test from "node:test";
import { eligibleLineupReplacements, eligibleStarterSlots, lineupPlayerLocked, lineupReplacementDelta } from "./weekBoard.js";

test("position picker obeys configured FLEX eligibility and keeps missing projections last", () => {
  const bench = [
    { player_id: "qb", position: "QB", p50: 25 },
    { player_id: "rb", position: "RB", p50: 20 },
    { player_id: "wr", position: "WR", p50: 15 },
    { player_id: "te", position: "TE", p50: null },
  ];
  assert.deepEqual(eligibleLineupReplacements({ slot: "FLEX" }, bench).map((p) => p.player_id), ["rb", "wr", "te"]);
  assert.deepEqual(eligibleLineupReplacements({ slot: "FLEX" }, bench, { roster: { flex: { eligible: ["QB", "WR"] } } }).map((p) => p.player_id), ["qb", "wr"]);
  assert.deepEqual(eligibleLineupReplacements({ slot: "WR2" }, bench).map((p) => p.player_id), ["wr"]);
  assert.equal(bench[0].player_id, "qb");
});

test("lineup lock preview follows kickoff and saved locks with a staff override", () => {
  const now = Date.parse("2026-09-20T17:00:00Z");
  assert.equal(lineupPlayerLocked({ kickoff_et: "2026-09-20T13:00:00-04:00" }, { now }), true);
  assert.equal(lineupPlayerLocked({ kickoff_et: "2026-09-20T16:25:00-04:00" }, { now }), false);
  assert.equal(lineupPlayerLocked({ lineup_locked: true }), true);
  assert.equal(lineupPlayerLocked({ locked: true }, { staffOverride: true }), false);
  assert.equal(lineupPlayerLocked({ kickoff_et: null }, { now }), false);
});

test("move preview does not invent a delta when either projection is missing", () => {
  assert.equal(lineupReplacementDelta({ player: { p50: 12.6 } }, { p50: 15.1 }), 2.5);
  assert.equal(lineupReplacementDelta({ player: { p50: 21.2 } }, { p50: 15.1 }).toFixed(1), "-6.1");
  assert.equal(lineupReplacementDelta({ player: { p50: null } }, { p50: 15.1 }), null);
  assert.equal(lineupReplacementDelta({}, { p50: null }), null);
  assert.equal(lineupReplacementDelta({}, { p50: 0 }), 0);
});

test("bench entry preserves distinct slots and custom FLEX eligibility including empty starters", () => {
  const slots = [{key:"wr1",slot:"WR1",player:{player_id:"a"}}, {key:"wr2",slot:"WR2",player:null},
    {key:"flex",slot:"FLEX"}, {key:"qb",slot:"QB"}, {key:"def",slot:"DEF"}];
  const wideout={player_id:"bench-wr",position:"WR"};
  assert.deepEqual(eligibleStarterSlots(wideout,slots).map(s=>s.key),["wr1","wr2","flex"]);
  assert.deepEqual(eligibleStarterSlots(wideout,slots,{roster:{flex:{eligible:["QB"]}}}).map(s=>s.key),["wr1","wr2"]);
  assert.deepEqual(eligibleStarterSlots({player_id:"bench-qb",position:"QB"},slots,{roster:{flex:{eligible:["QB"]}}}).map(s=>s.key),["flex","qb"]);
  assert.deepEqual(eligibleStarterSlots({player_id:"def",position:"DEF"},slots).map(s=>s.key),["def"]);
  assert.deepEqual(eligibleStarterSlots(null,slots),[]);
});
