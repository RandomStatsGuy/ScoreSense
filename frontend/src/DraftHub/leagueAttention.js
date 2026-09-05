/** League strip / phone overflow — phase, role, and Needs attention items. */

export function leaguePhaseLabel(hubContext, { inLeague } = {}) {
  if (!inLeague) return "Solo";
  return hubContext?.draft_completed ? "In season" : "Pre-draft";
}

export function leagueRoleLabel(hubContext, { inLeague } = {}) {
  if (!inLeague) return null;
  return hubContext?.is_commissioner ? "Commissioner" : "Member";
}

export function leagueDisplayName(hubContext, { inLeague } = {}) {
  if (!inLeague) return "Solo prep";
  return hubContext?.league_name || "League";
}

export function buildLeagueAttentionItems({
  inLeague,
  poolStale = false,
  projectionsAvailable,
  projAge,
  overCapLabel,
  mustExtendCount = 0,
  droppingCount = 0,
  capSheetsStale = false,
  isCommish = false,
} = {}) {
  if (!inLeague) return [];
  const items = [];
  if (poolStale) {
    items.push({
      id: "projections",
      label: projectionsAvailable === false
        ? "Projections missing"
        : (projAge ? `Projections stale ${projAge}` : "Projections stale"),
      actionLabel: "Sync projections",
      action: "projections",
    });
  }
  if (overCapLabel) {
    items.push({
      id: "over-cap",
      label: `Over cap ${overCapLabel}`,
      actionLabel: "Cap planner",
      action: "planner",
    });
  }
  if (mustExtendCount > 0) {
    items.push({
      id: "extend",
      label: `${mustExtendCount} need extension`,
      actionLabel: "Cap planner",
      action: "planner",
    });
  } else if (droppingCount > 0) {
    items.push({
      id: "expire",
      label: `${droppingCount} expire → FA`,
      actionLabel: "Cap planner",
      action: "planner",
    });
  }
  if (capSheetsStale && isCommish) {
    items.push({
      id: "cap-sheets",
      label: "Cap sheets stale",
      actionLabel: "Sync sheets",
      action: "sheets",
    });
  }
  return items;
}

export function filterAttentionForView(items, currentView) {
  return (items || []).filter((item) => item.target !== currentView && item.action !== currentView);
}
