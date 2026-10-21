/** Copy for Sign in / Create account / password reset. Goal + consequence. */

export const AUTH_COPY = Object.freeze({
  login: Object.freeze({
    eyebrow: "Sign in",
    heading: "Sign in to your league.",
    support: "Return to your leagues, draft seats, and saved settings.",
    submit: "Sign in",
    submitBusy: "Signing in…",
    switchPrompt: "New here?",
    switchAction: "Create account",
  }),
  register: Object.freeze({
    eyebrow: "Create account",
    heading: "Create an account for your leagues.",
    support: "Use one account for your leagues, draft seats, and saved settings.",
    submit: "Create account",
    submitBusy: "Creating account…",
    switchPrompt: "Already have an account?",
    switchAction: "Sign in",
  }),
  forgot: Object.freeze({
    eyebrow: "Reset password",
    heading: "Send a reset link.",
    support: "We’ll email a link if this address already has an account.",
    submit: "Send reset link",
    submitBusy: "Sending…",
    sent: "If an account exists, a reset link was sent to your email.",
    back: "Back to sign in",
  }),
  reset: Object.freeze({
    eyebrow: "Reset password",
    heading: "Choose a new password.",
    support: "Use at least 8 characters. Then sign in with the new password.",
    submit: "Update password",
    submitBusy: "Saving…",
    done: "Your password was updated. Sign in to continue.",
    missing: "This reset link is missing. Request a new one from sign in.",
  }),
  verify: Object.freeze({
    eyebrow: "Email",
    heading: "Confirm your email.",
    confirming: "Confirming your email…",
    success: "Your email is verified. You can use Fantasy and saved features.",
    error: "This verification link is invalid or expired.",
    waiting: "Check your inbox for a verification link.",
    openFantasy: "Open Fantasy",
    browse: "Browse projections",
    continue: "Continue",
  }),
  google: "Continue with Google",
  googleUnavailable: "Google sign-in isn't set up on this server yet.",
  patreon: "Continue with Patreon",
  patreonNote: "For active patrons.",
  emailDivider: "or use email",
  socialTerms: "Google and Patreon continue under the Terms and Privacy Policy.",
  forgotLink: "Forgot password?",
  displayName: "Display name",
  email: "Email",
  password: "Password",
  passwordHint: "At least 8 characters",
  passwordCurrent: "Your password",
  confirmPassword: "Confirm password",
  newPassword: "New password",
  defaultError: "Could not sign in",
  brandBack: "Back",
  googleLinked: "Signed in with Google.",
  setPasswordHint: "Set a password from Forgot password if you also want email sign-in.",
  passwordDisabled: "Password sign-in is disabled. Use Forgot password to set a new one.",
  passwordManagedPatreon: "Password is managed by Patreon.",
  deleteConfirmEmail: "Type your account email",
  companion: Object.freeze({
    storyEyebrow: "Fantasy football",
    storyHeading: "Projections, leagues and tools.",
    storySupport: "Compare player projections, play in a league, or practice a draft.",
    registerEyebrow: "ScoreSense account",
    registerHeading: "Create your account.",
    registerSupport: "Use one account for Fantasy, Tools and saved settings. Projections are free without an account.",
    loginEyebrow: "ScoreSense account",
    loginHeading: "Sign in to ScoreSense.",
    loginSupport: "Return to your leagues and saved settings.",
    email: "Continue with email",
    optional: "optional",
    showPassword: "Show password",
    hidePassword: "Hide password",
    show: "Show",
    hide: "Hide",
    passwordHint: "At least 8 characters.",
    socialConsent: "By continuing, you agree to the",
    terms: "Terms",
    privacy: "Privacy Policy",
    and: "and",
    patronPrompt: "Already a patron?",
    next: "Next up:",
    back: "Back to ScoreSense",
    illustration: "Illustrative preview",
    floor: "Floor",
    outlook: "Median (P50)",
    ceiling: "Ceiling",
    safer: "10th percentile",
    upside: "90th percentile",
    fantasyRoom: "Team rooms for your league.",
    fantasySupport: "Your roster, starters and weekly matchup.",
    tools: Object.freeze(["Mock drafts", "DFS lineups", "Best ball rankings"]),
    values: Object.freeze([
      Object.freeze({ area: "Projections", support: "Compare weekly and season projections." }),
      Object.freeze({ area: "Fantasy", support: "League play, with optional contracts and a salary cap." }),
      Object.freeze({ area: "Tools", support: "Practice drafts, build DFS lineups and compare best ball rankings." }),
    ]),
  }),
});

