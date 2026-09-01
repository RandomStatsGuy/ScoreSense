const ACTION_LABELS = {
  cap_overage: "Fix cap",
  draft_night: "Open draft room",
  sync_league: "Connect Sleeper",
  projections_missing: "Sync projections",
  projections_stale: "Refresh projections",
  expiring_contracts: "Review contracts",
  lineup_decisions: "Set lineup",
  cap_sheets_stale: "Sync sheets",
};

const ACTION_SUPPORT = {
  cap_overage: "Get legal before the next roster move.",
  draft_night: "The room is ready when you are.",
  sync_league: "Bring in the league state ScoreSense needs to help.",
  projections_missing: "Restore the player pool before making draft decisions.",
  projections_stale: "Use the latest outlook before committing to a move.",
  expiring_contracts: "Decide who stays before those deals become free agents.",
  lineup_decisions: "Resolve the choices most likely to change your week.",
  cap_sheets_stale: "Bring the league ledger back in sync.",
};

export const LEAGUE_PHASES = [
  { id: "offseason", label: "Build" },
  { id: "pre_draft", label: "Prepare" },
  { id: "live_draft", label: "Draft" },
  { id: "in_season", label: "Compete" },
];

export function isLeagueHomeTarget(view, validViews) {
  return Boolean(view && validViews?.has(view));
}

export function actionLabel(action) {
  if (!action) return "Continue";
  return ACTION_LABELS[action.id] || "Open";
}

export function actionSupport(action) {
  if (!action) return "Your league is clear. Keep building from the next phase step.";
  return ACTION_SUPPORT[action.id] || "Take care of this next, then keep moving.";
}

export function resolveLeagueHomeFocus({ actions = [], primaryCta, defaultView, validViews }) {
  const priorityAction = actions.find((action) => isLeagueHomeTarget(action?.href, validViews));
  if (priorityAction) {
    return {
      kind: "action",
      id: priorityAction.id,
      title: priorityAction.message,
      detail: actionSupport(priorityAction),
      label: actionLabel(priorityAction),
      view: priorityAction.href,
      action: priorityAction,
    };
  }

  const ctaView = isLeagueHomeTarget(primaryCta?.view, validViews)
    ? primaryCta.view
    : (isLeagueHomeTarget(defaultView, validViews) ? defaultView : null);

  return {
    kind: "phase",
    id: "clear",
    title: "You’re clear for now",
    detail: actionSupport(null),
    label: primaryCta?.label || "Continue",
    view: ctaView,
    action: null,
  };
}

export function supportingLeagueHomeActions(actions = [], focus) {
  if (!focus?.action) return actions;
  return actions.filter((action) => action !== focus.action);
}

export function phaseTrackState(phaseId) {
  return LEAGUE_PHASES.map((phase) => ({
    ...phase,
    current: phase.id === phaseId,
  }));
}

export const HOME_DECK_COPY = {
  matchupTitle: "Your matchup",
  standingsTitle: "Standings",
  standingsNote: "Season to date",
  openGame: "Open Game center",
  linkSleeper: "Link Sleeper to fill scores.",
  opponentTbd: "Opponent TBD",
};

export function homeDeckStandingRows(standings, viewerTeamId, limit = 5) {
  if (!standings?.length) return [];
  const top = standings.slice(0, limit);
  const mine = standings.find(
    (row) => row.hub_team_id && String(row.hub_team_id) === String(viewerTeamId),
  );
  if (mine && !top.includes(mine)) {
    return [...top.slice(0, Math.max(0, limit - 1)), mine];
  }
  return top;
}

export function formatHomeScore(team, placeholder = false) {
  if (placeholder || team == null || team.points == null || Number.isNaN(Number(team.points))) {
    return "—";
  }
  const pts = Number(team.points);
  if (pts > 0 || team.proj_total == null) return pts.toFixed(1);
  const est = Number(team.est_final);
  return Number.isNaN(est) ? "—" : `proj ${est.toFixed(1)}`;
}

export function homeMatchupNote(scoring, opponent) {
  if (scoring?.placeholder) {
    const tbd = !opponent || opponent.roster_id === "tbd" || opponent.team_name === "Opponent TBD";
    if (tbd && scoring.week != null) return `Week ${scoring.week} opponent TBD`;
    if (tbd) return HOME_DECK_COPY.opponentTbd;
    return scoring.hint || HOME_DECK_COPY.linkSleeper;
  }
  if (scoring?.week != null) return `Week ${scoring.week}`;
  return "";
}
