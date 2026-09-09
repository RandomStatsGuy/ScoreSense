import assert from "node:assert/strict";
import test from "node:test";
import {
  auctionFloor,
  buildNominationTaxMap,
  needExistsInSlice,
  playerFitsNeed,
  sortRowsByTax,
} from "./draftNominationTax.js";

const RULES = {
  roster: {
    qb: { min: 1, max: 2, starter: 1 },
    rb: { min: 2, max: 6, starter: 2 },
    te: { min: 1, max: 3, starter: 1 },
  },
};

const me = { id: "me", owner_name: "Maya", name: "Maya", budget_remaining: 40 };
const rich = {
  id: "rich",
  owner_name: "Alex",
  name: "Storm",
  budget_remaining: 88,
};
const poor = {
  id: "poor",
  owner_name: "Chris",
  name: "Chris",
  budget_remaining: 12,
};

const keeper = (position) => ({ position, contract_years: 2, source: "draft" });
const rosters = {
  me: [keeper("QB")],
  rich: [keeper("RB"), keeper("RB")],
  poor: [keeper("RB"), keeper("RB")],
};

const rows = [
  { player_id: "te1", player: "Tight End", position: "TE", fair_value: 14 },
  { player_id: "rb1", player: "Runner", position: "RB", fair_value: 32 },
  { player_id: "qb1", player: "Passer", position: "QB", fair_value: 20 },
];

test("Need keeps your hole that still fits leftover", () => {
  assert.equal(playerFitsNeed({ row: rows[2], needPositions: ["QB"], leftover: 40 }), true);
  assert.equal(playerFitsNeed({ row: rows[1], needPositions: ["QB"], leftover: 40 }), false);
  assert.equal(playerFitsNeed({ row: rows[2], needPositions: ["QB"], leftover: 10 }), false);
});

test("Tax picks the rival with the most leftover at that hole", () => {
  const map = buildNominationTaxMap({
    rows,
    teams: [me, rich, poor],
    rosters,
    viewerTeamId: "me",
    rules: RULES,
    minBid: 1,
  });
  assert.equal(map.te1.rival_owner_name, "Alex · Storm");
  assert.equal(map.te1.rival_budget_remaining, 88);
  assert.equal(map.te1.rival_hole_position, "TE");
  assert.equal(map.rb1, undefined);
});

test("Tax sort puts the richest rival hole first", () => {
  const map = {
    te1: { rival_budget_remaining: 88, suggested_bid: 14 },
    qb1: { rival_budget_remaining: 40, suggested_bid: 20 },
  };
  assert.deepEqual(
    sortRowsByTax(rows, map).map((row) => row.player_id),
    ["te1", "qb1", "rb1"],
  );
});

test("Tax sort treats a missing suggested bid as unset, not zero", () => {
  const tied = [
    { player_id: "zero", player: "Alpha", position: "TE" },
    { player_id: "null", player: "Bravo", position: "TE" },
  ];
  const map = {
    zero: { rival_budget_remaining: 50, suggested_bid: 0 },
    null: { rival_budget_remaining: 50, suggested_bid: null },
  };
  assert.deepEqual(
    sortRowsByTax(tied, map).map((row) => row.player_id),
    ["zero", "null"],
  );
});

test("a zero min bid still taxes a rival sitting on leftover 0", () => {
  const broke = { id: "broke", owner_name: "Pat", name: "Pat", budget_remaining: 0 };
  const map = buildNominationTaxMap({
    rows: [{ player_id: "te1", player: "Tight End", position: "TE", fair_value: 14 }],
    teams: [me, broke],
    rosters: { me: [keeper("QB")], broke: [keeper("RB"), keeper("RB")] },
    viewerTeamId: "me",
    rules: RULES,
    minBid: 0,
  });
  assert.equal(auctionFloor(0), 0);
  assert.equal(map.te1.rival_owner_name, "Pat");
});

test("Need slice ignores leftover when asking if a hole still has names", () => {
  assert.equal(needExistsInSlice(rows, { needPositions: ["QB"] }), true);
  assert.equal(needExistsInSlice(rows, { needPositions: ["QB"], search: "zzz" }), false);
  assert.equal(needExistsInSlice(rows, { needPositions: ["QB"], position: "TE" }), false);
});
