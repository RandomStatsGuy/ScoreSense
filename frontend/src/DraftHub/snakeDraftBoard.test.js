import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDraftBoard,
  columnTeamId,
  configuredRounds,
  formatPickLabel,
  overallPickForCell,
  pickIndexForCell,
  picksByOverall,
  slotInRound,
  visibleRoundWindow,
  viewerNextPick,
} from "./snakeDraftBoard.js";

const ORDER_12 = Array.from({ length: 12 }, (_, i) => `t${i + 1}`);
const TEAMS_12 = ORDER_12.map((id, i) => ({ id, name: `Team ${i + 1}` }));

function eventsForOveralls(pairs) {
  return pairs.map(([overall, teamId, name]) => ({
    event_type: "pick",
    payload: {
      overall,
      round: Math.ceil(overall / 12),
      team_id: teamId,
      team_name: teamId,
      player_name: name,
      position: "WR",
      team: "KC",
    },
  }));
}

test("snake round 1 flows left to right under stable columns", () => {
  const n = 12;
  for (let col = 0; col < n; col += 1) {
    assert.equal(overallPickForCell(0, col, n, "snake"), col + 1);
    assert.equal(slotInRound(0, col, n, "snake"), col + 1);
    assert.equal(columnTeamId(ORDER_12, col), `t${col + 1}`);
  }
});

test("snake round 2 reverses pick sequence but not team columns", () => {
  const n = 12;
  // Last original seat (column 11) owns 2.01 / overall 13.
  assert.equal(overallPickForCell(1, 11, n, "snake"), 13);
  assert.equal(slotInRound(1, 11, n, "snake"), 1);
  // First original seat (column 0) owns 2.12 / overall 24.
  assert.equal(overallPickForCell(1, 0, n, "snake"), 24);
  assert.equal(slotInRound(1, 0, n, "snake"), 12);
  assert.equal(columnTeamId(ORDER_12, 0), "t1");
  assert.equal(columnTeamId(ORDER_12, 11), "t12");
});

test("snake round 3 matches round 1 ownership", () => {
  const n = 12;
  assert.equal(overallPickForCell(2, 0, n, "snake"), 25);
  assert.equal(overallPickForCell(2, 11, n, "snake"), 36);
});

test("linear never reverses column ownership", () => {
  const n = 12;
  for (const rnd of [0, 1, 2]) {
    assert.equal(overallPickForCell(rnd, 0, n, "linear"), rnd * n + 1);
    assert.equal(overallPickForCell(rnd, 11, n, "linear"), rnd * n + 12);
    assert.equal(slotInRound(rnd, 0, n, "linear"), 1);
  }
});

test("buildDraftBoard marks current, viewer, and filled cells without reversing columns", () => {
  const events = eventsForOveralls([
    [1, "t1", "Puka Nacua"],
    [12, "t12", "Brock Bowers"],
    [13, "t12", "Jahmyr Gibbs"],
  ]);
  const board = buildDraftBoard({
    nominationOrder: ORDER_12,
    teams: TEAMS_12,
    events,
    draftType: "snake",
    currentOverall: 14,
    viewerTeamId: "t1",
    rules: { roster_size_max: 16, draft_type: "snake" },
  });
  assert.equal(board.totalRounds, 16);
  assert.equal(board.columns[0].teamId, "t1");
  assert.equal(board.columns[11].teamId, "t12");
  const r1 = board.rows[0].cells;
  const r2 = board.rows[1].cells;
  assert.equal(r1[0].pick.player_name, "Puka Nacua");
  assert.equal(r1[11].pick.player_name, "Brock Bowers");
  assert.equal(r2[11].pick.player_name, "Jahmyr Gibbs");
  assert.equal(r2[11].isSnakeTurn, true);
  assert.equal(r2[10].isActive, true);
  assert.equal(r2[10].overall, 14);
  assert.equal(r1[0].isViewer, true);
  assert.equal(r2[0].isViewer, true);
  assert.equal(r2[0].overall, 24);
});

