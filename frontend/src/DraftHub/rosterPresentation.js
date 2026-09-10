/** User-facing copy for Fantasy → My team. */

import { dealCanTakeExtension } from "./rosterFormat.js";

export const MY_TEAM_COPY = {
  title: "My team",
  purpose: "View your players, manage contracts, and check your cap room.",
  learnMoreReadonlyLeague:
    "Commissioners edit salaries, years, and contract types in Roster management → Contracts. You can cut your players here or queue an eligible extension before the draft.",
  cutLabel: "Cut",
  undoCut: "Undo cut",
  undoCutClosed: "Undo cut is closed",
  undoCutClosedSupport: (owner) => (
    owner
      ? `They're on ${owner}'s roster.`
      : "They're on another roster."
  ),
  undoCutClosedDetail: (owner) => (
    owner
      ? `Undo cut is closed. They're on ${owner}'s roster.`
      : "Undo cut is closed. They're on another roster."
  ),
  cutConfirmTitle: (name) => `Cut ${name}?`,
  cutConfirm: (freed, dead) => (
    `Frees ${freed} in cap room and leaves ${dead} in dead cap.`
  ),
  cutConfirmLabel: "Cut",
  learnMoreReadonlySolo: "Only the commissioner can edit these contracts.",
  learnMoreEdit:
    "Manage your roster here. Customize team appearance to change your banner and team photo.",
  learnMoreLabel: "Contract rules",
  emptyHeading: "No contracts to manage yet.",
  emptySupport: "Open Draft to prepare your team, or connect Sleeper under Access & imports.",
  emptyAction: "Open Draft",
  emptyActionLink: "Link Sleeper",
  dropLabel: "Remove without penalty",
  removeTitle: "Remove this contract without penalty?",
  removeConfirm: "Removes this player and contract from your team, refunds the full cap charge, and adds no dead cap.",
  removeConfirmLabel: "Remove contract",
  deadCapLegend: "Dead cap is salary that still counts against your cap after you release a player.",
  capForDraft: "For draft",
  capCommitted: (spent, cap) => `${spent} / ${cap} committed`,
  committedLabel: (season) => `${season} committed`,
  deadCapInline: (amount) => `${amount} dead cap`,
  lockerHeading: "Lockers",
  rosterHeading: "Roster",
  showingCount: (shown, total) => `Showing ${shown} of ${total}`,
  statusExtend: "Extension eligible",
  statusExpire: "Expiring",
  reviewExtensions: "Review extensions",
  undoExtension: "Undo extension",
  queuedNote: "The extension activates when the draft is marked complete. You can undo it before then.",
  undoExtensionHint: "This deal expires at the draft unless you queue again.",
  skipToContent: "Skip to content",
};

export function rosterStatusInfo(row, { draftCompleted, ctype, pendingType, pendingExt, rules } = {}) {
  if (row?.roster_status === "cut_before_draft") {
    return { label: "Cut", tone: "cut", key: "cut" };
  }
  if (pendingExt) return { label: "Extension queued", tone: "pending", key: "pending-ext" };
  if (pendingType) return { label: "Pending type", tone: "pending", key: "pending-type" };
  const yrsLeft = Number(row?.contract?.years_remaining ?? row?.contract_years ?? 1);
  if (!draftCompleted && yrsLeft <= 1) {
    return dealCanTakeExtension(ctype, rules)
      ? { label: MY_TEAM_COPY.statusExtend, tone: "extend", key: "extend" }
      : { label: MY_TEAM_COPY.statusExpire, tone: "expire", key: "expire" };
  }
  if (yrsLeft === 1) return { label: "Final year", tone: "expire", key: "final" };
  return { label: "Active", tone: "ok", key: "ok" };
}
