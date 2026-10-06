/**
 * Run with: node --test frontend/src/DraftHub/gameCenterPresentation.test.js
 */
import assert from "node:assert/strict";
import test from "node:test";
import { weeklyMatchupForecast, nativeScoreRefreshMessage, nativeScoreRefreshVariant } from "./gameCenterPresentation.js";

test("upcoming native weeks show neutral copy even with an older no-stats failure", () => {
  for (const refresh of [null, {status:"pending"}, {status:"upcoming"}, {status:"failed",error:"no_stats"}]) {
    const data = {scoring_control:{week_started:false,scored:false,refresh}};
    assert.equal(nativeScoreRefreshMessage(data), GAME_CENTER_COPY.scoreUpcoming);
    assert.equal(nativeScoreRefreshVariant(data), "info");
  }
});

test("started and unknown weeks retain real stats failures and retry messages", () => {
  for (const week_started of [true, null, undefined]) {
    const data = {scoring_control:{week_started,refresh:{status:"failed",error:"no_stats"}}};
    assert.equal(nativeScoreRefreshMessage(data), GAME_CENTER_COPY.scoreStatsUnavailable);
    assert.equal(nativeScoreRefreshVariant(data), "warn");
    data.scoring_control.refresh.status = "running";
    assert.equal(nativeScoreRefreshMessage(data), GAME_CENTER_COPY.scoreRefreshPending);
  }
  assert.equal(nativeScoreRefreshMessage({scoring_control:{final:true,week_started:false}}), "");
  assert.equal(nativeScoreRefreshMessage({source:"sleeper"}), "");
  assert.equal(nativeScoreRefreshMessage({scoring_control:{scored:true,week_started:false,refresh:{status:"failed",error:"settings_changed"}}}), GAME_CENTER_COPY.scoreRulesChanged);
});

test("weekly matchup forecast requires complete starter projections and preserves zero", () => {
  const team = projections => ({starters:projections.map(proj => ({name:"Player",proj}))});
  assert.equal(weeklyMatchupForecast(team([10, 0]), team([8, 1])).label, "Projected favored by 1.0 points");
  assert.equal(weeklyMatchupForecast(team([10, null]), team([8, 1])).margin, undefined);
  assert.equal(weeklyMatchupForecast(team([10, NaN]), team([8, 1])).margin, undefined);
  assert.equal(weeklyMatchupForecast(team([10]), team([10])).label, "Projected even");
  assert.equal(weeklyMatchupForecast(team([0]), team([10])).label, "Projected behind by 10.0 points");
  assert.equal(weeklyMatchupForecast({starters:[]}, team([10])).mine, null);
  assert.equal(weeklyMatchupForecast({starters:[{name:"Empty"},{name:"Player",proj:10}]}, team([8])).mine, 10);
});

test("forecast labels existing specialist estimates without concealing missing offense", () => {
  const mine = {starters:[{name:"QB",proj:20}, {name:"K",proj:8.4,projection_source:"rank_curve"}]};
  const theirs = {starters:[{name:"QB",proj:19}, {name:"K",proj:7.4,projection_source:"rank_curve"}]};
  assert.equal(weeklyMatchupForecast(mine, theirs).estimated, true);
  assert.equal(weeklyMatchupForecast(mine, theirs).label, "Projected favored by 2.0 points");
  mine.starters[0].proj = null;
  assert.equal(weeklyMatchupForecast(mine, theirs).margin, undefined);
  assert.match(GAME_CENTER_COPY.projectionBasisEstimated, /season-based kicker and defense estimates/);
});
import {
  duelRows,
  findViewerMatchup,
  formatDraftNightDate,
  formatMatchupRecord,
  formatMatchupScore,
  formatWinProb,
  GAME_CENTER_COPY,
  LEAGUE_SCORING_CONTROL_COPY,
  gameCenterPlayerScore,
  gameCenterTeamScore,
  gameCenterMatchupScores,
  playerGameState,
  gameCenterBanner,
  gameCenterHeroCopy,
  gameCenterStandingRows,
  gameCenterTeamLabel,
  gameStateLabel,
  scoresArePlaceholder,
  shouldPollGameCenter,
  interpretStandings,
  lineupIsEmpty,
  matchupStoryline,
  matchupTeams,
  shouldShowPrevWeek,
  standingsHaveResults,
  startersPending,
  trophyLeaderLabel,
  trophySummaryState,
  winProbFor,
} from "./gameCenterPresentation.js";

