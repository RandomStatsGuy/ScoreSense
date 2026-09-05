/**
 * Run with: node --test frontend/src/DraftHub/gameCenterPresentation.test.js
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  duelRows,
  findViewerMatchup,
  formatDraftNightDate,
  formatMatchupRecord,
  formatMatchupScore,
  formatWinProb,
  GAME_CENTER_COPY,
  gameCenterBanner,
  gameCenterHeroCopy,
  gameCenterStandingRows,
  gameCenterTeamLabel,
  gameStateLabel,
  scoresArePlaceholder,
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
  const payload = { viewer_matchup_id: "5", matchups: [{ matchup_id: "4" }, MATCHUP] };
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
  const uneven = duelRows({ starters: [{ name: "Mahomes", position: "QB" }] }, { starters: [] }, []);
  assert.equal(uneven.length, 1);
  assert.equal(uneven[0].away, null);
  const emptySlots = duelRows({ starters: [] }, { starters: [] }, ["QB", "RB", "WR"]);
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
    opponent: { ...opponent, team_name: "Daddio", starters: [{ points: 12 }], points: 90.0 },
  });
  assert.match(final, /^Final: Daddio takes it by 2.7/);
});

test("game center labels lead with owner and keep the team nickname", () => {
  assert.equal(
    gameCenterTeamLabel({ team_name: "White Supremacists", owner_name: "Caleb K" }),
    "Caleb K · White Supremacists",
  );
  const line = matchupStoryline({
    viewer: { points: 10, starters: [{ points: 10 }] },
    opponent: { team_name: "Daddio of the Pandio", owner_name: "Colby L", points: 12, starters: [{ points: 12 }] },
    weekComplete: true,
  });
  assert.match(line, /Colby L/);
  assert.doesNotMatch(line, /^Final: Daddio of the Pandio/);
});

test("game state label distinguishes past weeks and preseason", () => {
  assert.equal(gameStateLabel({ preseason: true }), "Preseason");
  assert.equal(gameStateLabel({ placeholder: true, preseason: true }), "No scores yet");
  assert.equal(gameStateLabel({ week: 10, current_week: 12 }), "Final");
  assert.equal(gameStateLabel({ week: 12, current_week: 12 }), "Next games Thu");
  assert.equal(gameStateLabel({ week: 12, current_week: 12, live: true }), "Live");
  assert.equal(
    gameStateLabel({
      week: 1,
      current_week: 1,
      matchups: [{ teams: [{ points: 87 }] }],
    }),
    "Next games Thu",
  );
});

test("empty duel copy names This Week", () => {
  assert.match(GAME_CENTER_COPY.emptyDuel, /This Week|lineup/i);
  assert.equal(GAME_CENTER_COPY.setLineup, "Set lineup");
  assert.doesNotMatch(GAME_CENTER_COPY.emptyDuel, /Draft Hub|Submit/i);
  assert.equal(GAME_CENTER_COPY.loadingChip, "Loading");
  assert.equal(GAME_CENTER_COPY.unscoredChip, "No scores yet");
  assert.equal(GAME_CENTER_COPY.emptyLineupHeading, "Your lineup is empty.");
  assert.match(GAME_CENTER_COPY.emptyLineupSupport, /score zero/i);
  assert.equal(GAME_CENTER_COPY.openDraft, "Open draft room");
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
  const compact = gameCenterStandingRows(rows, "t12", { compact: true, limit: 6 });
  assert.ok(compact.some((row) => row.hub_team_id === "t12"));
  assert.ok(compact.length <= 6);
  const full = gameCenterStandingRows(rows.slice(0, 10), "t10", { compact: true });
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

test("hero names the empty-lineup cost before kickoff", () => {
  const hero = gameCenterHeroCopy({ emptyLineup: true, placeholder: true });
  assert.equal(hero.heading, GAME_CENTER_COPY.emptyLineupHeading);
  assert.equal(hero.support, GAME_CENTER_COPY.emptyLineupSupport);
  const live = gameCenterHeroCopy({
    live: true,
    viewer: { points: 20, starters: [{ points: 20 }] },
    opponent: { points: 10, starters: [{ points: 10 }], team_name: "Daddio" },
  });
  assert.match(live.heading, /you win by 10/);
});

test("pre-draft treats last year's Sleeper week as placeholder scores", () => {
  assert.equal(scoresArePlaceholder({ placeholder: false, week: 1 }, { draft_completed: false }), true);
  assert.equal(gameStateLabel({ week: 1, current_week: 1, status: "complete" }, { draft_completed: false }), GAME_CENTER_COPY.unscoredChip);
  assert.equal(scoresArePlaceholder({ placeholder: false }, { draft_completed: true }), false);
});

test("unstarted scores say not started instead of a bare dash", () => {
  assert.deepEqual(formatMatchupScore(null, { placeholder: true }), {
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
    opponent: { team_name: "White Supremacists", owner_name: "Caleb K", roster_id: "z" },
    placeholder: true,
    week: 1,
    hint: GAME_CENTER_COPY.emptyPreseason,
  });
  assert.equal(named, "Week 1 vs Caleb K · White Supremacists");
});
