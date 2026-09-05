import assert from "node:assert/strict";
import test from "node:test";
import {
  STRATEGY_RANK_COPY,
  contextLine,
  takeLabel,
} from "./strategyRankPresentation.js";

test("Strategy copy is draft-night and names the two pages", () => {
  assert.match(STRATEGY_RANK_COPY.viewRankings, /rankings/i);
  assert.match(STRATEGY_RANK_COPY.backToCalls, /close calls/i);
  assert.match(STRATEGY_RANK_COPY.useMine, /Draft/);
  assert.match(STRATEGY_RANK_COPY.emptyBoard, /available|keepers/i);
  assert.match(STRATEGY_RANK_COPY.emptyPairAll, /Reset seen pairs/i);
  assert.doesNotMatch(STRATEGY_RANK_COPY.emptyPairAll, /Open All/i);
  const joined = Object.values(STRATEGY_RANK_COPY)
    .map((value) => (typeof value === "function" ? value("Jeanty") : value))
    .join(" ");
  assert.doesNotMatch(joined, /Draft Hub|Submit|Tinder|permission/i);
});

test("context line and take label stay short", () => {
  assert.equal(
    contextLine({ scoringProfile: "hub_ppr", draftType: "auction", teamCount: 12 }),
    "PPR",
  );
  assert.equal(
    contextLine({ scoringProfile: "hub_ppr", leagueName: "Sunday Cap" }),
    "Sunday Cap · PPR",
  );
  assert.equal(takeLabel({ player: "Ashton Jeanty" }), "Take Jeanty");
  assert.equal(STRATEGY_RANK_COPY.moved(1), "1 name moved");
  assert.equal(STRATEGY_RANK_COPY.rankingsMineHint(1), "After 1 close call.");
  assert.equal(STRATEGY_RANK_COPY.rankingsMineHint(2), "After 2 close calls.");
});
