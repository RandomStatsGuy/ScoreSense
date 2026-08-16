/** Labels and counts for the Draft room entry status card (SCORE-17). */

export function draftFormatLabel(rules) {
  if (!rules || rules.auction != null) return "Salary cap auction";
  return "Auction";
}

export function draftEntryPhase({
  hubContext = null,
  testMode = false,
  draftCompleted = false,
  inDraftSetup = false,
  usingHubLeague = false,
  leagueId = "",
} = {}) {
  if (draftCompleted || hubContext?.draft_completed) {
    return { id: "in_season", label: "In season" };
  }
  if (testMode) {
    return { id: "practice", label: "Practice room" };
  }
  if (leagueId && inDraftSetup) {
    return { id: "pre_draft", label: "Pre-draft · ready" };
  }
  if (usingHubLeague || hubContext?.mode === "league") {
    return { id: "pre_draft", label: "Pre-draft" };
  }
  return { id: "solo", label: "Solo prep" };
}

/** Joined managers vs league size (bots excluded when any human teams exist). */
export function draftParticipantSummary({
  teams = [],
  teamCount = 12,
  botCount = 7,
  hasLeague = false,
} = {}) {
  const target = Math.max(1, Number(teamCount) || 12);
  if (!hasLeague) {
    const planned = 1 + Math.max(0, Number(botCount) || 0);
    return {
      label: `${Math.min(planned, target)} / ${target}`,
      detail: "You + bots (practice)",
    };
  }
  const humans = teams.filter((t) => !t?.is_bot);
  const joined = humans.length > 0 ? humans.length : teams.length;
  return {
    label: `${joined} / ${target}`,
    detail: joined === target ? "Full" : `${target - joined} open`,
  };
}