test("linear board keeps the same team in column 0 every round", () => {
  const board = buildDraftBoard({
    nominationOrder: ["a", "b", "c"],
    teams: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }, { id: "c", name: "Gamma" }],
    events: [],
    draftType: "linear",
    currentOverall: 4,
    viewerTeamId: "a",
    totalRounds: 3,
  });
  assert.equal(board.rows[0].cells[0].teamId, "a");
  assert.equal(board.rows[1].cells[0].teamId, "a");
  assert.equal(board.rows[2].cells[0].teamId, "a");
  assert.equal(board.rows[1].cells[0].overall, 4);
  assert.equal(board.rows[1].cells[0].isActive, true);
  assert.equal(board.rows[1].reverses, false);
});

test("missing events and junk payloads do not crash the board", () => {
  const junk = [
    { event_type: "bid", payload: { amount: 3 } },
    { event_type: "pick", payload: { player_name: "No overall" } },
    null,
  ];
  const board = buildDraftBoard({
    nominationOrder: ORDER_12,
    teams: TEAMS_12,
    events: junk,
    draftType: "snake",
    currentOverall: 1,
    viewerTeamId: "t3",
    rules: { roster_size_max: 8 },
  });
  assert.equal(board.rows.length, 8);
  assert.equal(board.rows[0].cells[0].filled, false);
  assert.equal(board.rows[0].cells[0].isActive, true);
  assert.equal(picksByOverall(junk).size, 0);
});

test("viewerNextPick reports snake turn distance", () => {
  const next = viewerNextPick({
    order: ORDER_12,
    viewerTeamId: "t12",
    currentOverall: 12,
    draftType: "snake",
    totalRounds: 16,
  });
  assert.equal(next.overall, 12);
  assert.equal(next.isCurrent, true);
  const after = viewerNextPick({
    order: ORDER_12,
    viewerTeamId: "t1",
    currentOverall: 2,
    draftType: "snake",
    totalRounds: 16,
  });
  assert.equal(after.label, formatPickLabel(2, 12));
  assert.equal(after.picksAway, 22);
});

test("configuredRounds uses roster_size_max for 8/10/12/14 team boards", () => {
  for (const n of [8, 10, 12, 14]) {
    const board = buildDraftBoard({
      nominationOrder: Array.from({ length: n }, (_, i) => `t${i}`),
      teams: Array.from({ length: n }, (_, i) => ({ id: `t${i}`, name: `T${i}` })),
      events: [],
      draftType: "snake",
      currentOverall: 1,
      rules: { roster_size_max: 16 },
    });
    assert.equal(board.teamCount, n);
    assert.equal(board.totalRounds, 16);
    assert.equal(board.rows[1].cells[0].overall, 2 * n);
  }
  assert.equal(configuredRounds({ roster_size_max: 15 }), 15);
});

test("pickIndexForCell is inverse of overall for snake and linear", () => {
  for (const dtype of ["snake", "linear"]) {
    for (const n of [8, 10, 12, 14]) {
      for (let rnd = 0; rnd < 3; rnd += 1) {
        for (let col = 0; col < n; col += 1) {
          const idx = pickIndexForCell(rnd, col, n, dtype);
          assert.equal(idx, overallPickForCell(rnd, col, n, dtype) - 1);
        }
      }
    }
  }
});

test("live board window keeps the current round between adjacent rounds", () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({ round: index + 1 }));
  assert.deepEqual(visibleRoundWindow(rows, 1).map((row) => row.round), [1, 2, 3]);
  assert.deepEqual(visibleRoundWindow(rows, 4).map((row) => row.round), [3, 4, 5]);
  assert.deepEqual(visibleRoundWindow(rows, 8).map((row) => row.round), [6, 7, 8]);
});

test("completed boards do not invent an extra on-the-clock round", () => {
  const board = buildDraftBoard({
    nominationOrder: ["a", "b"],
    teams: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
    events: eventsForOveralls([
      [1, "a", "One"],
      [2, "b", "Two"],
      [3, "b", "Three"],
      [4, "a", "Four"],
    ]),
    draftType: "snake",
    currentOverall: 5,
    viewerTeamId: "a",
    totalRounds: 2,
  });
  assert.equal(board.currentRound, 2);
  assert.equal(board.currentOverall, 0);
  assert.equal(board.nextPick, null);
  assert.equal(board.rows.flatMap((row) => row.cells).some((cell) => cell.isActive), false);
});
