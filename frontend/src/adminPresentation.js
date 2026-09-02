/** Copy for Account → Admin. Goal + consequence. Staff-only. */

export const ADMIN_COPY = Object.freeze({
  unlinkSuccess: "Team unlinked from account",
  unlinkFailed: "Unlink failed",
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
