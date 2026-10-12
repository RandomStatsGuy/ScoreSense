/** One bounded, browser-memory working draft. It is never an access credential,
 * entry template, export artifact, or a replacement for the portable backup. */
const fields = [
  "meta", "formats", "context", "slates", "pool", "salaries", "salarySnapshot", "stats", "poolFreshness",
  "vegasGames", "stackWeights", "slateName", "lineups", "selected", "savedBuild", "buildSettings", "currentBuild",
  "portfolio", "portfolioLimits", "portfolioRules", "globalExposure", "globalUnit", "globalGroups", "classicStackRules",
  "stackScope", "appliedPlan", "portfolioSelection", "locked", "excluded", "overrides", "ownership", "captainLimits",
  "settings", "poolInputVersion", "poolUpdate", "poolUpdateHistory", "dataUpdateAvailable", "workspaceUi",
  "comparison", "playerComparison", "comparisonStartedAt", "buildJob", "projectionImportSource", "seenRevision",
];

export function createNavigationDraftStore({ maxBytes = 32 * 1024 * 1024, maxAgeMs = 8 * 60 * 60 * 1000, now = Date.now } = {}) {
  let record = null;
  const clear = () => { record = null; };
  const validScope = scope => scope === "browser-local" || (typeof scope === "string" && /^account:.{1,100}$/.test(scope));
  return {
    clear,
    write(scope, state) {
      clear();
      if (!validScope(scope) || !state?.context || !Array.isArray(state.pool)) return false;
      try {
        const draft = Object.fromEntries(fields.filter(key => state[key] !== undefined).map(key => [key, state[key]]));
        // Pending work is cancelled on leaving the page; returning never resumes a request.
        if (draft.buildJob?.status === "running") draft.buildJob = { ...draft.buildJob, status: "cancelled", finishedAt: now() };
        const json = JSON.stringify(draft);
        if (new TextEncoder().encode(json).byteLength > maxBytes) return false;
        record = { scope, savedAt: now(), draft: structuredClone(draft) };
        return true;
      } catch { return false; }
    },
    read(scope) {
      if (!validScope(scope) || record?.scope !== scope || now() - record.savedAt > maxAgeMs) { clear(); return null; }
      return structuredClone(record.draft);
    },
  };
}

export const dfsNavigationDraft = createNavigationDraftStore();
// This listener outlives the DFS screen so signing out while researching a player
// cannot leave a previous account's draft available to the next mount.
if (typeof window !== "undefined") window.addEventListener("scoresense-auth-changed", () => dfsNavigationDraft.clear());
