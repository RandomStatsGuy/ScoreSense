/** Game center copy + pure view helpers (no JSX). */

import { hubTeamLabel, hubTeamParts } from "./hubTeamLabel.js";

export const GAME_CENTER_COPY = {
  eyebrow: "Game center",
  emptySolo: "Game center follows your head-to-head matchup. Open a shared league to use it.",
  emptyNoSleeper: "Link Sleeper to fill scores.",
  emptyPreseason: "No scored matchups yet. Scores fill in after kickoff.",
  loadingChip: "Loading",
  unscoredChip: "No scores yet",
  emptyDuel: "Lineups are empty until kickoff. Set them on This Week.",
  setLineup: "Set lineup",
  setupCta: "Link Sleeper",
  openDraft: "Open draft room",
  nextGames: "Next games Thu",
  notStarted: "Not started",
  standingsTitle: "Standings",
  standingsUnranked: "Standings start after Week 1.",
  standingsLastSeason: "Last season",
  standingsToDate: "Season to date.",
  emptyLineupHeading: "Your lineup is empty.",
  emptyLineupSupport: "Empty slots score zero.",
  trophyNoVotes: "No votes yet",
  trophyYouVoted: "you voted",
  trophyVote: "Vote",
  trophyChangeVote: "Change vote",
  duelTitle: "Starter duel",
  duelSupport: "Slot by slot against your opponent.",
  benchTitle: "Bench watch",
  benchSupport: "Points you left on the bench.",
  leagueTitle: "Around the league",
  leagueSupport: "Every matchup this week.",
  trophiesTitle: "Week trophies",
  trophiesSupport: "High score and low score land in Insights.",
};

export function duelSlotFilled(player) {
  return Boolean(player && player.name && player.name !== "Empty");
}

export function gameCenterTeamLabel(team) {
  return hubTeamLabel({
    name: team?.team_name,
    owner_name: team?.owner_name,
  });
}

export function gameCenterTeamParts(team) {
  return hubTeamParts({
    name: team?.team_name,
    owner_name: team?.owner_name,
  });
}

export function findViewerMatchup(payload) {
  const matchups = payload?.matchups || [];
  const viewerId = payload?.viewer_matchup_id;
  if (viewerId != null) {
    const hit = matchups.find((m) => String(m.matchup_id) === String(viewerId));
    if (hit) return hit;
  }
  return null;
}

export function matchupTeams(matchup) {
  const teams = matchup?.teams || [];
  if (teams.length < 2) return { viewer: teams[0] || null, opponent: null };
  const viewer = teams.find((t) => t.is_viewer) || teams[0];
  const opponent = teams.find((t) => t !== viewer) || null;
  return { viewer, opponent };
}

export function winProbFor(matchup, team) {
  const probs = matchup?.win_prob_by_roster || {};
  const raw = probs[String(team?.roster_id ?? "")];
  return raw == null ? null : Number(raw);
}

export function formatWinProb(prob) {
  if (prob == null || Number.isNaN(Number(prob))) return null;
  return `${Math.round(Number(prob) * 100)}%`;
}

/** Count starters who have not put up points yet (0.0 = hasn't played). */
export function startersPending(team) {
  return (team?.starters || []).filter((s) => Number(s?.points || 0) === 0).length;
}

/** Slot-by-slot pairing for the starter duel. Sleeper keeps both starter
 * arrays in lineup-slot order, so index i on each side is the same slot. */
export function duelRows(viewer, opponent, startingSlots = []) {
  const mine = viewer?.starters || [];
  const theirs = opponent?.starters || [];
  const count = Math.max(mine.length, theirs.length, startingSlots.length);
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const home = mine[i] || null;
    const away = theirs[i] || null;
    if (!duelSlotFilled(home) && !duelSlotFilled(away) && !home?.sleeper_player_id && !away?.sleeper_player_id && !home?.points && !away?.points) {
      continue;
    }
    rows.push({
      key: `${home?.sleeper_player_id || "x"}-${away?.sleeper_player_id || "x"}-${i}`,
      slot: startingSlots[i] || home?.position || away?.position || "—",
      home,
      away,
    });
  }
  return rows;
}

