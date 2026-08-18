import test from "node:test";
import assert from "node:assert/strict";
import {
  changeRecordToRow,
  formatP50Move,
  formatRankMove,
  hasMovement,
  isFaller,
  isLeftSlate,
  leftSlateRowsFromChanges,
  mergeRowsForMovementFilter,
  movementEmptyMessage,
  EMPTY_NO_MATERIAL,
  EMPTY_NO_PRIOR,
} from "./projectionMovement.js";

test("formatP50Move hides zero and missing deltas", () => {
  assert.equal(formatP50Move(0), null);
  assert.equal(formatP50Move(0.0), null);
  assert.equal(formatP50Move("0.0"), null);
  assert.equal(formatP50Move(null), null);
  assert.equal(formatP50Move(undefined), null);
});

test("formatP50Move keeps signed non-zero moves", () => {
  assert.equal(formatP50Move(1.2), "+1.2");
  assert.equal(formatP50Move(-0.8), "−0.8");
});

test("formatRankMove hides unchanged ranks", () => {
  assert.equal(
    formatRankMove({
      previousRank: 1,
      currentRank: 1,
      rankDelta: 0,
      position: "QB",
    }),
    null,
  );
  assert.equal(
    formatRankMove({
      previousRank: 1,
      currentRank: 1,
      position: "QB",
    }),
    null,
  );
});

test("formatRankMove keeps real rank changes", () => {
  assert.equal(
    formatRankMove({
      previousRank: 18,
      currentRank: 11,
      rankDelta: 7,
      position: "RB",
    }),
    "RB18 → RB11 ▲7",
  );
  assert.equal(
    formatRankMove({
      previousRank: 2,
      currentRank: 5,
      rankDelta: -3,
      position: "QB",
    }),
    "QB2 → QB5 ▼3",
  );
});

test("formatRankMove renders left-slate as QB12 → —", () => {
  assert.equal(
    formatRankMove({
      previousRank: 12,
      currentRank: null,
      rankDelta: -12,
      position: "QB",
      slateStatus: "left",
    }),
    "QB12 → — ▼12",
  );
  assert.equal(
    formatRankMove({
      previousRank: 8,
      currentRank: null,
      position: "RB",
      slateStatus: "left",
    }),
    "RB8 → —",
  );
});

test("hasMovement ignores zero-delta rows", () => {
  assert.equal(hasMovement({ p50_delta: 0, rank_delta: 0 }), false);
  assert.equal(hasMovement({ p50_delta: 0.4, rank_delta: 0 }), true);
  assert.equal(hasMovement({ p50_delta: 0, rank_delta: -2 }), true);
  assert.equal(hasMovement({ slate_status: "left", previous_rank: 5 }), true);
});

test("movementEmptyMessage maps empty_reason codes", () => {
  assert.match(
    movementEmptyMessage(EMPTY_NO_PRIOR, null),
    /prior projection snapshot/i,
  );
  assert.match(
    movementEmptyMessage(EMPTY_NO_MATERIAL, null, { filterId: "movers" }),
    /No material movers/i,
  );
  assert.equal(
    movementEmptyMessage(EMPTY_NO_MATERIAL, "Custom note from API"),
    "Custom note from API",
  );
});

test("left slate rows merge into movers/fallers only", () => {
  const current = [
    {
      player_id: "a",
      Player: "Stayer",
      rank_delta: -4,
      p50_delta: -2,
      movement_material: true,
    },
  ];
  const changes = [
    {
      player_id: "gone",
      player_name: "Gone QB",
      position: "QB",
      team: "MIN",
      previous_rank: 12,
      current_rank: null,
      rank_delta: -12,
      p50_delta: -18,
      material: true,
      slate_status: "left",
    },
  ];
  const leftRows = leftSlateRowsFromChanges(changes);
  assert.equal(leftRows.length, 1);
  assert.equal(isLeftSlate(leftRows[0]), true);
  assert.equal(isFaller(leftRows[0]), true);

  assert.equal(mergeRowsForMovementFilter(current, leftRows, "all").length, 1);
  assert.equal(mergeRowsForMovementFilter(current, leftRows, "movers").length, 2);
  assert.equal(mergeRowsForMovementFilter(current, leftRows, "fallers").length, 2);
  assert.equal(mergeRowsForMovementFilter(current, leftRows, "risers").length, 1);

  const row = changeRecordToRow(changes[0]);
  assert.equal(row.Player, "Gone QB");
  assert.equal(row["Projected Points"], null);
  assert.equal(
    formatRankMove({
      previousRank: row.previous_rank,
      currentRank: row.current_rank,
      rankDelta: row.rank_delta,
      position: row.Position,
      slateStatus: row.slate_status,
    }),
    "QB12 → — ▼12",
  );
});
