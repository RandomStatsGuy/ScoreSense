/**
 * Run with: node --test frontend/src/projectionsPresentation.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  analystDisclosureSummary,
  filterInspectorCandidates,
  injuryDisclosureSummary,
  matchesSeasonBoardFilter,
  median,
  methodInsight,
  percentile,
  roleOutlook,
  seasonBoardSignals,
  seasonRead,
  starterCutoff,
  weeklyBoardSignals,
  weeklyPeerStats,
  weeklyWhyNow,
} from "./projectionsPresentation.js";

test("median and percentile ignore non-finite values", () => {
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([]), null);
  assert.equal(percentile([10, 20, 30, 40], 75), 30);
});

test("weekly why-now marks elite medians and wide bands", () => {
  const rows = [
    { Player: "A", "Projected Points": 22, "Low (P10)": 16, "High (P90)": 28, player_id: "a" },
    { Player: "B", "Projected Points": 18, "Low (P10)": 15, "High (P90)": 21, player_id: "b" },
    { Player: "C", "Projected Points": 14, "Low (P10)": 11, "High (P90)": 17, player_id: "c" },
  ];
  const peers = weeklyPeerStats(rows);
  const text = weeklyWhyNow(rows[0], peers, { rank: 1, position: "qb" });
  assert.match(text, /Elite median/i);
  assert.match(text, /wider-than-average|highest-variance/i);
});

test("weekly why-now explains suppressed and left-slate rows", () => {
  assert.match(
    weeklyWhyNow({ "Injury Status": "Out" }),
    /suppressed/i,
  );
  assert.match(
    weeklyWhyNow({ slate_status: "left" }),
    /Left this week's slate/,
  );
});

test("weekly signals pick top P50, safest floor, and riser", () => {
  const rows = [
    {
      Player: "Lamar Jackson",
      "Projected Points": 23.1,
      "Low (P10)": 12,
      "High (P90)": 30,
      player_id: "lj",
    },
    {
      Player: "Matthew Stafford",
      "Projected Points": 20,
      "Low (P10)": 14.1,
      "High (P90)": 26,
      player_id: "ms",
      rank_delta: 5,
      previous_rank: 7,
      current_rank: 2,
    },
  ];
  const signals = weeklyBoardSignals(rows, {
    position: "qb",
    attentionItems: [{
      injury: { full_name: "Patrick Mahomes" },
      status: "Questionable",
      playerId: "pm",
    }],
  });
  assert.equal(signals[0].name, "Lamar Jackson");
  assert.equal(signals[1].name, "Matthew Stafford");
  assert.match(signals[2].value, /▲5/);
  assert.equal(signals[3].name, "1 starter");
  assert.equal(signals[3].playerName, "Patrick Mahomes");
  assert.match(signals[3].value, /Mahomes/);
});

test("live season signals ignore schedule-aware draft metadata", () => {
  const signals = seasonBoardSignals([
    {
      Player: "Josh Allen",
      player_id: "ja",
      "Season Proj": 350,
      "Season P10": 300,
      "Season P90": 400,
    },
  ], {
    method: "mc_schedule_v1",
    featureSeason: 2025,
    draftSeason: 2026,
    scope: "live",
  });
  const model = signals.find((s) => s.id === "model");
  assert.equal(model.name, "Live season + ROS");
  assert.doesNotMatch(model.value, /inputs|Bye weeks/i);
});

test("method insight distinguishes live season from preseason", () => {
  assert.equal(methodInsight({ scope: "season", seasonMode: "live" }).title, "Live season + ROS");
  assert.equal(methodInsight({ scope: "season", scheduleAware: true }).title, "Schedule-aware total");
  assert.equal(methodInsight({ scope: "season" }).title, "Preseason estimate");
});

test("season read flags the tightest leading band", () => {
  const rows = [
    {
      Player: "Stafford",
      player_id: "ms",
      "Season Proj": 358,
      "Season P10": 327,
      "Season P90": 388,
    },
    {
      Player: "Allen",
      player_id: "ja",
      "Season Proj": 350,
      "Season P10": 275,
      "Season P90": 389,
    },
  ];
  const peers = {
    medianSpread: 80,
    maxP90: 389,
    tightestTop: { row: rows[0], band: { p10: 327, p50: 358, p90: 388, spread: 61 } },
  };
  assert.match(seasonRead(rows[0], peers, { rank: 1, position: "qb" }), /Tightest band/i);
  assert.match(seasonRead(rows[1], peers, { rank: 2, position: "qb" }), /Best ceiling|wider/i);
});

test("season board filters use starter cutoff and upside spread", () => {
  assert.equal(starterCutoff("qb"), 12);
  assert.equal(matchesSeasonBoardFilter("starters", { rank: 8, position: "qb" }), true);
  assert.equal(matchesSeasonBoardFilter("starters", { rank: 20, position: "qb" }), false);
  assert.equal(matchesSeasonBoardFilter("upside", { spread: 90, peers: { spreadP75: 80 } }), true);
  assert.equal(matchesSeasonBoardFilter("upside", { spread: 40, peers: { spreadP75: 80 } }), false);
});

test("disclosure summaries name the consequence", () => {
  assert.match(
    injuryDisclosureSummary({ count: 12, attentionCount: 1, name: "Mahomes", status: "Q" }),
    /1 projected starter needs attention/,
  );
  assert.match(
    analystDisclosureSummary({ count: 0, week: 1, historicalAvailable: true }),
    /older coverage available/i,
  );
});

test("role outlook and inspector search stay specific", () => {
  assert.equal(roleOutlook({ rank: 2, position: "qb" }).title, "Locked-in starter");
  assert.equal(roleOutlook({ rank: 20, position: "qb" }).title, "Depth / dart throw");
  const hits = filterInspectorCandidates([
    { playerId: "1", name: "Matthew Stafford", team: "LAR" },
    { playerId: "2", name: "Josh Allen", team: "BUF" },
  ], "staff");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, "Matthew Stafford");
});
