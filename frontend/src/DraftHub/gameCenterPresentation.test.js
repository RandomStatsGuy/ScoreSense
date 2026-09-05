/**
 * Run with: node --test frontend/src/DraftHub/gameCenterPresentation.test.js
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  duelRows,
  findViewerMatchup,
  formatWinProb,
  GAME_CENTER_COPY,
  gameCenterTeamLabel,
  gameStateLabel,
  matchupStoryline,
  matchupTeams,
  startersPending,
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
  const uneven = duelRows({ starters: [{ position: "QB" }] }, { starters: [] }, []);
  assert.equal(uneven.length, 1);
  assert.equal(uneven[0].away, null);
  const emptySlots = duelRows({ starters: [] }, { starters: [] }, ["QB", "RB", "WR"]);
  assert.equal(emptySlots.length, 3);
  assert.equal(emptySlots[0].slot, "QB");
  assert.equal(emptySlots[2].home, null);
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

test("placeholder storyline keeps the slate and names the missing opponent", () => {
  const line = matchupStoryline({
    viewer: { team_name: "Commissioner" },
    opponent: { team_name: "Opponent TBD", roster_id: "tbd" },
    placeholder: true,
    week: 2,
    hint: GAME_CENTER_COPY.emptyNoSleeper,
  });
  assert.equal(line, "Week 2 opponent TBD. Link Sleeper to fill scores.");
  const paired = matchupStoryline({
    viewer: { team_name: "Alpha" },
    opponent: { team_name: "Zebra Squad", roster_id: "z" },
    placeholder: true,
    week: 1,
    hint: GAME_CENTER_COPY.emptyPreseason,
  });
  assert.equal(paired, "Week 1 vs Zebra Squad. No scored matchups yet. Scores fill in after kickoff.");
  const named = matchupStoryline({
    viewer: { team_name: "Alpha", owner_name: "Avery A" },
    opponent: { team_name: "White Supremacists", owner_name: "Caleb K", roster_id: "z" },
    placeholder: true,
    week: 1,
    hint: GAME_CENTER_COPY.emptyPreseason,
  });
  assert.equal(named, "Week 1 vs Caleb K · White Supremacists. No scored matchups yet. Scores fill in after kickoff.");
});