/** One consequence-first sentence under the win probability bar. */
export function matchupStoryline({
  viewer,
  opponent,
  weekComplete = false,
  placeholder = false,
  week = null,
  hint = "",
} = {}) {
  if (placeholder) {
    const tbd = !opponent?.team_name || opponent.team_name === "Opponent TBD" || opponent.roster_id === "tbd";
    if (tbd) {
      return week != null ? `Week ${week} opponent TBD` : "Opponent TBD";
    }
    const opponentLabel = gameCenterTeamLabel(opponent) || opponent.team_name;
    return week != null ? `Week ${week} vs ${opponentLabel}` : `vs ${opponentLabel}`;
  }
  if (!viewer || !opponent) return "";
  const margin = Number(viewer.points || 0) - Number(opponent.points || 0);
  const lead = Math.abs(Math.round(margin * 10) / 10);
  const myPending = startersPending(viewer);
  const theirPending = startersPending(opponent);
  if (weekComplete || (myPending === 0 && theirPending === 0)) {
    if (margin > 0) return `Final: you win by ${lead}.`;
    if (margin < 0) return `Final: ${gameCenterTeamLabel(opponent)} takes it by ${lead}.`;
    return "Final: a dead tie.";
  }
  const pendingNote = theirPending > 0
    ? `${gameCenterTeamLabel(opponent)} has ${theirPending} starter${theirPending === 1 ? "" : "s"} left`
    : `you have ${myPending} starter${myPending === 1 ? "" : "s"} left`;
  if (margin > 0) return `You lead by ${lead} — ${pendingNote}.`;
  if (margin < 0) return `You trail by ${lead} — ${pendingNote}.`;
  return `All square — ${pendingNote}.`;
}

export function matchupsHavePoints(payload) {
  return (payload?.matchups || []).some((matchup) => (
    (matchup?.teams || []).some((team) => Number(team?.points) > 0)
  ));
}

export function scoresArePlaceholder(payload, hubContext) {
  return Boolean(payload?.placeholder) || hubContext?.draft_completed === false;
}

export function gameStateLabel(payload, hubContext) {
  if (scoresArePlaceholder(payload, hubContext)) return GAME_CENTER_COPY.unscoredChip;
  if (payload?.preseason) return "Preseason";
  const week = payload?.week;
  const current = payload?.current_week;
  if (week != null && current != null && Number(week) < Number(current)) return "Final";
  const liveFlag = payload?.live === true || payload?.has_live_games === true;
  if (liveFlag) return "Live";
  return "Next games Thu";
}

