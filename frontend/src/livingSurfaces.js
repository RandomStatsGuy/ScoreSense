/**
 * Living surfaces — the shipped files an agent must open and match.
 * Not imported by the app. Agents and tests only.
 *
 * Resolve from a prompt, a nav id, or a file path. Do not invent chrome.
 */

export const CHROME = Object.freeze([
  "experience",
  "action-center",
  "rules-center",
  "table",
  "board",
  "matchup",
  "draft-live",
  "office",
  "account",
]);

export const SHARED = Object.freeze({
  tokens: [
    "frontend/src/styles/tokens.css",
    "frontend/src/styles/product-hierarchy.css",
  ],
  primitives: "frontend/src/DraftHub/HubUILayout.jsx",
  media: "frontend/src/DraftHub/HubMediaImg.jsx",
  ownerLabel: "frontend/src/DraftHub/hubTeamLabel.js",
  chat: [
    "frontend/src/DraftHub/FantasyChatDock.jsx",
    "frontend/src/DraftHub/fantasyChatPresentation.js",
  ],
  mobile: [
    "frontend/src/layout/MobileShell.jsx",
    "frontend/src/layout/MobileHeader.jsx",
    "frontend/src/layout/MobileDestinationSheet.jsx",
    "frontend/src/layout/mobileChromePresentation.js",
  ],
});

const S = (row) => Object.freeze(row);

