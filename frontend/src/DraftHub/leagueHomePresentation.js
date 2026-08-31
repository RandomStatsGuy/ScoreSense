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

function fmtMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `$${Math.round(n)}`;
}

/** One readable line + glyph per league-pulse event (Home feed). */
export function pulseEventLine(event) {
  const kind = String(event?.kind || "");
  const player = event?.player_name || "a player";
  const salary = fmtMoney(event?.salary);
  const dead = fmtMoney(event?.dead_cap);
  if (kind === "trade") {
    const sides = [event?.team_a, event?.team_b].filter(Boolean).join(" ⇄ ") || "Two teams";
    const pieces = [...(event?.players_a || []), ...(event?.players_b || [])].filter(Boolean);
    return {
      icon: "⇄",
      text: `${sides} completed a trade${pieces.length ? ` — ${pieces.slice(0, 3).join(", ")}${pieces.length > 3 ? "…" : ""}` : ""}.`,
    };
  }
  if (kind === "cut") {
    const owner = event?.from_owner || "A manager";
    return {
      icon: "−",
      text: `${owner} cut ${player}${dead ? ` (${dead} dead)` : ""}.`,
    };
  }
  if (kind === "waiver") {
    const owner = event?.to_owner || "A manager";
    return {
      icon: "+",
      text: `${owner} won ${player} on waivers${salary ? ` at ${salary}` : ""}.`,
    };
  }
  if (kind === "acquired") {
    const owner = event?.to_owner || "A manager";
    return {
      icon: "+",
      text: `${owner} added ${player}${salary ? ` at ${salary}` : ""}.`,
    };
  }
  if (kind === "trade_in" || kind === "trade_out") {
    const to = event?.to_owner;
    const from = event?.from_owner;
    return {
      icon: "⇄",
      text: to && from
        ? `${player} moved from ${from} to ${to} by trade.`
        : `${player} changed teams by trade${to ? ` — now with ${to}` : ""}.`,
    };
  }
  return { icon: "•", text: `${player} — roster move.` };
}
