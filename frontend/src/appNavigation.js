export const APP_SECTIONS = [
  { id: "projections", label: "Projections", shortLabel: "Proj" },
  { id: "hub", label: "League", shortLabel: "League" },
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
    setup: "League & rules",
    value: "Prices",
    week: "Your lineup decisions this week",
    roster: "Your contracts",
    rosters: "All teams",
    room: "Live auction",
    planner: "Cap & cuts",
    trades: "Propose & accept",
    insights: "Spend & scoring",
    office: "Chat & contracts",
    live: "This week's matchup",
    "league-rosters": "All rosters",
  },
  tools: {
    dfs: "DFS lineups & stacks",
    "mock-draft": "Practice vs bots, or simulate a full draft",
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
