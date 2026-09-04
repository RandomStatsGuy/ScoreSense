/**
 * Insights talking-point helpers.
 * Run with: node --test frontend/src/DraftHub/insights/insightsPresentation.test.js
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  featureAwards,
  formatSpendValue,
  INSIGHTS_COPY,
  insightsHeroStatus,
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
});

test("insights heroes name the argument, not a recap slogan", () => {
  assert.match(INSIGHTS_COPY.overview.heading, /overpays/i);
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
