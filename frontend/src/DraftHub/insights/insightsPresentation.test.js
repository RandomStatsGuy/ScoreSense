/**
 * Insights talking-point helpers.
 * Run with: node --test frontend/src/DraftHub/insights/insightsPresentation.test.js
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  awardCatalogFromRules,
  featureAwards,
  fieldRankShare,
  formatRecordLine,
  formatScoringRankValue,
  formatSpendValue,
  INSIGHTS_COPY,
  insightsHeroStatus,
  mostTitlesLine,
  overviewRecordRows,
  overviewScoringRows,
  pickDiscussablePosition,
  positionSpendLeaders,
  scoringRaceRows,
  rankShowsTeam,
  teamDisplayName,
} from "./insightsPresentation.js";

const teams = [
  {
    team_id: "a",
    team_name: "Air Raid",
    spend_by_position: { QB: 40, RB: 10, WR: 50, TE: 5 },
    pct_by_position: { QB: 20, RB: 5, WR: 25, TE: 2.5 },
  },
  {
    team_id: "b",
    team_name: "Ground Game",
    spend_by_position: { QB: 8, RB: 55, WR: 12, TE: 6 },
    pct_by_position: { QB: 4, RB: 27.5, WR: 6, TE: 3 },
  },
  {
    team_id: "c",
    team_name: "Balanced",
    spend_by_position: { QB: 18, RB: 22, WR: 24, TE: 8 },
    pct_by_position: { QB: 9, RB: 11, WR: 12, TE: 4 },
  },
];

test("featureAwards mixes gold, shame, and bargain first", () => {
  const awards = [
    { id: "other", tone: "neutral", title: "Nomad" },
    { id: "bargain", tone: "good", title: "Steal" },
    { id: "overpay", tone: "bad", title: "Most over market" },
    { id: "king", tone: "gold", title: "Highest salary" },
    { id: "extra", tone: "good", title: "Also good" },
  ];
  const { featured, rest } = featureAwards(awards, 4);
  assert.deepEqual(featured.map((a) => a.id), ["king", "overpay", "bargain", "extra"]);
  assert.deepEqual(rest.map((a) => a.id), ["other"]);
});

test("featureAwards handles a short list without padding", () => {
  const { featured, rest } = featureAwards([{ id: "king", tone: "gold" }], 4);
  assert.equal(featured.length, 1);
  assert.equal(rest.length, 0);
});

test("positionSpendLeaders ranks RB spend and reports the gap", () => {
  const leaders = positionSpendLeaders(teams, ["QB", "RB", "WR", "TE"]);
  const rb = leaders.find((row) => row.position === "RB");
  assert.equal(rb.leader.teamName, "Ground Game");
  assert.equal(rb.max, 55);
  assert.equal(rb.gap, 33);
  assert.equal(rb.ranked[0].pctOfLeader, 100);
});

test("pickDiscussablePosition chooses the widest skill-position gap", () => {
  const leaders = positionSpendLeaders(teams, ["QB", "RB", "WR", "TE"]);
  assert.equal(pickDiscussablePosition(leaders), "RB");
});

test("scoringRaceRows sorts by points and measures the gap from first", () => {
  const rows = scoringRaceRows([
    { team_name: "Second", total_points: 1100, avg_points: 110 },
    { team_name: "First", total_points: 1400, avg_points: 140 },
    { team_name: "Third", total_points: 900, avg_points: 90 },
  ]);
  assert.deepEqual(rows.map((r) => r.label), ["First", "Second", "Third"]);
  assert.equal(rows[1].gapFromFirst, 300);
  assert.equal(rows[0].pctOfLeader, 100);
  assert.ok(rows[0].fillPct > rows[1].fillPct);
  assert.ok(rows[1].fillPct > rows[2].fillPct);
});

test("fieldRankShare starts near the field, so a 1,700-point career gap is visible", () => {
  const values = [12576, 11090.8, 11030, 10869];
  const first = fieldRankShare(12576, values);
  const justin = fieldRankShare(11090.8, values);
  const colby = fieldRankShare(11030, values);
  const last = fieldRankShare(10869, values);
  assert.equal(first, 100);
  assert.ok(justin - colby > 2, "shorter total must get a shorter bar");
  assert.ok(first - last > 70, "career spread must not collapse into the top sliver");
  assert.ok(last >= 6);
});

test("overview scoring rows keep fill independent of label width and show the gap", () => {
  const rows = overviewScoringRows([
    { team_name: "Leader", owner_name: "Alex A", total_points: 12576 },
    { team_name: "Justin", owner_name: "Justin P", total_points: 11090.8 },
    { team_name: "Colby", owner_name: "Colby L", total_points: 11030 },
  ]);
  assert.equal(rows[1].label, "Justin P");
  assert.equal(formatScoringRankValue(rows[0]), "Leader");
  assert.match(formatScoringRankValue(rows[1]), /−1,485/);
  assert.ok(rows[1].fillPct > rows[2].fillPct);
});

test("overview record rows show W-L only and scale from the field", () => {
  const rows = overviewRecordRows([
    { team_name: "A", wins: 49, losses: 19, ties: 0, games: 68, win_pct: 0.721 },
    { team_name: "B", wins: 40, losses: 28, ties: 0, games: 68, win_pct: 0.588 },
  ]);
  assert.equal(formatRecordLine(rows[0]), "49-19");
  assert.doesNotMatch(formatRecordLine(rows[0]), /%/);
  assert.ok(rows[0].fillPct > rows[1].fillPct);
});

test("mostTitlesLine sits on the Titles panel, not as a dangling hero word", () => {
  assert.equal(
    mostTitlesLine({ titles: 3, team_name: "The Deported Panda", owner_name: "Stephen P" }),
    "Stephen P · 3 titles",
  );
  assert.equal(mostTitlesLine({ titles: 1, team_name: "Solo" }), "");
});

test("awardCatalogFromRules applies commissioner overrides", () => {
  const catalog = awardCatalogFromRules({
    insight_award_titles: { points_king: "Scoring champ" },
  });
  const king = catalog.find((row) => row.id === "points_king");
  assert.equal(king.title, "Scoring champ");
  assert.equal(king.default_title, "Most points");
});

test("insights heroes name the argument, not a recap slogan", () => {
  assert.match(INSIGHTS_COPY.overview.heading, /already won|titles|records/i);
  assert.doesNotMatch(INSIGHTS_COPY.overview.heading, /overpays/i);
  assert.doesNotMatch(INSIGHTS_COPY.overview.support, /Spend shows/i);
  assert.match(INSIGHTS_COPY.overview.support, /titles|records|career points/i);
  assert.match(INSIGHTS_COPY.overview.supportWithSeasons("5 seasons"), /across 5 seasons/);
  assert.doesNotMatch(INSIGHTS_COPY.overview.supportWithSeasons("5 seasons"), /overpays|Spend shows/);
  assert.match(INSIGHTS_COPY.spend.support, /overspend|thin/i);
  assert.match(INSIGHTS_COPY.history.support, /paper trail|trade/i);
  assert.doesNotMatch(INSIGHTS_COPY.overview.heading, /league so far|Draft Hub|Submit/i);
});

test("formatSpendValue and hero status stay screenshot-ready", () => {
  assert.equal(formatSpendValue(42.2, "dollars"), "$42");
  assert.equal(formatSpendValue(12.34, "pct"), "12.3%");
  assert.equal(
    insightsHeroStatus([{ title: "Highest salary", headline: "$85 on roster right now" }]),
    "Highest salary · $85 on roster right now",
  );
  assert.equal(
    insightsHeroStatus([{
      title: "Titles",
      owner_name: "Stephen P",
      team_name: "The Deported Panda",
      title_count: 3,
    }]),
    "Stephen P · The Deported Panda · 3 titles",
  );
  assert.equal(teamDisplayName({ team_name: "Air Raid" }), "Air Raid");
  assert.equal(
    teamDisplayName({ team_name: "White Supremacists" }, { "White Supremacists": "Caleb K" }, false),
    "Caleb K",
  );
  assert.equal(
    teamDisplayName({ team_name: "White Supremacists" }, { "White Supremacists": "Caleb K" }, true),
    "Caleb K · White Supremacists",
  );
  assert.equal(rankShowsTeam({ label: "Caleb K", teamName: "White Supremacists" }), true);
  assert.equal(rankShowsTeam({ label: "Caleb K · White Supremacists", teamName: "White Supremacists" }), false);
});
