/** User-facing copy for Fantasy → My team. */

export const MY_TEAM_COPY = {
  title: "My team",
  purpose: "Your contracts and leftover cap. Cut or extend the wrong name and you pay for it next season.",
  learnMoreReadonlyLeague:
    "Salary, years, and type are edited in Roster management → Contracts only. Eligible final-year contracts can still queue one extension here.",
  learnMoreReadonlySolo: "Read-only — ask commish to edit.",
  learnMoreEdit:
    "Personal roster decisions live here. Edit look sets a wide banner on this page and a photo that travels with your team.",
  learnMoreLabel: "Contract rules",
  emptyHeading: "Need a roster to manage contracts.",
  emptySupport: "Lock a night on Draft, or link Sleeper on Access & imports.",
  emptyAction: "Lock a night",
  emptyActionLink: "Link Sleeper",
  removeTitle: "Remove this contract?",
  removeConfirm: "Deletes the contract from the league. Does not refund cap.",
  removeConfirmLabel: "Remove",
  deadCapLegend: "Orange is dead cap — already spent on cuts.",
  capForDraft: "For draft",
  capCommitted: (spent, cap) => `${spent} / ${cap} committed`,
  deadCapInline: (amount) => `${amount} dead`,
  lockerHeading: "Lockers",
  rosterHeading: "Roster",
  showingCount: (shown, total) => `Showing ${shown} of ${total}`,
  statusExtend: "Extension eligible",
  statusExpire: "Expiring",
  reviewExtensions: "Review extensions",
  skipToContent: "Skip to content",
};

export function rosterStatusInfo(row, { draftCompleted, ctype, pendingType, pendingExt } = {}) {
  if (row?.roster_status === "cut_before_draft") {
    return { label: "Cut before draft", tone: "cut", key: "cut" };
  }
  if (pendingExt) return { label: "Extension queued", tone: "pending", key: "pending-ext" };
  if (pendingType) return { label: "Pending type", tone: "pending", key: "pending-type" };
  const yrsLeft = Number(row?.contract?.years_remaining ?? row?.contract_years ?? 1);
  if (!draftCompleted && yrsLeft <= 1) {
    return ctype === "rookie"
      ? { label: MY_TEAM_COPY.statusExtend, tone: "extend", key: "extend" }
      : { label: MY_TEAM_COPY.statusExpire, tone: "expire", key: "expire" };
  }
  if (yrsLeft === 1) return { label: "Final year", tone: "expire", key: "final" };
  return { label: "Active", tone: "ok", key: "ok" };
}
