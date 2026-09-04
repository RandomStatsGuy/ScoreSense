const ACTION_LABELS = {
  cap_overage: "Fix cap",
  draft_night: "Open draft room",
  sync_league: "Connect Sleeper",
  projections_missing: "Sync projections",
  projections_stale: "Refresh projections",
  expiring_contracts: "Review contracts",
  lineup_decisions: "Set lineup",
  cap_sheets_stale: "Sync sheets",
  invite_managers: "Invite managers",
  mark_availability: "Mark times",
};

const ACTION_SUPPORT = {
  cap_overage: "Get legal before the next roster move.",
  draft_night: "The room is open. Miss it and you draft late or not at all.",
  sync_league: "Without Sleeper, scores and rosters stay empty.",
  projections_missing: "You cannot price a bid until the player pool is back.",
  projections_stale: "A stale board prices last week's player.",
  expiring_contracts: "Decide who stays before those deals become free agents.",
  lineup_decisions: "A wrong start sits points on the bench.",
  cap_sheets_stale: "Bring the league ledger back in sync.",
  invite_managers: "Empty seats mean bots or a delayed draft.",
  mark_availability: "Tell the room which nights you can actually sit.",
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
  if (!action) return "Cap is legal and the next phase is not waiting on you.";
  return ACTION_SUPPORT[action.id] || "Handle this before the next roster move.";
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
    title: "Nothing is due.",
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

export const HOME_PAGE_COPY = {
  kicker: "Home",
  heading: "Do the next league move.",
  supportingTitle: "Also due",
};

export const HOME_DECK_COPY = {
  matchupTitle: "Your matchup",
  standingsTitle: "Standings",
  standingsNote: "Season to date",
  openGame: "Open Game center",
  linkSleeper: "Link Sleeper to fill scores.",
  opponentTbd: "Opponent TBD",
  lockerKicker: "Chat",
  lockerTitle: "League chat",
  lockerNote: "Talk here. Other Fantasy pages open the same thread from an edge.",
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