const MATCHUP = {
  matchup_id: "5",
  win_prob_by_roster: { 9: 0.73, 1: 0.27 },
  teams: [
    {
      roster_id: "9",
      team_name: "Panda Command",
      points: 87.3,
      is_viewer: true,
      starters: [
        { sleeper_player_id: "a", position: "QB", points: 24.7 },
        { sleeper_player_id: "b", position: "RB", points: 0 },
      ],
    },
    {
      roster_id: "1",
      team_name: "Daddio",
      points: 74.2,
      is_opponent: true,
      starters: [
        { sleeper_player_id: "c", position: "QB", points: 0 },
        { sleeper_player_id: "d", position: "RB", points: 22.4 },
      ],
    },
  ],
};

test("viewer matchup + team roles resolve", () => {
  const payload = {
    viewer_matchup_id: "5",
    matchups: [{ matchup_id: "4" }, MATCHUP],
  };
  assert.equal(findViewerMatchup(payload), MATCHUP);
  const { viewer, opponent } = matchupTeams(MATCHUP);
  assert.equal(viewer.team_name, "Panda Command");
  assert.equal(opponent.team_name, "Daddio");
  assert.equal(winProbFor(MATCHUP, viewer), 0.73);
  assert.equal(formatWinProb(0.73), "73%");
  assert.equal(formatWinProb(null), null);
});

test("duel rows pair starters by lineup slot", () => {
  const { viewer, opponent } = matchupTeams(MATCHUP);
  const rows = duelRows(viewer, opponent, ["QB", "RB"]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].slot, "QB");
  assert.equal(rows[0].home.points, 24.7);
  assert.equal(rows[0].away.points, 0);
  assert.equal(rows[1].slot, "RB");
  // Uneven lineups still render every slot.
  const uneven = duelRows(
    { starters: [{ name: "Mahomes", position: "QB" }] },
    { starters: [] },
    [],
  );
  assert.equal(uneven.length, 1);
  assert.equal(uneven[0].away, null);
  const emptySlots = duelRows({ starters: [] }, { starters: [] }, [
    "QB",
    "RB",
    "WR",
  ]);
  assert.equal(emptySlots.length, 0);
});

test("storyline names the lead and who is still to play", () => {
  const { viewer, opponent } = matchupTeams(MATCHUP);
  const line = matchupStoryline({ viewer, opponent });
  assert.match(line, /^You lead by 13.1/);
  assert.match(line, /1 starter left/);
  assert.equal(startersPending(viewer), 1);

  const final = matchupStoryline({
    viewer: { ...viewer, starters: [{ points: 10 }] },
    opponent: {
      ...opponent,
      team_name: "Daddio",
      starters: [{ points: 12 }],
      points: 90.0,
    },
  });
  assert.match(final, /^Final: Daddio takes it by 2.7/);
});

test("game center labels lead with owner and keep the team nickname", () => {
  assert.equal(
    gameCenterTeamLabel({
      team_name: "White Supremacists",
      owner_name: "Caleb K",
    }),
    "Caleb K · White Supremacists",
  );
  const line = matchupStoryline({
    viewer: { points: 10, starters: [{ points: 10 }] },
    opponent: {
      team_name: "Daddio of the Pandio",
      owner_name: "Colby L",
      points: 12,
      starters: [{ points: 12 }],
    },
    weekComplete: true,
  });
  assert.match(line, /Colby L/);
  assert.doesNotMatch(line, /^Final: Daddio of the Pandio/);
});

