/** Copy for Account → Report a bug. Goal + consequence. */

export const REPORT_AREAS = Object.freeze([
  "Projections",
  "Fantasy",
  "Tools",
  "Account",
  "Sign in",
  "Other",
]);

export const BUG_REPORT_COPY = Object.freeze({
  menu: "Report a bug",
  eyebrow: "Report a bug",
  heading: "Tell us what broke.",
  support: "It lands on the pickup board. Someone takes the ticket.",
  titleLabel: "Short title",
  titlePlaceholder: "Create league eats the click",
  happenedLabel: "What happened",
  happenedPlaceholder: "I tapped Create league and the overlay closed without making a room.",
  expectedLabel: "What should happen",
  expectedPlaceholder: "The room is created and Fantasy switches to it.",
  areaLabel: "Where",
  pathLabel: "Page",
  send: "Send to the board",
  sending: "Sending…",
  needTitle: "Give it a short title.",
  needHappened: "Say what broke in a sentence or two.",
  needAccount: "Sign in so we can follow up.",
  signIn: "Sign in",
  createAccount: "Create account",
  boardClosed: "The board is not taking reports right now.",
  sendFailed: "Could not file this report. Try again in a minute.",
  tooMany: "Too many reports from this account. Try again later.",
  accountLink: "Something broken? Send a report. It lands on the pickup board.",
  accountAction: "Report a bug",
  back: "Back",
});

export function inferReportArea(path) {
  const p = String(path || "");
  if (p.startsWith("/hub")) return "Fantasy";
  if (p.startsWith("/projections")) return "Projections";
  if (p.startsWith("/tools")) return "Tools";
  if (p.startsWith("/account") || p.startsWith("/model") || p.startsWith("/admin")) return "Account";
  if (
    p.startsWith("/login")
    || p.startsWith("/register")
    || p.startsWith("/signup")
    || p.startsWith("/auth")
  ) {
    return "Sign in";
  }
  return "Other";
}

export function safeReportFrom(value) {
  const raw = String(value || "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("://")) return "";
  if (raw.startsWith("/login") || raw.startsWith("/register") || raw.startsWith("/signup")) return "";
  if (raw.startsWith("/auth/")) return "";
  return raw.split("?")[0].slice(0, 200);
}

export function reportSuccess(key) {
  const id = String(key || "").trim();
  if (!id) return "It's on the pickup board. Someone will take it.";
  return `It's on the pickup board as ${id}. Someone will take it.`;
}

export function reportHref(fromPath) {
  const from = safeReportFrom(fromPath);
  return from ? `/report?from=${encodeURIComponent(from)}` : "/report";
}
