/** Hub URL slug ↔ internal subView id */
export const HUB_SLUG_TO_ID = {
  home: "home",
  setup: "setup",
  rules: "rules",
  players: "value",
  week: "week",
  roster: "roster",
  rosters: "rosters",
  draft: "room",
  cap: "planner",
  trades: "trades",
  insights: "insights",
  office: "office",
};

/** Explicit reverse map (do not derive — avoids roster/rosters collisions). */
export const HUB_ID_TO_SLUG = {
  home: "home",
  setup: "setup",
  rules: "rules",
  value: "players",
  week: "week",
  roster: "roster",
  rosters: "rosters",
  room: "draft",
  planner: "cap",
  trades: "trades",
  insights: "insights",
  office: "office",
};

/** Insights URL slug ↔ internal tab id */
export const INSIGHT_SLUG_TO_ID = {
  overview: "overview",
  spend: "cap",
  scoring: "scoring",
  history: "ownership",
};

export const INSIGHT_ID_TO_SLUG = Object.fromEntries(
  Object.entries(INSIGHT_SLUG_TO_ID).map(([slug, id]) => [id, slug]),
);

/** Commissioner (/hub/office) URL slug ↔ internal tab id */
export const OFFICE_SLUG_TO_ID = {
  chat: "current",
  current: "current",
  historic: "historic",
  members: "members",
  access: "access",
};

export const OFFICE_ID_TO_SLUG = {
  current: "current",
  historic: "historic",
  members: "members",
  access: "access",
};

/** Legacy Insights desk tabs → Office pane */
export const LEGACY_DESK_TO_OFFICE = {
  desk: "current",
  salaries: "historic",
  contracts: "historic",
};

export const WEEKLY_PANELS = new Set(["projections", "injuries", "fantasy"]);

export const SEASON_PANELS = new Set(["projections", "narrative"]);

export const SEASON_MODES = new Set(["preseason", "live"]);

export const TOOLS_TABS = new Set(["dfs", "mock-draft"]);

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
      if (insightSlug && LEGACY_DESK_TO_OFFICE[insightSlug]) {
        return {
          view: "hub",
          projectionsTab: null,
          projectionsMobilePanel: null,
          seasonMode: null,
          toolsTab: null,
          hubSubView: "office",
          insightTab: null,
          officeTab: LEGACY_DESK_TO_OFFICE[insightSlug],
        };
      }
      const insightTab = insightSlug
        ? (INSIGHT_SLUG_TO_ID[insightSlug] || "overview")
        : "overview";
      return {
        view: "hub",
        projectionsTab: null,
        projectionsMobilePanel: null,
        seasonMode: null,
        toolsTab: null,
        hubSubView: "insights",
        insightTab,
        officeTab: null,
      };
    }
    if (parts[1] === "office") {
      const officeSlug = parts[2] || "current";
      const officeTab = OFFICE_SLUG_TO_ID[officeSlug] || "current";
      return {
        view: "hub",
        projectionsTab: null,
        projectionsMobilePanel: null,
        seasonMode: null,
        toolsTab: null,
        hubSubView: "office",
        insightTab: null,
        officeTab,
      };
    }
    const slug = parts[1] || "home";
    if (slug === "live") {
      return {
        view: "hub",
        projectionsTab: null,
        projectionsMobilePanel: null,
        seasonMode: null,
        toolsTab: null,
        hubSubView: "insights",
        insightTab: "scoring",
        officeTab: null,
      };
    }
    if (slug === "teams") {
      return {
        view: "hub",
        projectionsTab: null,
        projectionsMobilePanel: null,
        seasonMode: null,
        toolsTab: null,
        hubSubView: "office",
        insightTab: null,
        officeTab: "current",
      };
    }
    const hubSubView = HUB_SLUG_TO_ID[slug] || "value";
    return {
      view: "hub",
      projectionsTab: null,
      projectionsMobilePanel: null,
      seasonMode: null,
      toolsTab: null,
      hubSubView,
      insightTab: hubSubView === "insights" ? "overview" : null,
      officeTab: hubSubView === "office" ? "current" : null,
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
  hubSubView = "home",
  insightTab = "overview",
  officeTab = "current",
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
      const slug = INSIGHT_ID_TO_SLUG[insightTab] || "overview";
      return `/hub/insights/${slug}`;
    }
    if (hubSubView === "office") {
      const slug = OFFICE_ID_TO_SLUG[officeTab] || "current";
      return `/hub/office/${slug}`;
    }
    const slug = HUB_ID_TO_SLUG[hubSubView] || "players";
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

