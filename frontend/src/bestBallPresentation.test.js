/**
 * Run with: node --test frontend/src/bestBallPresentation.test.js
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  BB_NO_ECR_LABEL,
  bestBallBoardNote,
  bestBallCsvLines,
  bestBallEdgeLegendCopy,
  bestBallGroupLabel,
  bestBallHeroCopy,
  bestBallScoringNote,
  bestBallSorts,
  bestBallStatusChip,
  bestBallSummaryItems,
  buildBoardItems,
  byeLabel,
  edgeTone,
  filterBoardRows,
  formatEcr,
  formatEdge,
  formatRank,
  shouldGroupBoard,
  sortBoardRows,
} from "./bestBallPresentation.js";

const ROWS = [
  { Player: "Alpha Back", Position: "RB", Team: "KC", model_rank: 3, adp_rank: 20, value_vs_adp: 17, bye_week: 9, "Season Proj": 280.4, player_id: "a" },
  { Player: "Beta Wideout", Position: "WR/TE", Team: "MIN", model_rank: 1, adp_rank: 2, value_vs_adp: 1, bye_week: 6, "Season Proj": 310.2, player_id: "b" },
  { Player: "Gamma Passer", Position: "QB", Team: "BUF", model_rank: 8, adp_rank: null, value_vs_adp: null, bye_week: 12, "Season Proj": 350.9, player_id: "c" },
  { Player: "Delta Reach", Position: "RB", Team: "NYJ", model_rank: 40, adp_rank: 12, value_vs_adp: -28, bye_week: 10, "Season Proj": 190.0, player_id: "d" },
  { Player: "Epsilon Quiet", Position: "WR/TE", Team: "LAR", model_rank: 22, adp_rank: null, value_vs_adp: null, bye_week: 5, "Season Proj": 140.0, player_id: "e" },
];

test("sortBoardRows groups Pos rank by position so ranks do not interleave", () => {
  assert.deepEqual(
    sortBoardRows(ROWS, "model").map((r) => r.player_id),
    ["c", "a", "d", "b", "e"],
  );
  const edge = sortBoardRows(ROWS, "edge").map((r) => r.player_id);
  assert.equal(edge[0], "a");
  assert.equal(edge[edge.length - 1], "e");
  assert.deepEqual(
    sortBoardRows(ROWS, "adp").map((r) => r.player_id),
    ["b", "d", "a", "c", "e"],
  );
  assert.deepEqual(
    sortBoardRows(ROWS, "missing").map((r) => r.player_id),
    ["c", "e", "a", "d", "b"],
  );
});

test("filterBoardRows narrows by position, search, and ECR coverage", () => {
  assert.equal(filterBoardRows(ROWS, { position: "RB" }).length, 2);
  assert.equal(filterBoardRows(ROWS, { search: "gamma" }).length, 1);
  assert.equal(filterBoardRows(ROWS, { position: "QB", search: "alpha" }).length, 0);
  assert.deepEqual(
    filterBoardRows(ROWS, { coverage: "missing" }).map((r) => r.player_id),
    ["c", "e"],
  );
  assert.equal(filterBoardRows(ROWS, { coverage: "ranked" }).length, 3);
});

test("edge formatting names discount and reach without amber caution", () => {
  assert.equal(formatEdge(17), "+17");
  assert.equal(formatEdge(-28), "-28");
  assert.equal(formatEdge(null), "");
  assert.equal(edgeTone(17), "discount");
  assert.equal(edgeTone(-28), "reach");
  assert.equal(edgeTone(3), "");
  assert.equal(byeLabel(9), "Wk 9");
  assert.equal(byeLabel(null), "—");
  assert.equal(formatRank(12.0), "12");
  assert.equal(formatEcr(null), BB_NO_ECR_LABEL);
  assert.equal(formatEcr(4), "4");
});

test("status chip and sorts keep Edge off an ECR-only board", () => {
  assert.equal(bestBallStatusChip({ loading: true }).tone, "readonly");
  const noAdp = bestBallStatusChip({ count: 100, withAdp: 0 });
  assert.match(noAdp.label, /no ECR/i);
  assert.equal(bestBallStatusChip({ count: 643, withAdp: 245 }).label, "643 players");
  assert.deepEqual(bestBallSorts({ ecrOnly: true }).map((s) => s.id), ["model", "adp", "missing"]);
  assert.deepEqual(
    bestBallSorts({ ecrOnly: false, withAdp: 12 }).map((s) => s.id),
    ["model", "adp", "missing", "edge"],
  );
  assert.equal(bestBallSorts({ ecrOnly: false, withAdp: 12 }).find((s) => s.id === "edge").label, "Edge");
});

test("hero names Edge sign and scoring without a roadmap note", () => {
  const hero = bestBallHeroCopy();
  assert.match(hero.support, /plus is a discount/i);
  assert.match(hero.support, /minus is a reach/i);
  assert.doesNotMatch(hero.support, /until a real ADP|placeholder|roadmap/i);
  assert.equal(bestBallScoringNote(), "Scoring: PPR");
  assert.match(bestBallEdgeLegendCopy(), /\+10/);
  assert.match(bestBallBoardNote(), /FantasyPros consensus/);
});

test("summary keeps only With ECR and csv marks No ECR", () => {
  const items = bestBallSummaryItems({
    count: 4,
    withAdp: 3,
  });
  assert.deepEqual(items.map((i) => i.id), ["adp"]);
  assert.equal(items[0].value, "3 of 4");

  const lines = bestBallCsvLines(ROWS.slice(0, 1));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /"#"/);
  assert.match(lines[0], /"Edge"$/);
  assert.match(lines[1], /"Alpha Back"/);
  assert.match(lines[1], /"\+17"$/);

  const missing = bestBallCsvLines(ROWS.slice(2, 3));
  assert.match(missing[1], /"No ECR"/);
});

test("board items add a monotonic index and position headers on Pos rank", () => {
  assert.equal(shouldGroupBoard("model", "ALL"), true);
  assert.equal(shouldGroupBoard("model", "RB"), false);
  assert.equal(shouldGroupBoard("edge", "ALL"), false);
  const grouped = buildBoardItems(sortBoardRows(ROWS, "model"), { groupByPosition: true });
  assert.equal(grouped[0].type, "group");
  assert.equal(grouped[0].position, "QB");
  assert.equal(bestBallGroupLabel("QB", 1), "QB · 1");
  const players = grouped.filter((item) => item.type === "player");
  assert.deepEqual(players.map((item) => item.index), [1, 2, 3, 4, 5]);
  assert.deepEqual(players.map((item) => item.row.player_id), ["c", "a", "d", "b", "e"]);
});
