/**
 * Run with: node --test frontend/src/bestBallPresentation.test.js
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  bestBallBoardNote,
  bestBallCsvLines,
  bestBallSorts,
  bestBallStatusChip,
  bestBallSummaryItems,
  byeLabel,
  edgeTone,
  filterBoardRows,
  formatEdge,
  formatRank,
  sortBoardRows,
} from "./bestBallPresentation.js";

const ROWS = [
  { Player: "Alpha Back", Position: "RB", Team: "KC", model_rank: 3, adp_rank: 20, value_vs_adp: 17, bye_week: 9, "Season Proj": 280.4, player_id: "a" },
  { Player: "Beta Wideout", Position: "WR/TE", Team: "MIN", model_rank: 1, adp_rank: 2, value_vs_adp: 1, bye_week: 6, "Season Proj": 310.2, player_id: "b" },
  { Player: "Gamma Passer", Position: "QB", Team: "BUF", model_rank: 8, adp_rank: null, value_vs_adp: null, bye_week: 12, "Season Proj": 350.9, player_id: "c" },
  { Player: "Delta Reach", Position: "RB", Team: "NYJ", model_rank: 40, adp_rank: 12, value_vs_adp: -28, bye_week: 10, "Season Proj": 190.0, player_id: "d" },
];

test("sortBoardRows supports model, edge, and adp orders", () => {
  assert.deepEqual(
    sortBoardRows(ROWS, "model").map((r) => r.player_id),
    ["b", "a", "c", "d"],
  );
  const edge = sortBoardRows(ROWS, "edge").map((r) => r.player_id);
  assert.equal(edge[0], "a"); // biggest positive edge first
  assert.equal(edge[edge.length - 1], "c"); // missing ADP sinks
  assert.deepEqual(
    sortBoardRows(ROWS, "adp").map((r) => r.player_id),
    ["b", "d", "a", "c"],
  );
});

test("filterBoardRows narrows by position and search", () => {
  assert.equal(filterBoardRows(ROWS, { position: "RB" }).length, 2);
  assert.equal(filterBoardRows(ROWS, { search: "gamma" }).length, 1);
  assert.equal(filterBoardRows(ROWS, { position: "QB", search: "alpha" }).length, 0);
});

test("edge formatting and tones flag discounts and reaches", () => {
  assert.equal(formatEdge(17), "+17");
  assert.equal(formatEdge(-28), "-28");
  assert.equal(formatEdge(null), "—");
  assert.equal(edgeTone(17), "positive");
  assert.equal(edgeTone(-28), "caution");
  assert.equal(edgeTone(3), "");
  assert.equal(byeLabel(9), "Wk 9");
  assert.equal(byeLabel(null), "—");
  assert.equal(formatRank(12.0), "12");
});

test("status chip and note explain missing ECR without offering ADP-edge sort", () => {
  assert.equal(bestBallStatusChip({ loading: true }).tone, "readonly");
  const noAdp = bestBallStatusChip({ count: 100, withAdp: 0 });
  assert.match(noAdp.label, /no ECR/i);
  assert.equal(bestBallBoardNote({ count: 100, withAdp: 0 }), "");
  assert.deepEqual(bestBallSorts({ ecrOnly: true }).map((s) => s.id), ["model", "adp"]);
});

test("summary items and csv rows cover the board", () => {
  const items = bestBallSummaryItems({
    season: 2026,
    count: 4,
    withAdp: 3,
    sortId: "edge",
    positionId: "RB",
    filteredCount: 2,
  });
  assert.equal(items.find((i) => i.id === "adp").label, "With ECR");
  assert.equal(items.find((i) => i.id === "adp").value, "3 of 4");
  assert.equal(items.find((i) => i.id === "sort").value, "ADP edge");

  const lines = bestBallCsvLines(ROWS.slice(0, 1));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /"Edge"$/);
  assert.match(lines[1], /"Alpha Back"/);
  assert.match(lines[1], /"\+17"$/);
});
