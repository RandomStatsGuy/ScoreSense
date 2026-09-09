import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultDraftPlayerRailSort,
  draftPlayerRailRows,
  draftPlayerRailValue,
} from "./draftPlayerRail.js";

const ROWS = [
  { player_id: "wr", player: "Wide Receiver", position: "WR", season_proj: 220, fair_value: 28 },
  { player_id: "te", player: "Tight End", position: "TE", season_proj: 180, fair_value: 17 },
  { player_id: "qb", player: "Quarterback", position: "QB", season_proj: 310, fair_value: 24 },
];

test("pick and auction rails use mode-appropriate default sorts", () => {
  assert.equal(defaultDraftPlayerRailSort(true), "season_proj");
  assert.equal(defaultDraftPlayerRailSort(false), "fair_value");
  assert.deepEqual(
    draftPlayerRailRows(ROWS, { pickDraft: true }).map((row) => row.player_id),
    ["qb", "wr", "te"],
  );
  assert.deepEqual(
    draftPlayerRailRows(ROWS, { pickDraft: false }).map((row) => row.player_id),
    ["wr", "qb", "te"],
  );
});

test("tax mode reorders the same rail by rival leftover", () => {
  const taxById = {
    te: { rival_budget_remaining: 90, suggested_bid: 17 },
    wr: { rival_budget_remaining: 20, suggested_bid: 28 },
  };
  assert.deepEqual(
    draftPlayerRailRows(ROWS, { mode: "tax", taxById }).map((row) => row.player_id),
    ["te", "wr", "qb"],
  );
});

test("the compact rail keeps TE visible and supports need-only filtering", () => {
  assert.deepEqual(
    draftPlayerRailRows(ROWS, { position: "TE" }).map((row) => row.player_id),
    ["te"],
  );
  assert.deepEqual(
    draftPlayerRailRows(ROWS, { needsOnly: true, needPositions: ["TE"] }).map((row) => row.player_id),
    ["te"],
  );
});

test("Need drops a hole that no longer fits leftover", () => {
  assert.deepEqual(
    draftPlayerRailRows(ROWS, {
      mode: "need",
      needPositions: ["QB", "TE"],
      leftover: 20,
    }).map((row) => row.player_id),
    ["te"],
  );
});

test("mode metric never exposes auction value in a pick draft", () => {
  const row = { season_proj: 201, fair_value: 42, risk_adjusted_value: 45 };
  assert.equal(draftPlayerRailValue(row, true), 201);
  assert.equal(draftPlayerRailValue(row, false), 45);
});