test("game state label distinguishes past weeks and preseason", () => {
  assert.equal(gameStateLabel({ preseason: true }), "Preseason");
  assert.equal(
    gameStateLabel({ placeholder: true, preseason: true }),
    "No scores yet",
  );
  assert.equal(gameStateLabel({ week: 10, current_week: 12 }), "Final");
  assert.equal(
    gameStateLabel({ week: 12, current_week: 12 }),
    "Not started",
  );
  assert.equal(
    gameStateLabel({ week: 12, current_week: 12, live: true }),
    "Live",
  );
  assert.equal(
    gameStateLabel({
      week: 1,
      current_week: 1,
      matchups: [{ teams: [{ points: 87 }] }],
    }),
    "Week in progress",
  );
});

test("empty duel copy names This Week", () => {
  assert.match(GAME_CENTER_COPY.emptyDuel, /This Week|lineup/i);
  assert.equal(GAME_CENTER_COPY.setLineup, "Set lineup");
  assert.doesNotMatch(GAME_CENTER_COPY.emptyDuel, /Draft Hub|Submit/i);
  assert.equal(GAME_CENTER_COPY.loadingChip, "Loading");
  assert.equal(GAME_CENTER_COPY.unscoredChip, "No scores yet");
  assert.equal(GAME_CENTER_COPY.emptyLineupHeading, "Your lineup is empty.");
  assert.match(GAME_CENTER_COPY.emptyLineupSupport, /Review your starters/i);
  assert.equal(GAME_CENTER_COPY.openDraft, "Open draft room");
});

test("native scoring determines final status independently of the calendar", () => {
  const control = { host: "native", scored: true, final: false, live: true };
  assert.equal(gameStateLabel({ week: 3, current_week: 4, scoring_control: control }), "Week in progress");
  assert.equal(gameStateLabel({ week: 4, current_week: 4, scoring_control: { ...control, final: true } }), "Final");
  assert.equal(gameStateLabel({ week: 4, current_week: 4, scoring_control: control, matchups: [{ teams: [{ points: 0 }] }] }), "Week in progress");
  assert.equal(gameStateLabel({ placeholder: true, scoring_control: { ...control, scored: false } }), "No scores yet");
});

test("standings stay unranked until a game is played", () => {
  const zero = [
    { roster_id: "1", hub_team_id: "a", rank: 1, wins: 0, losses: 0 },
    { roster_id: "2", hub_team_id: "you", rank: 10, wins: 0, losses: 0 },
  ];
  assert.equal(standingsHaveResults(zero), false);
  const view = interpretStandings(
    { standings: zero, placeholder: true, preseason: true },
    { phaseId: "pre_draft", draftCompleted: false },
  );
  assert.equal(view.ranked, false);
  assert.equal(view.note, GAME_CENTER_COPY.standingsUnranked);
  assert.equal(formatMatchupRecord(zero[1], { ranked: false }), "");
});

test("last-season records stay last season on Home and Game center", () => {
  const last = [
    { roster_id: "1", hub_team_id: "a", rank: 1, wins: 10, losses: 4 },
    { roster_id: "2", hub_team_id: "you", rank: 8, wins: 4, losses: 10 },
  ];
  assert.equal(standingsHaveResults(last), true);
  const view = interpretStandings(
    { standings: last, placeholder: true, standings_season: "last" },
    { phaseId: "pre_draft", draftCompleted: false },
  );
  assert.equal(view.ranked, true);
  assert.equal(view.historical, true);
  assert.equal(view.note, GAME_CENTER_COPY.standingsLastSeason);
  assert.equal(formatMatchupRecord(last[1], { ranked: true }), "4–10 · 8th");
});

test("standings list keeps the reader when compacting a large league", () => {
  const rows = Array.from({ length: 16 }, (_, i) => ({
    roster_id: String(i + 1),
    hub_team_id: `t${i + 1}`,
    rank: i + 1,
    wins: 8,
    losses: 6,
  }));
  const compact = gameCenterStandingRows(rows, "t12", {
    compact: true,
    limit: 6,
  });
  assert.ok(compact.some((row) => row.hub_team_id === "t12"));
  assert.ok(compact.length <= 6);
  const full = gameCenterStandingRows(rows.slice(0, 10), "t10", {
    compact: true,
  });
  assert.equal(full.length, 10);
});

