import assert from "node:assert/strict";
import test from "node:test";
import {
  BOARD_SIZE,
  QUEUE_CAP,
  STRATEGY_RANK_COPY,
  applyOrder,
  applyPick,
  boardContext,
  buildSiteBoard,
  contextFingerprint,
  nextPair,
  orderFromBoard,
  pairKey,
  queueFromOrder,
  rankDelta,
  scoringIsSupported,
  scoringLabel,
  similarEnough,
  siteScore,
} from "./strategyRank.js";

const jeanty = {
  player_id: "j",
  player: "Ashton Jeanty",
  position: "RB",
  status: "available",
  is_available: true,
  fair_value: 41,
  season_p50: 240,
};
const bijan = {
  player_id: "b",
  player: "Bijan Robinson",
  position: "RB",
  status: "available",
  is_available: true,
  fair_value: 38,
  season_p50: 235,
};
const chase = {
  player_id: "c",
  player: "Ja'Marr Chase",
  position: "WR",
  status: "available",
  is_available: true,
  fair_value: 42,
  season_p50: 312,
};
const keeper = {
  player_id: "k",
  player: "Lamar Jackson",
  position: "QB",
  status: "mine",
  is_available: false,
  fair_value: 34,
  season_p50: 390,
};

test("site board drops keepers and ranks auction by suggested bid", () => {
  const board = buildSiteBoard([keeper, bijan, jeanty, chase], { draftType: "auction" });
  assert.equal(board.length, 3);
  assert.equal(board[0].player_id, "c");
  assert.equal(board[1].player_id, "j");
  assert.equal(board[2].player_id, "b");
  assert.equal(board[0].site_rank, 1);
  assert.equal(siteScore(chase, { draftType: "auction" }), 42);
});

test("pick draft site score uses season P50, not dollars", () => {
  assert.equal(siteScore(chase, { draftType: "snake" }), 312);
  const board = buildSiteBoard([bijan, chase], { draftType: "snake" });
  assert.equal(board[0].player_id, "c");
});

test("pairwise insert puts the winner immediately above the loser", () => {
  const order = ["c", "j", "b"];
  const moved = applyPick(order, "b", "j");
  assert.equal(moved.moved, true);
  assert.deepEqual(moved.order, ["c", "b", "j"]);
  assert.equal(moved.from, 3);
  assert.equal(moved.to, 2);
});

test("pick is a no-op when the winner is already above", () => {
  const order = ["c", "j", "b"];
  const stayed = applyPick(order, "j", "b");
  assert.equal(stayed.moved, false);
  assert.deepEqual(stayed.order, order);
});

test("next pair prefers personal-board neighbors inside the similarity band", () => {
  const board = applyOrder(
    buildSiteBoard([chase, jeanty, bijan], { draftType: "auction" }),
    ["c", "j", "b"],
  );
  const pair = nextPair(board, { ctx: { draftType: "auction" }, posFilter: "RB" });
  assert.ok(pair);
  assert.equal(pair.neighbor, true);
  assert.deepEqual([pair.a.player_id, pair.b.player_id].sort(), ["b", "j"]);
});

test("seen pairs and unlike scores are skipped", () => {
  const far = { ...bijan, player_id: "x", fair_value: 6, season_p50: 90 };
  const board = buildSiteBoard([jeanty, far], { draftType: "auction" });
  assert.equal(similarEnough(jeanty, far, { draftType: "auction" }), false);
  const pair = nextPair(board, {
    ctx: { draftType: "auction" },
    seenKeys: [pairKey("j", "b")],
  });
  assert.equal(pair, null);
});

test("queue write is the existing 40-name nomination cap", () => {
  const ids = Array.from({ length: 50 }, (_, i) => `p${i}`);
  assert.equal(queueFromOrder(ids).length, QUEUE_CAP);
  assert.equal(BOARD_SIZE, 80);
});

test("context fingerprint changes when scoring or draft type changes", () => {
  const a = contextFingerprint(boardContext({ season: 2026, draftType: "auction" }));
  const b = contextFingerprint(boardContext({ season: 2026, draftType: "snake" }));
  assert.notEqual(a, b);
  assert.equal(scoringIsSupported("dynasty"), false);
  assert.equal(scoringIsSupported("hub_ppr"), true);
  assert.equal(scoringLabel("hub_ppr"), "Hub PPR");
});

test("rank delta is site minus mine and copy stays draft-night", () => {
  assert.equal(rankDelta({ site_rank: 6, personal_rank: 2 }), 4);
  assert.match(STRATEGY_RANK_COPY.useMine, /Draft/);
  assert.doesNotMatch(Object.values(STRATEGY_RANK_COPY).join(" "), /Draft Hub|Submit|Tinder/);
  const board = buildSiteBoard([chase, jeanty, bijan], { draftType: "auction" });
  assert.deepEqual(orderFromBoard(board), ["c", "j", "b"]);
});
