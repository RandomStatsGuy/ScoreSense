/** Remember the last Projections / Fantasy / Tools destination across area switches. */

export const LAST_DESTINATIONS_KEY = "scoresense.lastDestinations";

const SECTIONS = new Set(["hub", "projections", "tools"]);

export const DEFAULT_DESTINATIONS = {
  hub: { hubSubView: "home", officeTab: null, insightTab: null },
  projections: { projectionsTab: "weekly", seasonMode: "live" },
  tools: { toolsTab: "dfs" },
};

function storageOf(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function snapshotDestination(route) {
  const view = route?.view;
  if (view === "hub") {
    const hubSubView = route.hubSubView || "home";
    return {
      hubSubView,
      officeTab: hubSubView === "office" ? (route.officeTab || "current") : null,
      insightTab: hubSubView === "insights" ? (route.insightTab || "overview") : null,
    };
  }
  if (view === "projections") {
    return {
      projectionsTab: route.projectionsTab || "weekly",
      seasonMode: route.seasonMode || "live",
    };
  }
  if (view === "tools") {
    return { toolsTab: route.toolsTab || "dfs" };
  }
  return null;
}

export function readLastDestinations(storage) {
  const store = storageOf(storage);
  let parsed = {};
  try {
    parsed = JSON.parse(store?.getItem(LAST_DESTINATIONS_KEY) || "{}") || {};
  } catch {
    parsed = {};
  }
  return {
    hub: { ...DEFAULT_DESTINATIONS.hub, ...(parsed.hub || {}) },
    projections: { ...DEFAULT_DESTINATIONS.projections, ...(parsed.projections || {}) },
    tools: { ...DEFAULT_DESTINATIONS.tools, ...(parsed.tools || {}) },
  };
}

export function rememberDestination(route, storage) {
  const view = route?.view;
  if (!SECTIONS.has(view)) return readLastDestinations(storage);
  const snap = snapshotDestination(route);
  const all = readLastDestinations(storage);
  all[view] = snap;
  const store = storageOf(storage);
  try {
    store?.setItem(LAST_DESTINATIONS_KEY, JSON.stringify(all));
  } catch {
    /* private mode / blocked storage */
  }
  return all;
}

export function destinationForSection(section, { current, storage } = {}) {
  if (!SECTIONS.has(section)) return {};
  if (current?.view === section) {
    return snapshotDestination(current) || DEFAULT_DESTINATIONS[section];
  }
  return readLastDestinations(storage)[section] || DEFAULT_DESTINATIONS[section];
}

export function reopenDestinationEvent(section) {
  return new CustomEvent("scoresense-reopen-destination", { detail: { section } });
}
