import assert from "node:assert/strict";
import test from "node:test";
import { contractRanks, landingForPeriod, periodYears } from "./insightsPeriods.js";

test("last three years is a calendar range, even when a saved year is missing", () => {
  assert.deepEqual(periodYears([2021, 2023, 2025], { mode: "last3" }), [2023, 2025]);
});
test("ranges aggregate manager identity across renames and weight records by games", () => {
  const summary = (season, team_name, wins, losses, total_points) => ({ season, standings: [{ owner_id: "one", team_name, wins, losses, total_points, weeks_scored: wins + losses }] });
  const landing = { seasons: [2023, 2024, 2025], season_summaries: [summary(2023, "Before", 10, 0, 100), summary(2024, "After", 1, 9, 200), summary(2025, "Latest", 2, 0, 999)], champions: [] };
  const result = landingForPeriod(landing, { mode: "range", from: 2023, through: 2024 });
  assert.equal(result.record_leaders.length, 1);
  assert.equal(result.record_leaders[0].win_pct, 0.55);
  assert.equal(result.scoring_leaders[0].total_points, 300);
  assert.equal(result.record_leaders[0].team_name, "After");
});
test("contract return sums costs and points before dividing; zero counts, missing does not", () => {
  const row = (deal_id, season, salary, points, position = "WR") => ({ deal_id, season, salary, points, position });
  const ranks = contractRanks([row("a", 2023, 1, 100), row("a", 2024, 99, 0), row("renewal", 2024, 20, 200), row("zero", 2024, 30, 0), row("missing", 2024, 30, null), row("qb", 2024, 1, 300, "QB")], [2023, 2024], "WR");
  assert.equal(ranks.count, 3);
  assert.equal(ranks.best[0].deal_id, "renewal");
  assert.equal(ranks.best.find((r) => r.deal_id === "a").return, 1);
  assert.equal(ranks.worst[0].deal_id, "zero");
  assert.equal(contractRanks(ranks.best, [2022]).count, 0);
});