/** Parse comma-separated compare player IDs (SCORE-4 start/sit), capped at 4. */
export function parseCompareIds(raw) {
  if (raw == null || raw === "") return [];
  const seen = new Set();
  const out = [];
  for (const part of String(raw).split(",")) {
    const id = part.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 4) break;
  }
  return out;
}

/** SCORE-7: `movers` URL filter — all | 1/material | risers | fallers. */
function parseMoversFilter(raw) {
  if (raw == null || raw === "") return null;
  const v = String(raw).trim().toLowerCase();
  if (v === "1" || v === "true" || v === "material" || v === "movers") return "movers";
  if (v === "risers" || v === "riser" || v === "up") return "risers";
  if (v === "fallers" || v === "faller" || v === "down") return "fallers";
  if (v === "all" || v === "0" || v === "false") return "all";
  return null;
}

export function parseFilterParams(searchParams) {
  const pos = searchParams.get("pos");
  const season = searchParams.get("season");
  const week = searchParams.get("week");
  const teamsRaw = searchParams.get("teams");
  const draftSeason = searchParams.get("draftSeason");
  const fromWeek = searchParams.get("fromWeek");
  const rosSeason = searchParams.get("rosSeason");
  const search = searchParams.get("q");
  const compareRaw = searchParams.get("compare");
  const compareIds = parseCompareIds(compareRaw);
  const compareView = searchParams.get("cmp") === "1";
  const movementFilter = parseMoversFilter(searchParams.get("movers"));

  return {
    position: pos && ["qb", "rb", "wr"].includes(pos) ? pos : null,
    season: season != null && season !== "" ? Number(season) : null,
    week: week != null && week !== "" ? Number(week) : null,
    selectedTeams: teamsRaw ? teamsRaw.split(",").filter(Boolean) : null,
    draftSeason: draftSeason != null && draftSeason !== "" ? Number(draftSeason) : null,
    rosFromWeek: fromWeek != null && fromWeek !== "" ? Number(fromWeek) : null,
    rosSeason: rosSeason != null && rosSeason !== "" ? Number(rosSeason) : null,
    search: search != null && search !== "" ? search : null,
    player: searchParams.get("player") || null,
    compareIds: compareIds.length ? compareIds : null,
    /** Open state for the comparison panel (`cmp=1` deep-link, SCORE-4). */
    compareView,
    /** SCORE-7 Biggest Movers filter (`movers=`). */
    movementFilter,
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
  search,
  player,
  compareIds,
  compareView,
  movementFilter,
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

  if (search != null && String(search).trim() !== "") {
    params.set("q", String(search).trim());
  } else {
    params.delete("q");
  }

  if (player !== undefined) {
    const pid = String(player || "").trim();
    if (pid) params.set("player", pid);
    else params.delete("player");
  }

  // Only touch compare / cmp when callers pass them explicitly so unrelated
  // filter updates preserve selection + open state via preserveParams.
  if (compareIds !== undefined) {
    const ids = parseCompareIds(compareIds);
    if (ids.length) params.set("compare", ids.join(","));
    else params.delete("compare");
  }

  if (compareView !== undefined) {
    const ids = parseCompareIds(
      compareIds !== undefined ? compareIds : params.get("compare"),
    );
    if (compareView && ids.length >= 2) params.set("cmp", "1");
    else params.delete("cmp");
  }

  // SCORE-7: only mutate `movers` when explicitly provided.
  if (movementFilter !== undefined) {
    if (!movementFilter || movementFilter === "all") {
      params.delete("movers");
    } else if (movementFilter === "movers") {
      params.set("movers", "1");
    } else {
      params.set("movers", String(movementFilter));
    }
  }

  return params;
}