const AUTH_NEXT_BLOCK = /^\/(?:login|register|signup)(?:\/|\?|#|$)|^\/auth(?:\/|\?|#|$)/i;

export function safeAuthNext(raw, fallback = "/projections/weekly") {
  const next = String(raw || "").trim();
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  // Validate decoded forms without rewriting the query: invitation and claim
  // tokens must arrive exactly as supplied by their existing flows.
  let decoded = next;
  for (let depth = 0; depth < 6; depth += 1) {
    if (!decoded.startsWith("/") || decoded.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(decoded)) return fallback;
    if (AUTH_NEXT_BLOCK.test(decoded)) return fallback;
    try {
      const unescaped = decodeURIComponent(decoded);
      if (unescaped === decoded) break;
      decoded = unescaped;
      if (depth === 5) return fallback;
    } catch {
      return fallback;
    }
  }
  const path = decoded.split(/[?#]/, 1)[0];
  const normalized = new URL(path, "https://scoresense.invalid");
  if (normalized.origin !== "https://scoresense.invalid" || AUTH_NEXT_BLOCK.test(normalized.pathname)) return fallback;
  return next;
}

export const AUTH_DESTINATIONS = Object.freeze({
  weekly: Object.freeze({ name: "Weekly projections", area: "Projections", landing: "/projections", path: "/projections/weekly", title: "Projections include a range.", note: "Projections are free without an account. Weekly and season forecasts show a floor, P50 median and ceiling." }),
  fantasy: Object.freeze({ name: "Fantasy", area: "Fantasy", landing: "/fantasy", path: "/hub/home", title: "Your draft, roster and matchups.", note: "Draft, manage rosters and make trades. Contracts and a salary cap are optional." }),
  tools: Object.freeze({ name: "Mock draft", area: "Tools", landing: "/tools", path: "/tools/mock-draft", title: "Mock drafts, DFS and best ball.", note: "Practice drafts, build DFS lineups and compare best ball rankings." }),
});

export function authDestinationName(next) {
  const pathname = new URL(safeAuthNext(next), "https://scoresense.invalid").pathname;
  if (/^\/tools\/dfs(?:\/|$)/.test(pathname)) return "DFS";
  if (/^\/tools\/best-ball(?:\/|$)/.test(pathname)) return "Best ball";
  if (/^\/tools\/mock-draft(?:\/|$)/.test(pathname)) return "Mock draft";
  if (/^\/tools(?:\/|$)/.test(pathname)) return "Tools";
  if (/^\/projections\/weekly(?:\/|$)/.test(pathname)) return "Weekly projections";
  if (/^\/projections\/season\/preseason(?:\/|$)/.test(pathname)) return "Preseason outlook";
  if (/^\/projections\/season\/live(?:\/|$)/.test(pathname)) return "Live season";
  if (/^\/projections\/season(?:\/|$)/.test(pathname)) return "Season outlook";
  if (/^\/projections(?:\/|$)/.test(pathname)) return "Projections";
  if (/^\/(?:hub|fantasy)(?:\/|$)/.test(pathname)) return "Fantasy";
  return "ScoreSense";
}

export function authSessionContext(search = "") {
  const params = new URLSearchParams(search);
  const requestedIntent = params.get("intent");
  const knownIntent = Object.hasOwn(AUTH_DESTINATIONS, requestedIntent) ? requestedIntent : null;
  const fromLanding = params.get("from") === "landing";
  const next = safeAuthNext(params.get("next"), AUTH_DESTINATIONS[knownIntent || "weekly"].path);
  const nextUrl = new URL(next, "https://scoresense.invalid");
  const inferredIntent = /^\/(?:hub|fantasy)(?:\/|$)/.test(nextUrl.pathname) ? "fantasy" : /^\/tools(?:\/|$)/.test(nextUrl.pathname) ? "tools" : "weekly";
  const intent = knownIntent || inferredIntent;
  const isJoin = nextUrl.searchParams.has("invite") || nextUrl.searchParams.has("claim");
  const isPublicReturn = nextUrl.pathname === "/" || ["/projections", "/fantasy", "/tools"].includes(nextUrl.pathname) || /^\/(?:terms|privacy|sms-alerts|lobby|team-room)(?:\/|$)/.test(nextUrl.pathname);
  return {
    next,
    intent,
    fromLanding,
    backTo: fromLanding ? AUTH_DESTINATIONS[intent].landing : isJoin || isPublicReturn ? next : "/",
    destination: { ...AUTH_DESTINATIONS[intent], name: authDestinationName(next) },
  };
}

export function authModeHref(mode, next, context = {}) {
  const params = new URLSearchParams({ next: safeAuthNext(next) });
  if (context.fromLanding) {
    params.set("from", "landing");
    params.set("intent", Object.hasOwn(AUTH_DESTINATIONS, context.intent) ? context.intent : "weekly");
  }
  return `/${mode === "register" ? "register" : "login"}?${params}`;
}

const LANDING_AUTH_INTENT_KEY = "scoresense:landing-auth-intent";
const LANDING_AUTH_INTENT_MAX_AGE = 24 * 60 * 60 * 1000;

// Verification emails open a new tab without the original signup query. Keep
// only the selected public product intent, never a token, email or return URL.
export function rememberLandingAuthIntent(intent, storage, now = Date.now()) {
  if (!Object.hasOwn(AUTH_DESTINATIONS, intent)) return false;
  try {
    const target = storage || globalThis.localStorage;
    if (!target?.setItem) return false;
    target.setItem(LANDING_AUTH_INTENT_KEY, JSON.stringify({ intent, createdAt: now }));
    return true;
  } catch {
    return false;
  }
}

export function clearLandingAuthIntent(storage) {
  try {
    (storage || globalThis.localStorage)?.removeItem(LANDING_AUTH_INTENT_KEY);
  } catch {
    // Storage is optional; unavailable storage must not block authentication.
  }
}

export function readLandingAuthIntent(storage, now = Date.now()) {
  try {
    const value = JSON.parse((storage || globalThis.localStorage)?.getItem(LANDING_AUTH_INTENT_KEY) || "null");
    if (!value) return null;
    if (!Object.hasOwn(AUTH_DESTINATIONS, value.intent) || !Number.isFinite(value.createdAt)
      || now < value.createdAt || now - value.createdAt > LANDING_AUTH_INTENT_MAX_AGE) {
      clearLandingAuthIntent(storage);
      return null;
    }
    return value.intent;
  } catch {
    clearLandingAuthIntent(storage);
    return null;
  }
}

export function authOauthNext(explicit, search = "") {
  if (explicit) return safeAuthNext(explicit);
  const fromQuery = new URLSearchParams(search).get("next");
  if (fromQuery) return safeAuthNext(fromQuery);
  if (typeof window !== "undefined") {
    return safeAuthNext(`${window.location.pathname}${window.location.search}`);
  }
  return "/projections/weekly";
}
