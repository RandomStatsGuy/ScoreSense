/** Hub URL slug ↔ internal subView id */
export const HUB_SLUG_TO_ID = {
  setup: "setup",
  players: "value",
  roster: "roster",
  draft: "room",
  cap: "planner",
  insights: "insights",
  live: "live",
  teams: "league-rosters",
};

export const HUB_ID_TO_SLUG = Object.fromEntries(
  Object.entries(HUB_SLUG_TO_ID).map(([slug, id]) => [id, slug]),
);

/** Insights URL slug ↔ internal tab id */
export const INSIGHT_SLUG_TO_ID = {
  spend: "cap",
  scoring: "scoring",
  history: "ownership",
  contracts: "contracts",
  trades: "trades",
};

export const INSIGHT_ID_TO_SLUG = Object.fromEntries(
  Object.entries(INSIGHT_SLUG_TO_ID).map(([slug, id]) => [id, slug]),
);

export const WEEKLY_PANELS = new Set(["projections", "injuries", "fantasy"]);

export const SEASON_PANELS = new Set(["projections", "narrative"]);

export const SEASON_MODES = new Set(["preseason", "live"]);

export const TOOLS_TABS = new Set(["dfs", "bestball", "props"]);

export const ADMIN_TABS = new Set(["overview", "users", "leagues"]);

export function parseAppPath(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  const root = parts[0] || "";

  if (root === "projections") {
    if (parts[1] === "weekly") {
      const panelRaw = parts[2] || "projections";
      const panel = panelRaw === "narrative" ? "fantasy" : panelRaw;
      return {
        view: "projections",
        projectionsTab: "weekly",
        projectionsMobilePanel: WEEKLY_PANELS.has(panel) ? panel : "projections",
        seasonMode: null,
        toolsTab: null,
        hubSubView: null,
        insightTab: null,
      };
    }
    if (parts[1] === "season") {
      const mode = SEASON_MODES.has(parts[2]) ? parts[2] : "live";
      const panel = parts[3] || "projections";
      return {
        view: "projections",
        projectionsTab: "season",
        projectionsMobilePanel: "projections",
        seasonMode: mode,
        seasonMobilePanel: SEASON_PANELS.has(panel) ? panel : "projections",
        toolsTab: null,
        hubSubView: null,
        insightTab: null,
      };
    }
  }

  if (root === "hub") {
    if (parts[1] === "insights") {
      const insightSlug = parts[2];
      const insightTab = insightSlug
        ? (INSIGHT_SLUG_TO_ID[insightSlug] || "cap")
        : "cap";
      return {
        view: "hub",
        projectionsTab: null,
        projectionsMobilePanel: null,
        seasonMode: null,
        toolsTab: null,
        hubSubView: "insights",
        insightTab,
      };
    }
    const slug = parts[1] || "setup";
    const hubSubView = HUB_SLUG_TO_ID[slug] || "setup";
    return {
      view: "hub",
      projectionsTab: null,
      projectionsMobilePanel: null,
      seasonMode: null,
      toolsTab: null,
      hubSubView,
      insightTab: hubSubView === "insights" ? "cap" : null,
    };
  }

  if (root === "tools") {
    const tab = TOOLS_TABS.has(parts[1]) ? parts[1] : "dfs";
    return {
      view: "tools",
      projectionsTab: null,
      projectionsMobilePanel: null,
      seasonMode: null,
      toolsTab: tab,
      hubSubView: null,
      insightTab: null,
    };
  }

  if (root === "model") {
    return {
      view: "model",
      projectionsTab: null,
      projectionsMobilePanel: null,
      seasonMode: null,
      toolsTab: null,
      hubSubView: null,
      insightTab: null,
    };
  }

  if (root === "admin") {
    const adminTab = ADMIN_TABS.has(parts[1]) ? parts[1] : "overview";
    return {
      view: "admin",
      adminTab,
      projectionsTab: null,
      projectionsMobilePanel: null,
      seasonMode: null,
      toolsTab: null,
      hubSubView: null,
      insightTab: null,
    };
  }

  return null;
}

export function buildAppPath({
  view,
  projectionsTab = "weekly",
  projectionsMobilePanel = "projections",
  seasonMode = "live",
  seasonMobilePanel = "projections",
  toolsTab = "dfs",
  hubSubView = "setup",
  insightTab = "cap",
  adminTab = "overview",
}) {
  if (view === "projections") {
    if (projectionsTab === "weekly") {
      const panel =
        projectionsMobilePanel && projectionsMobilePanel !== "projections"
          ? `/${projectionsMobilePanel}`
          : "";
      return `/projections/weekly${panel}`;
    }
    const mode = SEASON_MODES.has(seasonMode) ? seasonMode : "live";
    const panelSuffix =
      seasonMobilePanel && seasonMobilePanel !== "projections"
        ? `/${seasonMobilePanel}`
        : "";
    return `/projections/season/${mode}${panelSuffix}`;
  }
  if (view === "hub") {
    if (hubSubView === "insights") {
      const slug = INSIGHT_ID_TO_SLUG[insightTab] || "spend";
      return `/hub/insights/${slug}`;
    }
    const slug = HUB_ID_TO_SLUG[hubSubView] || "setup";
    return `/hub/${slug}`;
  }
  if (view === "tools") {
    const tab = TOOLS_TABS.has(toolsTab) ? toolsTab : "dfs";
    return `/tools/${tab}`;
  }
  if (view === "model") return "/model";
  if (view === "admin") {
    const tab = ADMIN_TABS.has(adminTab) ? adminTab : "overview";
    return tab === "overview" ? "/admin" : `/admin/${tab}`;
  }
  return "/projections/weekly";
}

export function parseFilterParams(searchParams) {
  const pos = searchParams.get("pos");
  const season = searchParams.get("season");
  const week = searchParams.get("week");
  const teamsRaw = searchParams.get("teams");
  const draftSeason = searchParams.get("draftSeason");
  const fromWeek = searchParams.get("fromWeek");
  const rosSeason = searchParams.get("rosSeason");

  return {
    position: pos && ["qb", "rb", "wr"].includes(pos) ? pos : null,
    season: season != null && season !== "" ? Number(season) : null,
    week: week != null && week !== "" ? Number(week) : null,
    selectedTeams: teamsRaw ? teamsRaw.split(",").filter(Boolean) : null,
    draftSeason: draftSeason != null && draftSeason !== "" ? Number(draftSeason) : null,
    rosFromWeek: fromWeek != null && fromWeek !== "" ? Number(fromWeek) : null,
    rosSeason: rosSeason != null && rosSeason !== "" ? Number(rosSeason) : null,
  };
}

export function buildFilterSearchParams({
  position,
  season,
  week,
  selectedTeams,
  draftSeason,
  rosSeason,
  rosFromWeek,
  preserveParams,
}) {
  const params = new URLSearchParams(preserveParams || undefined);
  if (position) params.set("pos", position);
  else params.delete("pos");

  if (season != null) params.set("season", String(season));
  else params.delete("season");

  if (week != null) params.set("week", String(week));
  else params.delete("week");

  if (selectedTeams?.length) params.set("teams", selectedTeams.join(","));
  else params.delete("teams");

  if (draftSeason != null) params.set("draftSeason", String(draftSeason));
  else params.delete("draftSeason");

  if (rosFromWeek != null) params.set("fromWeek", String(rosFromWeek));
  else params.delete("fromWeek");

  if (rosSeason != null && rosSeason !== season) {
    params.set("rosSeason", String(rosSeason));
  } else {
    params.delete("rosSeason");
  }

  return params;
}
