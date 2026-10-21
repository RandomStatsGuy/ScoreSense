import { joinLandingPath, joinLandingSearch, withLocationSearch } from "./redirectSearch.js";

const PRODUCT_LANDINGS = Object.freeze({
  projections: "/projections",
  hub: "/fantasy",
  tools: "/tools",
});
const MARKETING_PATHS = new Set(["/", ...Object.values(PRODUCT_LANDINGS)]);

export function normalizePublicEntryPath(pathname = "") {
  // Match React Router's decoding without turning an encoded slash into a
  // different route segment. Preserve the actual URL and its query tokens.
  let decoded = pathname;
  try {
    decoded = pathname.split("/").map(segment => decodeURIComponent(segment).replace(/\//g, "%2F")).join("/");
  } catch {
    // React Router also retains the original path when decoding is invalid.
  }
  return (decoded === "/" ? decoded : decoded.replace(/\/$/, "")).toLowerCase();
}

export function isPublicLandingPath(pathname = "") {
  return MARKETING_PATHS.has(normalizePublicEntryPath(pathname));
}

/** The complete read-only Projections screens, including their existing panels. */
export function isPublicProjectionPath(pathname = "") {
  return /^\/projections\/(?:weekly(?:\/[^/]+)?|season(?:\/[^/]+){0,2})$/.test(normalizePublicEntryPath(pathname));
}

export function isDraftJoinPreview(pathname = "", search = "") {
  if (normalizePublicEntryPath(pathname) !== "/hub/draft") return false;
  const params = new URLSearchParams(search);
  return Boolean(params.get("invite")?.trim() || params.get("claim")?.trim());
}

/** Product participation requires an account even when local server auth is off. */
export function requiresProductAccount(pathname = "") {
  const path = normalizePublicEntryPath(pathname);
  return path === "/hub" || path.startsWith("/hub/") || path.startsWith("/tools/") || path === "/model";
}

/** Anonymous cross-area navigation introduces the area; current-area pickers stay put. */
export function publicSectionPath(section, { authenticated = false, currentView } = {}) {
  if (authenticated || section === currentView) return null;
  return Object.hasOwn(PRODUCT_LANDINGS, section) ? PRODUCT_LANDINGS[section] : null;
}

const PUBLIC_PATH_PREFIXES = [
  "/terms",
  "/privacy",
  "/sms-alerts",
  "/login",
  "/register",
  "/signup",
  "/auth/",
  "/lobby",
  "/team-room/",
];

/** Public product entry, projection reads, session pages and narrow join previews. */
export function isPublicAuthPath(pathname = "", search = "") {
  if (isPublicLandingPath(pathname) || isPublicProjectionPath(pathname)) return true;
  const path = normalizePublicEntryPath(pathname);
  if (PUBLIC_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix))) return true;
  return isDraftJoinPreview(pathname, search);
}

/** Public entry and projection reads render immediately; private screens wait for identity. */
export function authRouteState({ pathname, search = "", ready, authRequired, authenticated }) {
  if (!ready) return isPublicLandingPath(pathname) || isPublicProjectionPath(pathname) ? "allow" : "loading";
  if (!authenticated && requiresProductAccount(pathname) && !isDraftJoinPreview(pathname, search)) return "signin";
  if (authRequired && !authenticated && !isPublicAuthPath(pathname, search)) return "signin";
  return "allow";
}

/** Anonymous visitors see the landing; joins and established sessions keep their destinations. */
export function publicRootRedirect({ search = "", hash = "", ready = false, authenticated = false } = {}) {
  const destination = joinLandingPath(search);
  if (destination === "/hub/draft") {
    return withLocationSearch(destination, joinLandingSearch(search), hash);
  }
  if (ready && authenticated) return withLocationSearch(destination, search, hash);
  return null;
}
