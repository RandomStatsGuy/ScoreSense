import test from "node:test";
import assert from "node:assert/strict";
import {
  hasScoredFantasyPoints,
  shouldShowScoringTables,
  scoringWaitingCopy,
  ownershipRefreshAffordance,
} from "./insightsEmptyStates.js";

test("hasScoredFantasyPoints is false for empty/unavailable", () => {
  assert.equal(hasScoredFantasyPoints(null), false);
  assert.equal(hasScoredFantasyPoints({ available: false }), false);
  assert.equal(hasScoredFantasyPoints({
    available: true,
    standings: [{ total_points: 0 }, { total_points: 0 }],
    weeks: [],
  }), false);
});

test("hasScoredFantasyPoints detects standings or weekly points", () => {
  assert.equal(hasScoredFantasyPoints({
    available: true,
    standings: [{ total_points: 12.5 }],
  }), true);
  assert.equal(hasScoredFantasyPoints({
    available: true,
    standings: [{ total_points: 0 }],
    weeks: [{ teams: [{ points: 0 }, { points: 8.2 }] }],
  }), true);
});

test("shouldShowScoringTables hides preseason and zero-filled shells", () => {
  assert.equal(shouldShowScoringTables({
    available: true,
    preseason: true,
    standings: [{ total_points: 0 }],
  }), false);
  assert.equal(shouldShowScoringTables({
    available: true,
    preseason: false,
    standings: [{ total_points: 0 }, { total_points: 0 }],
    weeks: [],
  }), false);
  assert.equal(shouldShowScoringTables({
    available: true,
    preseason: false,
    standings: [{ total_points: 100 }],
  }), true);
});

test("scoringWaitingCopy prefers API hint", () => {
  const pre = scoringWaitingCopy({ preseason: true, hint: "Custom preseason" });
  assert.equal(pre.title, "Season has not started");
  assert.equal(pre.body, "Custom preseason");
  const wait = scoringWaitingCopy({ preseason: false });
  assert.equal(wait.title, "Waiting for scored games");
});

test("ownershipRefreshAffordance disables when Sleeper not linked", () => {
  const out = ownershipRefreshAffordance(
    { hint: "Tap Refresh history to load season-by-season ownership from Sleeper." },
    {},
  );
  assert.equal(out.canRefresh, false);
  assert.equal(out.emphasize, false);
  assert.match(out.showHint, /Link your Sleeper/i);
  assert.ok(!/Tap Refresh/i.test(out.showHint));
});

test("ownershipRefreshAffordance emphasizes cold-cache refresh CTA", () => {
  const out = ownershipRefreshAffordance(
    {
      hint: "Tap Refresh history to load season-by-season ownership from Sleeper (first load may take a minute).",
    },
    { sleeper_league_id: "sl1" },
  );
  assert.equal(out.canRefresh, true);
  assert.equal(out.emphasize, true);
  assert.match(out.showHint, /Tap Refresh history/i);
});

test("ownershipRefreshAffordance quiets after synced history", () => {
  const out = ownershipRefreshAffordance(
    {
      has_sleeper_history: true,
      ownership_synced_at: "2026-08-01T00:00:00Z",
      hint: "Tap Refresh history to load…",
    },
    { sleeper_league_id: "sl1" },
  );
  assert.equal(out.canRefresh, true);
  assert.equal(out.emphasize, false);
  assert.equal(out.showHint, null);
});
