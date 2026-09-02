export const APP_SECTIONS = [
  { id: "projections", label: "Projections", shortLabel: "Proj" },
  { id: "hub", label: "Fantasy", shortLabel: "Fantasy" },
  { id: "tools", label: "Tools", shortLabel: "Tools" },
];

export const PROJECTIONS_TABS = [
  { id: "weekly", label: "Weekly" },
  { id: "season", label: "Season" },
];

export const SEASON_MODES = [
  {
    id: "preseason",
    label: "Preseason outlook",
    shortLabel: "Preseason",
    hint: "Season-long draft prep",
  },
  {
    id: "live",
    label: "Live season",
    shortLabel: "Live",
    hint: "Scored + rest-of-season",
  },
];

export const TOOLS_TABS = [
  { id: "dfs", label: "DFS" },
  { id: "mock-draft", label: "Mock draft" },
  { id: "best-ball", label: "Best ball" },
];

export const SECTION_SUBTITLES = {
  projections: {
    weekly: "Weekly floor–ceiling projections",
    season: {
      preseason: "Season P50 with schedule-aware floor–ceiling",
      live: "Points scored + rest-of-season",
    },
  },
  hub: {
    home: "Phase-aware checklist & action center",
    setup: "Connections & imports",
    rules: "League rules everyone can plan around",
    value: "Star targets and compare auction prices",
    available: "Players you can still add",
    week: "Your lineup decisions this week",
    vibes: "Swipe your roster; aura sets a start slate",
    game: "Your matchup, live",
    roster: "Your contracts",
    rosters: "All teams",
    room: "Invite, schedule, live room",
    planner: "Cap & cuts",
    trades: "Propose & accept",
    insights: "League history and awards",
    office: "League-wide roster operations",
    "league-rosters": "All rosters",
  },
  tools: {
    dfs: "Slates, stacks, exposure, and site-ready exports",
    "mock-draft": "Practice vs bots, or simulate a full draft",
    "best-ball": "Season ranks vs ADP for draft-day edges",
  },
  model: "How we validate projections before you use them",
  admin: "League and account management",
};

export function resolveSectionLabel(section, { projectionsTab, toolsTab } = {}) {
  if (section === "projections") {
    const tab = PROJECTIONS_TABS.find((t) => t.id === projectionsTab);
    return tab?.label || "Projections";
  }
  if (section === "tools") {
    const tab = TOOLS_TABS.find((t) => t.id === toolsTab);
    return tab ? `Tools · ${tab.label}` : "Tools";
  }
  const hit = APP_SECTIONS.find((s) => s.id === section);
  if (section === "model") return "Model accuracy";
  if (section === "admin") return "Admin";
  return hit?.label || "ScoreSense";
}

export function defaultSeasonMode(projMeta) {
  if (!projMeta) return "live";
  if (projMeta.preseason_mode || projMeta.is_offseason) return "preseason";
  const week = Number(projMeta.default_week);
  if (!Number.isFinite(week) || week > 18) return "preseason";
  return "live";
}