export const LIVING_SURFACES = Object.freeze({
  "hub.home": S({
    label: "Home",
    chrome: "action-center",
    page: "frontend/src/DraftHub/LeagueHome.jsx",
    copy: "frontend/src/DraftHub/leagueHomePresentation.js",
    doNot: "Do not wrap Home in HubExperienceLayout. Extend the action deck.",
  }),
  "hub.value": S({
    label: "Strategy",
    chrome: "table",
    page: "frontend/src/DraftHub/ValueSheetTable.jsx",
    also: ["frontend/src/DraftHub/valueSheetColumns.js"],
    doNot: "Do not add decision-page hero chrome to the Strategy board.",
  }),
  "hub.available": S({
    label: "Free agents",
    chrome: "table",
    page: "frontend/src/DraftHub/ValueSheetTable.jsx",
    copy: "frontend/src/DraftHub/acquisitionWindow.js",
    doNot: "Do not add a second pickup board. Players-tab adds follow the calendar.",
  }),
  "hub.room": S({
    label: "Draft",
    chrome: "experience",
    page: "frontend/src/DraftHub/DraftLobby.jsx",
    copy: "frontend/src/DraftHub/draftAvailabilityPresentation.js",
    also: [
      "frontend/src/DraftHub/DraftEntryPanel.jsx",
      "frontend/src/DraftHub/DraftAvailability.jsx",
      "frontend/src/DraftHub/DraftNightSchedule.jsx",
      "frontend/src/DraftHub/leagueAccessCopy.js",
    ],
    doNot: "Idle Draft uses experience chrome. Live rooms do not. Calendar shows current and future times only. Lock draft night from an overlap; do not invent a second scheduler.",
  }),
  "hub.room.live": S({
    label: "Draft (live)",
    chrome: "draft-live",
    page: "frontend/src/DraftHub/DraftRoom.jsx",
    doNot: "Do not wrap a live draft in HubExperience two-column settings chrome.",
  }),
  "hub.week": S({
    label: "This Week",
    chrome: "experience",
    page: "frontend/src/DraftHub/WeeklyCommandCenter.jsx",
    also: ["frontend/src/DraftHub/WeekLineupBoard.jsx"],
    doNot: "Do not fork a second week hero. Extend WeeklyCommandCenter.",
  }),
  "hub.game": S({
    label: "Game center",
    chrome: "matchup",
    page: "frontend/src/DraftHub/GameCenter.jsx",
    copy: "frontend/src/DraftHub/gameCenterPresentation.js",
    doNot: "Game center is a matchup board, not an editorial settings page.",
  }),
  "hub.roster": S({
    label: "My team",
    chrome: "table",
    page: "frontend/src/DraftHub/RosterBuilder.jsx",
    also: ["frontend/src/DraftHub/rosterFormat.js"],
    doNot: "Do not invent a second my-team chrome. List people by owner name.",
  }),
  "hub.rosters": S({
    label: "Rosters",
    chrome: "experience",
    page: "frontend/src/DraftHub/LeagueRostersBrowser.jsx",
    doNot: "Reuse HubExperienceHero + HubTableCard. Do not fork a roster browser.",
  }),
  "hub.planner": S({
    label: "Cap",
    chrome: "experience",
    page: "frontend/src/DraftHub/CapPlanner.jsx",
    doNot: "Extend CapPlanner and HubExperience*. Do not start a new cap aesthetic.",
  }),
  "hub.trades": S({
    label: "Trades",
    chrome: "table",
    page: "frontend/src/DraftHub/LeagueTrades.jsx",
    doNot: "Do not wrap Trades in a second hero system.",
  }),
  "hub.rules": S({
    label: "Rules",
    chrome: "rules-center",
    page: "frontend/src/DraftHub/RulesWizard.jsx",
    copy: "frontend/src/DraftHub/rulesPresentation.js",
    doNot: "Do not invent a parallel rules model. Merge via rulesPresentation.js.",
  }),
  "hub.office": S({
    label: "Roster management",
    chrome: "office",
    page: "frontend/src/DraftHub/LeagueOffice.jsx",
    also: ["frontend/src/DraftHub/hubOfficeTabs.js"],
    doNot: "Chat is FantasyChatDock: a viewport-fixed edge launcher that opens a centered conversation. Not an office pane. Do not add a Chat tab.",
  }),
  "hub.office.current": S({
    label: "Contracts",
    chrome: "office",
    page: "frontend/src/DraftHub/CommissionerLeagueRosters.jsx",
    doNot: "Staff may override. Players-tab adds may not.",
  }),
  "hub.office.historic": S({
    label: "Salary sheets",
    chrome: "office",
    page: "frontend/src/DraftHub/TeamSalarySheets.jsx",
    doNot: "Keep sheets inside Roster management. Do not add a top-level destination.",
  }),
  "hub.office.members": S({
    label: "Members",
    chrome: "office",
    page: "frontend/src/DraftHub/LeagueOffice.jsx",
    copy: "frontend/src/DraftHub/leagueAccessCopy.js",
    doNot: "List people by owner name. Do not show a nickname as the only identity.",
  }),
  "hub.office.access": S({
    label: "Access & imports",
    chrome: "office",
    page: "frontend/src/DraftHub/LeagueOffice.jsx",
    copy: "frontend/src/DraftHub/leagueAccessCopy.js",
    doNot: "Do not invent a second invite or import chrome.",
  }),
  "hub.insights": S({
    label: "Insights",
    chrome: "experience",
    page: "frontend/src/DraftHub/LeagueInsights.jsx",
    copy: "frontend/src/DraftHub/insights/insightsPresentation.js",
    also: ["frontend/src/DraftHub/insights/InsightsOverview.jsx"],
    doNot: "Gold is for awards only. Extend InsightsOverview / LeagueInsights.",
  }),
  "hub.setup": S({
    label: "Setup",
    chrome: "office",
    page: "frontend/src/DraftHub/HubSetup.jsx",
    also: ["frontend/src/DraftHub/LeagueSetup.jsx"],
    copy: "frontend/src/DraftHub/leagueAccessCopy.js",
    doNot: "Setup is connections and imports, not a fourth top-level area.",
  }),
  "tools.dfs": S({
    label: "DFS",
    chrome: "experience",
    page: "frontend/src/LineupOptimizer.jsx",
    copy: "frontend/src/dfsToolPresentation.js",
    doNot: "Reuse experience classes and dfsToolPresentation.js. Do not fork a DFS hero.",
  }),
  "tools.mock-draft": S({
    label: "Mock draft",
    chrome: "experience",
    page: "frontend/src/DraftHub/MockDraftTool.jsx",
    copy: "frontend/src/DraftHub/mockDraftConfig.js",
    doNot: "Idle mock uses this launch page. A running mock uses DraftRoom.",
  }),
  "tools.mock-draft.live": S({
    label: "Mock draft (live)",
    chrome: "draft-live",
    page: "frontend/src/DraftHub/DraftRoom.jsx",
    doNot: "A live mock is board-first. Same photos as rosters.",
  }),
  "tools.best-ball": S({
    label: "Best ball",
    chrome: "experience",
    page: "frontend/src/BestBallBoard.jsx",
    copy: "frontend/src/bestBallPresentation.js",
    doNot: "Reuse HubExperience*. Do not invent a fourth top-level area.",
  }),
  "projections.weekly": S({
    label: "Weekly",
    chrome: "board",
    page: "frontend/src/WeeklyTable.jsx",
    copy: "frontend/src/projectionsPresentation.js",
    also: [
      "frontend/src/ProjectionBoardChrome.jsx",
      "frontend/src/styles/projections-experience.css",
    ],
    doNot: "Projections are a board. Do not wrap them in HubExperienceLayout.",
  }),
  "projections.season": S({
    label: "Season",
    chrome: "board",
    page: "frontend/src/DraftTable.jsx",
    copy: "frontend/src/projectionsPresentation.js",
    also: [
      "frontend/src/ProjectionBoardChrome.jsx",
      "frontend/src/styles/projections-experience.css",
    ],
    doNot: "Season is a board, not a Fantasy decision page.",
  }),
  "projections.inspector": S({
    label: "Player inspector",
    chrome: "board",
    page: "frontend/src/PlayerCardModal.jsx",
    copy: "frontend/src/projectionsPresentation.js",
    also: ["frontend/src/ProjectionExplanationPanel.jsx"],
    doNot: "Desktop inspector is a right drawer. Do not invent a second player card.",
  }),
  "account.model": S({
    label: "Model accuracy",
    chrome: "account",
    page: "frontend/src/AccuracyChart.jsx",
    doNot: "Account-only. Do not add Model accuracy to top-level nav.",
  }),
  "account.admin": S({
    label: "Admin",
    chrome: "account",
    page: "frontend/src/AdminPortal.jsx",
    doNot: "Account-only. Do not add Admin to top-level nav.",
  }),
  "account.account": S({
    label: "Account",
    chrome: "account",
    page: "frontend/src/AccountSettingsPage.jsx",
    also: ["frontend/src/AccountAuth.jsx"],
    doNot: "Account-only. Do not add Account to top-level nav.",
  }),
  "account.login": S({
    label: "Sign in",
    chrome: "account",
    page: "frontend/src/AuthSessionPage.jsx",
    copy: "frontend/src/authPresentation.js",
    also: ["frontend/src/AccountAuth.jsx", "frontend/src/styles/auth-session.css"],
    doNot: "Account-only session page. Do not wrap in Fantasy experience chrome.",
  }),
  "account.register": S({
    label: "Create account",
    chrome: "account",
    page: "frontend/src/AuthSessionPage.jsx",
    copy: "frontend/src/authPresentation.js",
    also: ["frontend/src/AccountAuth.jsx", "frontend/src/styles/auth-session.css"],
    doNot: "Account-only session page. Do not wrap in Fantasy experience chrome.",
  }),
});

