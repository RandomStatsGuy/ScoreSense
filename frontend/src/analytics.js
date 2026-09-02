/**
 * Google Analytics 4 (measurement ID G-HTRKTLQVXM).
 *
 * SPA page views are sent manually so React Router navigations show up as
 * distinct pages. Query params that can contain JWTs, invites, or search
 * strings are stripped; filter params (pos, week, season, …) are kept.
 *
 * Hits are only sent on production hostnames — not localhost / Vite preview.
 */
import { parseAppPath } from "./routes.js";

export const GA_MEASUREMENT_ID = "G-HTRKTLQVXM";

export const TRACKED_HOSTNAMES = new Set([
  "app.fourthdownlabs.com",
  "www.fourthdownlabs.com",
  "fourthdownlabs.com",
]);

/** Query keys that must never be sent to GA (secrets / high-cardinality PII). */
export const DROP_QUERY_KEYS = new Set([
  "token",
  "code",
  "invite",
  "claim",
  "q",
  "compare",
  "cmp",
  "email",
  "state",
]);

/** Filter keys that are useful in GA and safe to keep on page_path. */
export const KEEP_QUERY_KEYS = new Set([
  "pos",
  "week",
  "season",
  "teams",
  "movers",
  "draftSeason",
  "fromWeek",
  "rosSeason",
]);

/** Routes that immediately <Navigate> elsewhere — skip to avoid double hits. */
export const SKIP_PATHS = new Set([
  "/",
  "/auth/callback",
  "/signup",
  "/hub",
  "/hub/office",
  "/hub/insights",
  "/hub/insights/trades",
  "/hub/insights/desk",
  "/hub/insights/salaries",
  "/hub/insights/contracts",
  "/hub/live",
  "/hub/teams",
  "/tools",
]);

const STANDALONE_TITLES = {
  "/privacy": "Privacy",
  "/terms": "Terms",
  "/sms-alerts": "Draft alert texts",
  "/account": "Account",
  "/login": "Sign in",
  "/register": "Create account",
  "/signup": "Create account",
  "/auth/verify": "Auth · Verify email",
  "/auth/reset-password": "Auth · Reset password",
  "/auth/forgot-password": "Auth · Forgot password",
  "/model": "Model accuracy",
};

const HUB_PAGE_LABELS = {
  home: "Home",
  setup: "Setup",
  rules: "Rules",
  value: "Strategy",
  available: "Free agents",
  week: "This Week",
  vibes: "Vibes",
  game: "Game center",
  roster: "My Team",
  rosters: "Rosters",
  room: "Draft",
  planner: "Cap",
  trades: "Trades",
};

const INSIGHT_PAGE_LABELS = {
  overview: "Overview",
  cap: "Spend",
  scoring: "Scoring",
  ownership: "History",
};

const OFFICE_PAGE_LABELS = {
  chat: "Contracts",
  current: "Contracts",
  historic: "Salary sheets",
  members: "Members",
  access: "Access",
};

const WEEKLY_PANEL_LABELS = {
  injuries: "Injuries",
  fantasy: "Fantasy",
};

let initialized = false;

export function resetAnalyticsForTests() {
  initialized = false;
}

export function analyticsEnabled(hostname) {
  return TRACKED_HOSTNAMES.has(String(hostname || "").toLowerCase());
}

/**
 * Official gtag snippet for production `index.html`.
 * GA's stream-setup crawler only inspects HTML (it does not run the SPA bundle),
 * so the script src and config call must be present in the document source.
 * Config is hostname-gated so a local `vite preview` of a production build
 * does not send hits.
 */
