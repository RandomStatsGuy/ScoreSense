/** Copy for Account → Admin. Goal + consequence. Staff-only. */

export const ADMIN_COPY = Object.freeze({
  unlinkSuccess: "Team unlinked from account",
  unlinkFailed: "Unlink failed",
  verification: Object.freeze({
    column: "Verified",
    yes: "Verified",
    no: "Not verified",
    verify: "Mark verified",
    unverify: "Remove verification",
    unavailable: "—",
    failed: "Could not change verification",
  }),
  tempPassword: Object.freeze({
    column: "Password",
    placeholder: "Temporary password",
    action: "Set temp password",
    hint: "They must choose their own at next sign-in.",
    tooShort: "Use at least 8 characters.",
    failed: "Could not set the password",
  }),
  linkExisting: Object.freeze({
    title: "Link existing account",
    hint: "They already have a ScoreSense login. Attach them to an open franchise so Fantasy opens their team.",
    emailPlaceholder: "account email",
    teamPlaceholder: "Select team…",
    action: "Link account",
    needEmail: "Enter the account email.",
    needTeam: "Pick an open franchise.",
    emptySeats: "Every franchise already has an account.",
    failed: "Link failed",
  }),
});

export function adminLinkSuccess({ email, team } = {}) {
  const who = String(email || "").trim() || "that account";
  const franchise = String(team || "").trim() || "the team";
  return `Linked ${who} to ${franchise}. They will see that team in Fantasy.`;
}

export function adminLinkAccountRef(value) {
  const raw = String(value || "").trim();
  if (!raw) return {};
  if (raw.startsWith("ss:") || raw.startsWith("bot:")) {
    return { user_sub: raw };
  }
  return { email: raw };
}

export function openAdminFranchises(teams) {
  return (teams || []).filter((t) => t && !t.user_sub && !t.is_bot);
}

export function adminVerifySuccess({ email, verified } = {}) {
  const who = String(email || "").trim() || "that account";
  return verified
    ? `${who} is verified. They can open Fantasy now.`
    : `${who} is no longer verified. Fantasy stays closed to them until they verify again.`;
}

export function adminTempPasswordSuccess({ email, notified } = {}) {
  const who = String(email || "").trim() || "that account";
  const note = notified
    ? "They were emailed that an admin reset it."
    : "No email went out — pass it on yourself.";
  return `Temporary password set for ${who}. Signed out everywhere; they must choose a new one at next sign-in. ${note}`;
}