/** Longer aliases win so "mock draft" beats "draft". */
export const SURFACE_ALIASES = Object.freeze({
  "fantasy home": "hub.home",
  "action center": "hub.home",
  "league home": "hub.home",
  "value sheet": "hub.value",
  strategy: "hub.value",
  "free agents": "hub.available",
  "available players": "hub.available",
  "live auction": "hub.room.live",
  "live draft": "hub.room.live",
  "live room": "hub.room.live",
  "nominee card": "hub.room.live",
  "draft nominee": "hub.room.live",
  "draft lobby": "hub.room",
  "draft calendar": "hub.room",
  "draft night": "hub.room",
  "league invite": "hub.room",
  "this week": "hub.week",
  "command center": "hub.week",
  "game center": "hub.game",
  matchup: "hub.game",
  "my team": "hub.roster",
  "my roster": "hub.roster",
  "salary sheets": "hub.office.historic",
  "roster management": "hub.office",
  "access & imports": "hub.office.access",
  "mock draft": "tools.mock-draft",
  "best ball": "tools.best-ball",
  "player inspector": "projections.inspector",
  "player card": "projections.inspector",
  "model accuracy": "account.model",
  "preseason outlook": "projections.season",
  "live season": "projections.season",
  weekly: "projections.weekly",
  season: "projections.season",
  rosters: "hub.rosters",
  contracts: "hub.office.current",
  members: "hub.office.members",
  insights: "hub.insights",
  trades: "hub.trades",
  rules: "hub.rules",
  office: "hub.office",
  cap: "hub.planner",
  draft: "hub.room",
  home: "hub.home",
  dfs: "tools.dfs",
  lineup: "tools.dfs",
  admin: "account.admin",
  account: "account.account",
  login: "account.login",
  "sign in": "account.login",
  "create account": "account.register",
  register: "account.register",
  signup: "account.register",
});

