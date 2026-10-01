/** One code-loading boundary shared by warmup and React.lazy. No user data. */
export const fantasyPageModules = {
  home: () => import("./LeagueHome"),
  week: () => import("./WeeklyExperience"),
  roster: () => import("./RosterBuilder"),
  rosters: () => import("./LeagueRostersBrowser"),
  available: () => import("./ValueSheetTable"),
  value: () => import("./StrategyBoard"),
  room: () => import("./DraftRoom"),
  planner: () => import("./CapPlanner"),
  rules: () => import("./RulesWizard"),
  setup: () => import("./HubSetup"),
  office: () => import("./LeagueOffice"),
  trades: () => import("./LeagueTrades"),
  insights: () => import("./LeagueInsights"),
  vibes: () => import("./VibeRankings"),
};

export function preloadFantasyPage(view, modules = fantasyPageModules) {
  // Only the selected destination. A failed speculative read must not become
  // an unhandled rejection or hold up the independent workspace request.
  const load = modules[view === "game" ? "week" : view];
  if (!load) return Promise.resolve();
  return Promise.resolve().then(load).catch(() => {});
}
