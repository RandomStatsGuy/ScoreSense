/** User-facing copy for Fantasy → My team. */

import { dealCanTakeExtension } from "./rosterFormat.js";

export const MY_TEAM_COPY = {
  title: "My team",
  room: "Room",
  manage: "Manage roster",
  roomLoading: "Opening the team room…",
  roomError: "Could not load this room. Try again.",
  roomEmpty: "Your lockers are ready. Players appear here when your roster is available.",
  lineupEmpty: "No starting lineup is available for this week. Browse your roster below or set your lineup on This Week.",
  shareRoom: "Share room",
  shareDescription: "Anyone with this link can see your team, lineup, scores, nicknames, and room theme. Contract controls stay private.",
  nicknameLabel: "Player nickname",
  nicknameSaved: "Nickname saved.",
  resetNickname: "Use Sleeper nickname",
  projectionMissing: "Projection unavailable",
  roomStates: { pregame: "Pregame", live: "Week in progress", final: "Final", unknown: "Scores" },
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

export function roomNumber(value) {
  return value == null || !Number.isFinite(Number(value)) ? "—" : Number(value).toFixed(1);
}

export function roomDelta(player, state) {
  if (state !== "final" || player?.points == null || player?.projection == null) return null;
  const delta = Number(player.points) - Number(player.projection);
  return Number.isFinite(delta) ? delta : null;
}

export function roomResult(room) {
  if (room?.score == null || room?.opponent?.score == null) return "";
  const delta = Number(room.score) - Number(room.opponent.score);
  if (!Number.isFinite(delta)) return "";
  if (!delta) return room.state === "final" ? "Finished tied" : "Matchup tied";
  const verb = room.state === "final" ? (delta > 0 ? "Won by" : "Lost by") : (delta > 0 ? "Leading by" : "Trailing by");
  return `${verb} ${Math.abs(delta).toFixed(1)}`;
}

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