test("pre-draft banner names draft night and opens the room", () => {
  const banner = gameCenterBanner({
    draftCompleted: false,
    draftStartsAt: "2026-09-05T23:00:00.000Z",
    placeholder: true,
    reason: "no_matchups",
  });
  assert.match(banner.text, /Draft night is/);
  assert.match(banner.text, /Week 1/);
  assert.doesNotMatch(banner.text, /kickoff|Link Sleeper/i);
  assert.equal(banner.action, "room");
  assert.equal(banner.actionLabel, GAME_CENTER_COPY.openDraft);
  assert.match(formatDraftNightDate("2026-09-05T23:00:00.000Z"), /Sep/);
});

test("hero identifies a confirmed empty viewer lineup", () => {
  const hero = gameCenterHeroCopy({
    emptyLineup: true,
    viewer: { starters: [] },
  });
  assert.equal(hero.heading, GAME_CENTER_COPY.emptyLineupHeading);
  assert.equal(hero.support, GAME_CENTER_COPY.emptyLineupSupport);
  const live = gameCenterHeroCopy({
    live: true,
    viewer: { points: 20, starters: [{ points: 20 }] },
    opponent: { points: 10, starters: [{ points: 10 }], team_name: "Daddio" },
  });
  assert.match(live.heading, /you win by 10/);
});

test("populated and unavailable lineups never claim the viewer lineup is empty", () => {
  const viewer = { starters: [{ name: "Quarterback", points: 0 }], points: 0 };
  const opponent = { starters: [], points: 0 };
  assert.equal(lineupIsEmpty(viewer, opponent), false);
  assert.notEqual(
    gameCenterHeroCopy({ viewer, opponent }).heading,
    GAME_CENTER_COPY.emptyLineupHeading,
  );
  assert.equal(lineupIsEmpty(null, opponent), false);
  assert.notEqual(
    gameCenterHeroCopy({ placeholder: true, emptyLineup: true }).heading,
    GAME_CENTER_COPY.emptyLineupHeading,
  );
  assert.notEqual(
    gameCenterHeroCopy({}).heading,
    GAME_CENTER_COPY.emptyLineupHeading,
  );
  assert.equal(lineupIsEmpty({ starters: [] }, viewer), true);
});

test("pre-draft treats last year's Sleeper week as placeholder scores", () => {
  assert.equal(
    scoresArePlaceholder(
      { placeholder: false, week: 1 },
      { draft_completed: false },
    ),
    true,
  );
  assert.equal(
    gameStateLabel(
      { week: 1, current_week: 1, status: "complete" },
      { draft_completed: false },
    ),
    GAME_CENTER_COPY.unscoredChip,
  );
  assert.equal(
    scoresArePlaceholder({ placeholder: false }, { draft_completed: true }),
    false,
  );
});

test("unstarted scores say not started instead of a bare dash", () => {
  assert.deepEqual(formatMatchupScore(null, { placeholder: true }), {
    score: "—",
    label: GAME_CENTER_COPY.notStarted,
  });
  assert.deepEqual(formatMatchupScore(0, { placeholder: true, proj: 0 }), {
    score: "—",
    label: GAME_CENTER_COPY.notStarted,
  });
  assert.equal(formatMatchupScore(12.4, { placeholder: false }).score, "12.4");
  assert.equal(shouldShowPrevWeek(1), false);
  assert.equal(shouldShowPrevWeek(2), true);
  assert.equal(lineupIsEmpty({ starters: [] }, { starters: [] }, []), true);
});

test("trophy summary leads with the owner, not the nickname", () => {
  const leader = { team_name: "Disappointment", owner_name: "Aaron D" };
  assert.equal(trophyLeaderLabel(leader), "Aaron D · Disappointment");
  assert.equal(
    trophySummaryState({ leader, votes: 1, youVoted: true }),
    "Aaron D · Disappointment · 1 vote · you voted",
  );
});

