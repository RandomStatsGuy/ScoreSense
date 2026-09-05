export const APP_SECTIONS = [
  { id: "projections", label: "Projections", shortLabel: "Projections" },
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
    weekly: "Who to start this week",
    season: {
      preseason: "Who to draft for the season",
      live: "Points so far plus rest of season",
    },
  },
  hub: {
    home: "What to do next in this league",
    setup: "Connect Sleeper and import sheets",
    rules: "What new contracts will cost",
    value: "Pick who you take first",
    available: "Who you can still add",
    week: "Start or sit this week",
    vibes: "One start/sit read per player today",
    game: "Your matchup, live",
    roster: "Your contracts and leftover cap",
    rosters: "Overpays and cheap years across the league",
    room: "Pick a draft night, then enter the room",
    planner: "What a bid or cut does to leftover cap",
    trades: "Propose a deal and see the cap hit",
    insights: "Who won, who spent, who scored",
    office: "Staff edits to contracts, members, and access",
    "league-rosters": "Overpays and cheap years across the league",
  },
  tools: {
    dfs: "",
    "mock-draft": "",
    "best-ball": "",
  },
  model: "Where the weekly model misses",
  admin: "Link accounts to seats",
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
