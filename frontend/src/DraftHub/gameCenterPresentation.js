/** Game center copy + pure view helpers (no JSX). */

import { hubTeamLabel, hubTeamParts } from "./hubTeamLabel.js";

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
  const count = Math.max(mine.length, theirs.length);
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const home = mine[i] || null;
    const away = theirs[i] || null;
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
export function matchupStoryline({ viewer, opponent, weekComplete = false }) {
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

export function gameStateLabel(payload) {
  if (payload?.preseason) return "Preseason";
  const week = payload?.week;
  const current = payload?.current_week;
  if (week != null && current != null && Number(week) < Number(current)) return "Final";
  return "Live";
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

export const GAME_CENTER_COPY = {
  eyebrow: "Game center",
  emptySolo: "Game center follows your head-to-head matchup. Open a shared league to use it.",
  emptyNoSleeper: "Link your Sleeper league to see live matchup scoring here.",
  emptyPreseason: "No matchups yet — Game center lights up when the NFL week starts.",
  duelTitle: "Starter duel",
  duelSupport: "Slot by slot against your opponent.",
  benchTitle: "Bench watch",
  benchSupport: "What stayed on the bench while the starters decided it.",
  leagueTitle: "Around the league",
  leagueSupport: "Every matchup this week.",
  trophiesTitle: "After the whistle",
  trophiesSupport: "Reactions and week trophies — winners land in Insights.",
};