test("placeholder storyline keeps the slate and names the missing opponent", () => {
  const line = matchupStoryline({
    viewer: { team_name: "Commissioner" },
    opponent: { team_name: "Opponent TBD", roster_id: "tbd" },
    placeholder: true,
    week: 2,
    hint: GAME_CENTER_COPY.emptyNoSleeper,
  });
  assert.equal(line, "Week 2 opponent TBD");
  const paired = matchupStoryline({
    viewer: { team_name: "Alpha" },
    opponent: { team_name: "Zebra Squad", roster_id: "z" },
    placeholder: true,
    week: 1,
    hint: GAME_CENTER_COPY.emptyPreseason,
  });
  assert.equal(paired, "Week 1 vs Zebra Squad");
  const named = matchupStoryline({
    viewer: { team_name: "Alpha", owner_name: "Avery A" },
    opponent: {
      team_name: "White Supremacists",
      owner_name: "Caleb K",
      roster_id: "z",
    },
    placeholder: true,
    week: 1,
    hint: GAME_CENTER_COPY.emptyPreseason,
  });
  assert.equal(named, "Week 1 vs Caleb K · White Supremacists");
});

import {
  gameCenterWeek,
  gameCenterProjection,
  gameCenterLead,
} from "./gameCenterPresentation.js";
test("room deep links select the requested week and team without changing league focus", () => {
  for (const value of [null, "", "bad", 0, 19, 1.5])
    assert.equal(gameCenterWeek(value), null);
  assert.equal(gameCenterWeek("6"), 6);
  const away = { roster_id: "2", hub_team_id: "visiting" };
  const home = { roster_id: "1", hub_team_id: "mine", is_viewer: true };
  const selected = { matchup_id: "3", teams: [home, away] };
  const payload = { viewer_matchup_id: "3", matchups: [selected] };
  assert.equal(findViewerMatchup(payload, "visiting"), selected);
  assert.deepEqual(matchupTeams(selected, "visiting"), {
    viewer: away,
    opponent: home,
  });
  assert.equal(findViewerMatchup(payload, "unknown"), selected);
});
test("current forecasts preserve zero and do not imply a saved pregame baseline", () => {
  assert.equal(
    gameCenterProjection({ name: "Player", proj: 0 }),
    "Current forecast: 0.0",
  );
  assert.equal(
    gameCenterProjection({ name: "Player", proj: null }),
    "Projection unavailable",
  );
  assert.equal(
    gameCenterProjection({ name: "Empty" }),
    "No player is assigned to this slot.",
  );
  assert.equal(
    gameCenterLead({ points: 5.4 }, { points: 0 }),
    "5.4 point lead",
  );
});


test("unscored native leagues are not told to link Sleeper", () => {
  assert.equal(gameCenterBanner({ draftCompleted: true, placeholder: true, reason: "hub_unscored", sleeperLinked: false }), null);
  assert.match(LEAGUE_SCORING_CONTROL_COPY.result({ scored: false, reason: "week_in_progress" }), /still in progress/);
  assert.match(LEAGUE_SCORING_CONTROL_COPY.result({ scored: false, reason: "no_stats" }), /Existing scores have been kept/);
  assert.match(
    LEAGUE_SCORING_CONTROL_COPY.result({ scored: false, reason: "incomplete_historical_lineups" }),
    /This Week/,
  );
  assert.doesNotMatch(
    LEAGUE_SCORING_CONTROL_COPY.result({ scored: false, reason: "incomplete_historical_lineups" }),
    /stats are not available/i,
  );
  assert.match(
    LEAGUE_SCORING_CONTROL_COPY.result({ scored: true, live: true, week: 1, teams: 12 }),
    /live scores updated/,
  );
  assert.match(LEAGUE_SCORING_CONTROL_COPY.confirm(3), /Week 3/);
  assert.match(LEAGUE_SCORING_CONTROL_COPY.confirm(1, { live: true }), /can still be moved/);
  assert.match(LEAGUE_SCORING_CONTROL_COPY.nativeHelp, /updates scores/);
});

test("native Game center polls the current week until it is final", () => {
  const current = {
    available: true,
    source: "hub",
    week: 1,
    current_week: 1,
    placeholder: true,
    scoring_control: { final: false },
  };
  assert.equal(shouldPollGameCenter(current, { draft_completed: true }), true);
  assert.equal(
    shouldPollGameCenter(
      { ...current, scoring_control: { final: true }, placeholder: false },
      { draft_completed: true },
    ),
    false,
  );
  assert.equal(
    shouldPollGameCenter(current, { draft_completed: false }),
    false,
  );
  assert.equal(
    shouldPollGameCenter(
      { ...current, source: "sleeper", placeholder: true },
      { draft_completed: true, sleeper_league_id: "123" },
    ),
    true,
  );
  assert.equal(
    shouldPollGameCenter(
      { ...current, source: "sleeper", placeholder: false },
      { draft_completed: true, sleeper_league_id: "123" },
    ),
    true,
  );
});

