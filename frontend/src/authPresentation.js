/** Copy for Sign in / Create account / password reset. Goal + consequence. */

export const AUTH_COPY = Object.freeze({
  login: Object.freeze({
    eyebrow: "Sign in",
    heading: "Get back to your league.",
    support: "Projections, the draft, and your cap stay on this account.",
    submit: "Sign in",
    submitBusy: "Signing in…",
    switchPrompt: "New here?",
    switchAction: "Create account",
  }),
  register: Object.freeze({
    eyebrow: "Create account",
    heading: "Start your ScoreSense account.",
    support: "Save leagues, contracts, and the draft to one login.",
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
  }),
  google: "Continue with Google",
  googleUnavailable: "Google sign-in isn't set up on this server yet.",
  patreon: "Continue with Patreon",
  patreonNote: "For active patrons.",
  emailDivider: "or use email",
  socialTerms: "By continuing you agree to the Terms of Service and Privacy Policy.",
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
  passwordManagedPatreon: "Password is managed by Patreon.",
  deleteConfirmEmail: "Type your account email",
});

const AUTH_NEXT_BLOCK = /^\/(login|register|signup|auth\/)/i;

export function safeAuthNext(raw, fallback = "/projections/weekly") {
  const next = String(raw || "").trim();
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  if (AUTH_NEXT_BLOCK.test(next)) return fallback;
  return next;
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