export function productionGtagHtmlSnippet({
  measurementId = GA_MEASUREMENT_ID,
  hostnames = TRACKED_HOSTNAMES,
} = {}) {
  const hosts = JSON.stringify([...hostnames]);
  return [
    "<!-- Google tag (gtag.js) -->",
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script>`,
    "<script>",
    "window.dataLayer = window.dataLayer || [];",
    "function gtag(){dataLayer.push(arguments);}",
    "window.__SS_GA = 1;",
    `if (${hosts}.indexOf(location.hostname) !== -1) {`,
    "  gtag('js', new Date());",
    `  gtag('config', '${measurementId}', { send_page_view: false, anonymize_ip: true });`,
    "}",
    "</script>",
  ].join("\n    ");
}

export function sanitizeSearch(search) {
  const raw = String(search || "");
  const withoutQ = raw.startsWith("?") ? raw.slice(1) : raw;
  if (!withoutQ) return "";
  const params = new URLSearchParams(withoutQ);
  const out = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    const k = key.toLowerCase();
    if (DROP_QUERY_KEYS.has(k)) continue;
    if (!KEEP_QUERY_KEYS.has(key) && !KEEP_QUERY_KEYS.has(k)) continue;
    out.append(key, value);
  }
  const qs = out.toString();
  return qs ? `?${qs}` : "";
}

export function shouldSkipPageView(pathname) {
  if (!pathname) return true;
  if (SKIP_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/auth/callback")) return true;
  if (STANDALONE_TITLES[pathname]) return false;
  if (parseAppPath(pathname) == null) return true;
  return false;
}

export function pageGroupForPath(pathname) {
  const root = String(pathname || "").split("/").filter(Boolean)[0] || "";
  if (root === "projections") return "projections";
  if (root === "hub") return "fantasy";
  if (root === "tools") return "tools";
  if (root === "model") return "model";
  if (root === "admin") return "admin";
  if (root === "account") return "account";
  if (root === "login" || root === "register" || root === "signup") return "auth";
  if (root === "terms" || root === "privacy" || root === "sms-alerts") return "legal";
  if (root === "auth") return "auth";
  return "other";
}

export function pageTitleForPath(pathname) {
  if (STANDALONE_TITLES[pathname]) return STANDALONE_TITLES[pathname];

  const parsed = parseAppPath(pathname);
  if (!parsed) return "ScoreSense";

  if (parsed.view === "projections") {
    if (parsed.projectionsTab === "weekly") {
      const panel = WEEKLY_PANEL_LABELS[parsed.projectionsMobilePanel];
      return panel ? `Projections · Weekly · ${panel}` : "Projections · Weekly";
    }
    const mode = parsed.seasonMode === "preseason" ? "Preseason" : "Live";
    if (parsed.seasonMobilePanel === "narrative") {
      return `Projections · Season · ${mode} · Narrative`;
    }
    return `Projections · Season · ${mode}`;
  }

  if (parsed.view === "hub") {
    if (parsed.hubSubView === "insights") {
      const insight = INSIGHT_PAGE_LABELS[parsed.insightTab] || "Overview";
      return `Fantasy · Insights · ${insight}`;
    }
    if (parsed.hubSubView === "office") {
      const office = OFFICE_PAGE_LABELS[parsed.officeTab] || "Contracts";
      return `Fantasy · Roster management · ${office}`;
    }
    const hub = HUB_PAGE_LABELS[parsed.hubSubView] || "Home";
    return `Fantasy · ${hub}`;
  }

  if (parsed.view === "tools") {
    if (parsed.toolsTab === "mock-draft") return "Tools · Mock draft";
    if (parsed.toolsTab === "best-ball") return "Tools · Best ball";
    return "Tools · DFS";
  }
  if (parsed.view === "admin") {
    if (parsed.adminTab === "users") return "Admin · Users";
    if (parsed.adminTab === "leagues") return "Admin · Leagues";
    return "Admin · Overview";
  }

  return "ScoreSense";
}

export function buildPageViewPayload({
  pathname,
  search = "",
  origin = "",
}) {
  const pagePath = `${pathname}${sanitizeSearch(search)}`;
  return {
    page_title: pageTitleForPath(pathname),
    page_path: pagePath,
    page_location: `${origin}${pagePath}`,
    page_group: pageGroupForPath(pathname),
  };
}

function ensureGtag(win) {
  win.dataLayer = win.dataLayer || [];
  if (typeof win.gtag !== "function") {
    win.gtag = function gtag() {
      win.dataLayer.push(arguments);
    };
  }
}

export function initAnalytics({
  measurementId = GA_MEASUREMENT_ID,
  hostname,
  win = typeof window !== "undefined" ? window : undefined,
  doc = typeof document !== "undefined" ? document : undefined,
} = {}) {
  if (!win || !doc) return false;
  const host = hostname ?? win.location?.hostname ?? "";
  if (!analyticsEnabled(host)) return false;
  if (initialized) return true;
  initialized = true;

  ensureGtag(win);
  const existing = doc.querySelector(`script[src*="googletagmanager.com/gtag/js"]`);
  // Production index.html already ships the official snippet. Don't double-config.
  if (!existing && !win.__SS_GA) {
    win.gtag("js", new Date());
    win.gtag("config", measurementId, {
      send_page_view: false,
      anonymize_ip: true,
    });
    const script = doc.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    doc.head.appendChild(script);
  }
  return true;
}

export function trackPageView(locationLike, {
  win = typeof window !== "undefined" ? window : undefined,
  doc = typeof document !== "undefined" ? document : undefined,
} = {}) {
  if (!win || typeof win.gtag !== "function") return false;
  const host = win.location?.hostname ?? "";
  if (!analyticsEnabled(host)) return false;
  const pathname = locationLike?.pathname || "";
  if (shouldSkipPageView(pathname)) return false;

  const payload = buildPageViewPayload({
    pathname,
    search: locationLike?.search || "",
    origin: win.location?.origin || "",
  });
  win.gtag("event", "page_view", payload);
  if (doc) {
    doc.title = `${payload.page_title} · ScoreSense`;
  }
  return true;
}
