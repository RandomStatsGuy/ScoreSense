/**
 * Run with: node --test frontend/src/projectionsPresentation.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BOARD_COPY,
  CONTEXT_COPY,
  analystDisclosureSummary,
  filterInspectorCandidates,
  injuryDisclosureSummary,
  matchesSeasonBoardFilter,
  median,
  heroRead,
  heroWeekStatusLine,
  methodInsight,
  opportunityInsight,
  rangeInsight,
  percentile,
  roleOutlook,
  seasonBoardSignals,
  seasonRead,
  starterCutoff,
  weeklyBoardPreview,
  weeklyBoardSignals,
  weeklyPeerStats,
  weeklyRowClickIntent,
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

test("weekly why-now reserves elite for the top three starters", () => {
  const rows = Array.from({ length: 16 }, (_, i) => ({
    Player: `QB${i + 1}`,
    player_id: `q${i}`,
    "Projected Points": 24 - i,
    "Low (P10)": 14 - i * 0.4,
    "High (P90)": 26 - i * 0.4,
  }));
  const peers = weeklyPeerStats(rows, { position: "qb" });
  assert.match(weeklyWhyNow(rows[0], peers, { rank: 1, position: "qb" }), /Elite median/i);
  assert.match(weeklyWhyNow(rows[7], peers, { rank: 8, position: "qb" }), /Expected starter/i);
  assert.doesNotMatch(weeklyWhyNow(rows[7], peers, { rank: 8, position: "qb" }), /Elite/i);
  assert.match(weeklyWhyNow(rows[14], peers, { rank: 15, position: "qb" }), /Depth look/i);
});

test("weekly board preview carries the clicked P10/P50/P90", () => {
  const row = {
    Player: "Lamar Jackson",
    player_id: "lj",
    "Projected Points": 23.1,
    "Low (P10)": 10.3,
    "High (P90)": 32.6,
  };
  const preview = weeklyBoardPreview(row, {}, { rank: 1, position: "qb", whyNow: "Elite median" });
  assert.equal(preview.p10, 10.3);
  assert.equal(preview.p50, 23.1);
  assert.equal(preview.p90, 32.6);
  assert.equal(preview.whyNow, "Elite median");
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
  assert.match(signals[3].value, /Mahomes/);
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

test("this-week inspector copy is locker plus delta, not a show recap", () => {
  assert.equal(CONTEXT_COPY.title, "This week");
  assert.match(CONTEXT_COPY.support, /locker note/i);
  assert.doesNotMatch(JSON.stringify(CONTEXT_COPY), /YouTube|Draft Hub|Submit/i);
});

test("weekly compare is a mode and the name still opens details", () => {
  assert.equal(weeklyRowClickIntent({ compareSelecting: false, fromName: false }), "inspect");
  assert.equal(weeklyRowClickIntent({ compareSelecting: false, fromName: true }), "inspect");
  assert.equal(weeklyRowClickIntent({ compareSelecting: true, fromName: true }), "inspect");
  assert.equal(weeklyRowClickIntent({ compareSelecting: true, fromName: false }), "select");
  assert.match(BOARD_COPY.compareHint, /name still opens details/i);
  assert.doesNotMatch(JSON.stringify(BOARD_COPY), /checkbox|Submit|Draft Hub/i);
});

test("opportunity insight stays out of the board and names the week move", () => {
  assert.equal(opportunityInsight({ "Opportunity Adjustment": 0 }), null);
  const hit = opportunityInsight({ "Opportunity Adjustment": 0.15 });
  assert.equal(hit.title, "+15%");
  assert.match(hit.detail, /teammate availability/i);
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

test("hero read collapses range and role into one strip", () => {
  const range = rangeInsight("Best ceiling; meaningfully wider band");
  const role = roleOutlook({ rank: 1, position: "qb" });
  const hero = heroRead({ range, role });
  assert.equal(hero.title, "Best ceiling · Locked-in starter");
  assert.match(hero.detail, /wider band/i);
  assert.match(hero.detail, /Volume and availability/i);
  assert.doesNotMatch(hero.title, /Role outlook|Range read/i);
});

test("hero week status line stays compact", () => {
  assert.equal(
    heroWeekStatusLine({}),
    `${CONTEXT_COPY.availabilityEmpty} · ${CONTEXT_COPY.opportunityEmptyCompact}`,
  );
  assert.equal(heroWeekStatusLine({ availability: "Q", opportunity: "+1.2" }), "Q · +1.2");
  assert.doesNotMatch(CONTEXT_COPY.staleInline, /Submit|Draft Hub|permission/i);
});

test("role outlook and inspector search stay specific", () => {
  assert.equal(roleOutlook({ rank: 2, position: "qb" }).title, "Locked-in starter");
  assert.equal(roleOutlook({ rank: 20, position: "qb" }).title, "Depth / dart throw");
  assert.equal(roleOutlook({ position: "qb" }).title, "Depth / dart throw");
  const hits = filterInspectorCandidates([
    { playerId: "1", name: "Matthew Stafford", team: "LAR" },
    { playerId: "2", name: "Josh Allen", team: "BUF" },
  ], "staff");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, "Matthew Stafford");
});

test("method insight distinguishes live season from preseason", () => {
  assert.equal(methodInsight({ scope: "season", scheduleAware: true }).title, "Schedule-aware total");
  assert.equal(methodInsight({ scope: "season" }).title, "Preseason estimate");
  assert.equal(methodInsight({ scope: "season", seasonMode: "live" }).title, "Live season + ROS");
  assert.equal(
    methodInsight({ scope: "season", scheduleAware: true, seasonMode: "live" }).title,
    "Live season + ROS",
  );
  assert.equal(methodInsight({ scope: "weekly" }).title, "Weekly PPR model");
});

test("live season signals ignore schedule-aware draft method metadata", () => {
  const rows = [
    {
      Player: "Josh Allen",
      player_id: "ja",
      "Season Proj": 350,
      "Season P10": 300,
      "Season P90": 400,
      "Per-Game Proj": 22,
    },
  ];
  const live = seasonBoardSignals(rows, {
    scope: "live",
    method: "mc_schedule_v1",
    featureSeason: 2025,
    draftSeason: 2026,
  });
  assert.equal(live[3].name, "Live season + ROS");
  assert.match(live[3].value, /Calibrated as games are played/);
  const preseason = seasonBoardSignals(rows, {
    scope: "preseason",
    method: "mc_schedule_v1",
    featureSeason: 2025,
    draftSeason: 2026,
  });
  assert.equal(preseason[3].name, "Schedule-aware");
  assert.match(preseason[3].value, /Bye weeks included/);
});