test("player headlines follow their own game and preserve missing results", () => {
  const player = { name: "Player", proj: 15.9, pregame_projection: 15.2, points: 0, game_state: "pregame" };
  assert.equal(gameCenterPlayerScore(player, { live: true }).value, "15.9");
  assert.equal(gameCenterPlayerScore(player, { live: true }).label, "Current forecast");
  assert.equal(gameCenterPlayerScore({ ...player, game_state: "live" }, {}).value, "0.0");
  assert.equal(gameCenterPlayerScore({ ...player, game_state: "live", points: null }, {}).value, "—");
  assert.equal(playerGameState({ ...player, game_state: "unknown" }, { live: true }), "unknown");
  assert.equal(gameCenterPlayerScore({ ...player, proj: 0 }, {}).value, "0.0");
  assert.equal(gameCenterPlayerScore({ name: "Empty" }, {}).state, "empty");
});

test("final differences use saved baselines instead of refreshed forecasts", () => {
  const player = { name: "Player", game_state: "final", points: 20, proj: 24, pregame_projection: 16 };
  assert.equal(gameCenterPlayerScore(player).secondary, "4.0 above projection");
  assert.equal(gameCenterPlayerScore({ ...player, points: 10 }).secondary, "6.0 below projection");
  assert.equal(gameCenterPlayerScore({ ...player, pregame_projection: null }).secondary, "Pregame projection not saved");
});

test("pregame totals exclude empty slots but do not replace missing forecasts with zero", () => {
  const team = { points: 0, proj_total: 99, starters: [
    { name: "One", proj: 16, game_state: "pregame" },
    { name: "Two", proj: 0, game_state: "pregame" },
    { name: "Empty", proj: null },
  ] };
  assert.equal(gameCenterTeamScore(team).value, "16.0");
  assert.equal(gameCenterTeamScore(team).label, "Projected");
  assert.equal(gameCenterTeamScore({ ...team, starters: [...team.starters, { name: "Unknown", game_state: "pregame", proj: null }] }).value, "—");
  assert.equal(gameCenterTeamScore({ ...team, starters: team.starters.map((p) => ({ ...p, game_state: "live" })) }, { live: true }).value, "0.0");
});

test("mixed kickoff times never compare one team's actual points against the other's forecast", () => {
  const home = { points: 5.4, starters: [{ name: "One", proj: 15, game_state: "live" }] };
  const away = { points: 0, starters: [{ name: "Two", proj: 20, game_state: "pregame" }] };
  const scores = gameCenterMatchupScores(home, away, { live: true });
  assert.equal(scores.home.value, "5.4");
  assert.equal(scores.away.value, "0.0");
  assert.equal(scores.away.projected, "20.0");
});

test("a delayed native slate stays live when the calendar advances", () => {
  const data = {week:4,current_week:5,scoring_control:{host:"native",scored:true,final:false,live:true}};
  assert.equal(gameCenterPlayerScore({name:"Player",points:0,proj:16}, data).label, "Live");
  assert.equal(gameCenterPlayerScore({name:"Player",game_state:"pregame",points:0,proj:16}, data).value, "16.0");
});


test("minute score polling is reserved for live games", async () => {
  const {gameCenterPollMs}=await import("./gameCenterPresentation.js");
  assert.equal(gameCenterPollMs({live:true}),60_000);
  assert.equal(gameCenterPollMs({scoring_control:{live:true}}),60_000);
  assert.equal(gameCenterPollMs({live:false}),300_000);
  assert.equal(gameCenterPollMs({has_live_games:true}),60_000);
  assert.equal(gameCenterPollMs({has_live_games:false,scoring_control:{live:true}}),300_000);
});