export function formatSyncedAgo(syncedAt) {
  if (!syncedAt) return null;
  const then = new Date(syncedAt).getTime();
  if (Number.isNaN(then)) return null;
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 90) return `Updated ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return `Updated ${minutes}m ago`;
}

export function standingsHaveResults(standings) {
  return (standings || []).some((row) => {
    const games = Number(row?.wins || 0) + Number(row?.losses || 0) + Number(row?.ties || 0);
    return games > 0 || Number(row?.points_for || 0) > 0;
  });
}

/** Same standings read as Home. Last-season records stay last season until Week 1. */
export function interpretStandings(scoring, { phaseId, draftCompleted } = {}) {
  const standings = scoring?.standings || [];
  const hasResults = standingsHaveResults(standings);
  const placeholder = Boolean(scoring?.placeholder);
  const preDraft = phaseId === "pre_draft" || draftCompleted === false;
  const markedLast = scoring?.standings_season === "last";
  const historical = Boolean(
    hasResults && (markedLast || preDraft || placeholder || scoring?.preseason),
  );
  let note = GAME_CENTER_COPY.standingsToDate;
  if (!hasResults) note = GAME_CENTER_COPY.standingsUnranked;
  else if (historical) note = GAME_CENTER_COPY.standingsLastSeason;
  return {
    standings,
    hasResults,
    historical,
    ranked: hasResults,
    note,
    placeholder,
  };
}

export function gameCenterStandingRows(standings, viewerId, { compact = false, limit = 12 } = {}) {
  if (!standings?.length) return [];
  if (!compact || standings.length <= limit) return standings;
  const top = standings.slice(0, 3);
  const mineIdx = standings.findIndex(
    (row) => row.hub_team_id && String(row.hub_team_id) === String(viewerId),
  );
  if (mineIdx < 0) return top;
  const start = Math.max(3, mineIdx - 1);
  const end = Math.min(standings.length, mineIdx + 2);
  const seen = new Set(top.map((row) => String(row.roster_id)));
  const out = [...top];
  for (const row of standings.slice(start, end)) {
    const key = String(row.roster_id);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(row);
    }
  }
  if (!seen.has(String(standings[mineIdx].roster_id))) out.push(standings[mineIdx]);
  return out;
}

export function formatStandingRecord(row) {
  if (!row) return "";
  const ties = row.ties ? `–${row.ties}` : "";
  return `${row.wins}–${row.losses}${ties}`;
}

export function ordinalRank(rank) {
  const n = Number(rank);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `${n}${["st", "nd", "rd"][n - 1] || "th"}`;
}

export function formatStandingRank(row, { ranked = true } = {}) {
  if (!ranked || row?.rank == null) return "—";
  return String(row.rank);
}

export function formatMatchupRecord(row, { ranked = true } = {}) {
  if (!row || !ranked) return "";
  const seed = ordinalRank(row.rank);
  const rec = formatStandingRecord(row);
  return seed ? `${rec} · ${seed}` : rec;
}

export function formatDraftNightDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function gameCenterBanner({
  draftCompleted,
  draftStartsAt,
  placeholder = false,
  reason = "",
  sleeperLinked = false,
} = {}) {
  if (draftCompleted === false) {
    const date = formatDraftNightDate(draftStartsAt);
    return {
      text: date
        ? `Draft night is ${date} · scores start after Week 1 kicks off`
        : "Draft night is not locked · scores start after Week 1 kicks off",
      action: "room",
      actionLabel: GAME_CENTER_COPY.openDraft,
    };
  }
  if (reason === "no_sleeper_league" || (!sleeperLinked && placeholder)) {
    return {
      text: GAME_CENTER_COPY.emptyNoSleeper,
      action: "office-access",
      actionLabel: GAME_CENTER_COPY.setupCta,
    };
  }
  return null;
}

export function gameCenterHeroCopy({
  emptyLineup = false,
  live = false,
  weekComplete = false,
  placeholder = false,
  viewer,
  opponent,
} = {}) {
  if (emptyLineup || placeholder) {
    return {
      heading: GAME_CENTER_COPY.emptyLineupHeading,
      support: GAME_CENTER_COPY.emptyLineupSupport,
    };
  }
  if (live || weekComplete) {
    return {
      heading: matchupStoryline({ viewer, opponent, weekComplete }),
      support: "",
    };
  }
  return {
    heading: GAME_CENTER_COPY.emptyLineupHeading,
    support: GAME_CENTER_COPY.emptyLineupSupport,
  };
}

export function formatMatchupScore(value, { placeholder = false, proj = null } = {}) {
  const projNum = proj == null ? null : Number(proj);
  const hasProj = projNum != null && !Number.isNaN(projNum);
  if (placeholder || value == null || Number.isNaN(Number(value))) {
    return {
      score: "—",
      label: hasProj ? `proj ${projNum.toFixed(1)}` : GAME_CENTER_COPY.notStarted,
    };
  }
  return {
    score: Number(value).toFixed(1),
    label: hasProj ? `proj ${projNum.toFixed(1)}` : "",
  };
}

export function shouldShowPrevWeek(weekNumber) {
  return Number(weekNumber ?? 1) > 1;
}

export function shouldShowNextWeek(weekNumber, maxWeek) {
  return Number(weekNumber ?? 1) < Number(maxWeek || 18);
}

export function trophyLeaderLabel(option) {
  return hubTeamLabel({
    name: option?.team_name,
    owner_name: option?.owner_name,
  }) || option?.team_name || "";
}

export function trophySummaryState({ leader, votes, youVoted = false } = {}) {
  if (!leader || Number(votes) <= 0) return GAME_CENTER_COPY.trophyNoVotes;
  const n = Number(votes);
  const voteWord = n === 1 ? "vote" : "votes";
  const voted = youVoted ? ` · ${GAME_CENTER_COPY.trophyYouVoted}` : "";
  return `${trophyLeaderLabel(leader)} · ${n} ${voteWord}${voted}`;
}

export function lineupIsEmpty(viewer, opponent, rows = []) {
  if (rows.length === 0) return true;
  const sides = [viewer, opponent];
  return sides.every((team) => {
    const starters = team?.starters || [];
    return starters.length === 0 || starters.every((player) => !duelSlotFilled(player));
  });
}
