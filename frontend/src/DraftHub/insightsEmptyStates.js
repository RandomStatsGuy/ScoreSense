/**
 * Insights empty-state + History refresh affordance helpers (SCORE-20).
 */

/** True when scoring payload has at least one non-zero scored point. */
export function hasScoredFantasyPoints(scoring) {
  if (!scoring?.available) return false;
  if ((scoring.standings || []).some((t) => Number(t.total_points) > 0)) return true;
  return (scoring.weeks || []).some((wk) =>
    (wk.teams || []).some((t) => Number(t.points) > 0),
  );
}

/**
 * Standings / efficiency tables are misleading when every team is 0
 * (preseason roster shells or no scored weeks yet).
 */
export function shouldShowScoringTables(scoring) {
  if (!scoring?.available) return false;
  if (scoring.preseason) return false;
  return hasScoredFantasyPoints(scoring);
}

export function scoringWaitingCopy(scoring) {
  if (scoring?.preseason) {
    return {
      title: "Season has not started",
      body: scoring?.hint
        || "Standings and efficiency appear after games are scored in Sleeper.",
    };
  }
  return {
    title: "Waiting for scored games",
    body: scoring?.hint
      || "No scored weeks yet — check back after your league plays.",
  };
}

/**
 * Align History Refresh control with copy.
 * - Not linked → disable; copy explains Setup (never "Tap Refresh").
 * - Linked, Sleeper history not loaded → enable + emphasize; actionable hint OK.
 * - Linked + synced → enable quiet re-sync; drop nag hint.
 */
export function ownershipRefreshAffordance(ownership, hubContext = {}) {
  const linked = Boolean(
    hubContext?.sleeper_league_id
    || ownership?.sleeper_league_id,
  );
  const hasSleeperHistory = Boolean(
    ownership?.has_sleeper_history
    || ownership?.ownership_synced_at,
  );
  const rawHint = String(ownership?.hint || "").trim();
  const asksRefresh = /refresh history/i.test(rawHint);

  if (!linked) {
    const showHint = rawHint && !asksRefresh
      ? rawHint
      : "Link your Sleeper league in Setup to pull season-by-season ownership.";
    return {
      canRefresh: false,
      emphasize: false,
      disabledReason: "Link Sleeper in Setup to load season history.",
      showHint,
      buttonLabel: "Refresh history",
    };
  }

  if (!hasSleeperHistory) {
    return {
      canRefresh: true,
      emphasize: true,
      disabledReason: null,
      showHint: rawHint
        || "Tap Refresh history to load season-by-season ownership from Sleeper (first load may take a minute).",
      buttonLabel: "Refresh history",
    };
  }

  // Synced: keep Refresh for re-pull, but never nag with "Tap Refresh".
  return {
    canRefresh: true,
    emphasize: false,
    disabledReason: null,
    showHint: rawHint && !asksRefresh ? rawHint : null,
    buttonLabel: "Refresh history",
  };
}