export function getLivingSurface(id) {
  return LIVING_SURFACES[id] || null;
}

export function resolveLivingSurface({
  section = null,
  hubView = null,
  toolsTab = null,
  projectionsTab = null,
  officeTab = null,
  draftLive = false,
  inspector = false,
} = {}) {
  if (inspector) return getLivingSurface("projections.inspector");
  if (section === "projections") {
    return getLivingSurface(`projections.${projectionsTab || "weekly"}`);
  }
  if (section === "tools") {
    if (toolsTab === "mock-draft" && draftLive) {
      return getLivingSurface("tools.mock-draft.live");
    }
    return getLivingSurface(`tools.${toolsTab}`);
  }
  if (section === "hub") {
    if (hubView === "room" && draftLive) return getLivingSurface("hub.room.live");
    if (hubView === "office" && officeTab) {
      return getLivingSurface(`hub.office.${officeTab}`) || getLivingSurface("hub.office");
    }
    return getLivingSurface(`hub.${hubView}`);
  }
  if (section === "model") return getLivingSurface("account.model");
  if (section === "admin") return getLivingSurface("account.admin");
  if (section === "account") return getLivingSurface("account.account");
  return null;
}

function textHasAlias(hay, alias) {
  if (alias.includes(" ")) return hay.includes(alias);
  return new RegExp(`(^|[^a-z0-9])${alias}([^a-z0-9]|$)`).test(hay);
}

export function resolveLivingSurfaceFromText(text) {
  const hay = String(text || "").toLowerCase();
  const aliases = Object.keys(SURFACE_ALIASES).sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    if (textHasAlias(hay, alias)) return getLivingSurface(SURFACE_ALIASES[alias]);
  }
  return null;
}

function rowMentionsFile(row, path) {
  if (row.page === path || row.copy === path) return true;
  return Array.isArray(row.also) && row.also.includes(path);
}

export function surfacesForFile(repoPath) {
  const path = String(repoPath || "").replace(/\\/g, "/");
  const hits = Object.entries(LIVING_SURFACES)
    .filter(([, row]) => rowMentionsFile(row, path))
    .map(([id, row]) => ({ id, ...row }));
  if (hits.length) return hits;
  const sharedPaths = Object.values(SHARED).flat();
  if (sharedPaths.includes(path)) {
    return [{ id: "shared", label: "Shared chrome", chrome: "experience", page: path }];
  }
  return [];
}
