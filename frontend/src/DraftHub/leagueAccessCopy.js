/** User-facing copy for creating leagues and inviting managers. */

export const CREATE_LEAGUE_VALUE = "__create__";
export const SOLO_VALUE = "__solo__";

/** Create/join is a real button. Never put this value in a native <select>. */
export const LEAGUE_CREATE_COPY = {
  newLeague: "New league",
  createOrJoin: "Create or join a league",
  title: "Create or join a league",
  lead: "Start a room or join with a code. You can switch back anytime.",
  close: "Close",
};

export function interpretLeagueSwitcherValue(next, current) {
  if (next === CREATE_LEAGUE_VALUE) return { action: "create" };
  if (!next || next === current) return { action: "noop" };
  if (next === SOLO_VALUE) return { action: "solo" };
  return { action: "switch", leagueId: next };
}

export function draftInviteLabel({ testMode = false } = {}) {
  return testMode ? "Practice draft link" : "Member draft link";
}

export function draftInviteExplainer({ testMode = false } = {}) {
  if (testMode) {
    return "Friends open this link, type a name, and sit in the practice room. No ScoreSense account needed. Your real league is unchanged.";
  }
  return "This link is for people already on this league. They sign in and walk into the draft room. It does not let strangers take a seat.";
}

export function draftInviteWhatHappens({ testMode = false } = {}) {
  if (testMode) {
    return "They land on a join page, enter a display name, and sit down. No team setup or account is required.";
  }
  return "Members land in the lobby with the account that already has their team. Add managers first with a room code or email invite.";
}

export function draftLobbyHeroHeading({ testMode = false } = {}) {
  return testMode ? "Practice here. Keepers stay put." : "Lock a night, then start the draft.";
}

export function draftLobbyHeroSupport({ testMode = false } = {}) {
  if (testMode) {
    return "Send the practice link. Friends sit down with a name — no ScoreSense account. This room does not write real contracts.";
  }
  return "Mark nights that work. The commissioner locks the overlap. Miss the night and you draft late or not at all.";
}

export const DRAFT_ENTRY_COPY = {
  eyebrow: "Draft",
  heading: "Open your league's draft room.",
  support: "Live draft writes keepers and contracts. A mock in Tools does not.",
  liveTitle: "Open a live lobby",
  liveSupport: "Live draft is for your real room. Keepers and contracts apply.",
};

export function draftInviteRailHint({ testMode = false } = {}) {
  return testMode
    ? "Share this link with anyone joining the practice room."
    : "Share this link with managers who already belong to the league.";
}

export function draftLobbyRailHeading({ isCommissioner = false, testMode = false } = {}) {
  if (!isCommissioner) return "Waiting on the commissioner";
  return testMode ? "Ready to practice?" : "Ready to start?";
}

export function draftLobbyReadiness({
  claimed = 0,
  teamCount = 0,
  scheduled = false,
  testMode = false,
} = {}) {
  const seated = Math.max(0, Number(claimed) || 0);
  const total = Math.max(0, Number(teamCount) || 0);
  const roomFull = total > 0 && seated >= total;

  return [
    {
      id: "seats",
      tone: roomFull ? "ready" : "attention",
      label: roomFull
        ? "Every seat is claimed"
        : `${seated} of ${total} ${testMode ? "people" : "managers"} seated`,
    },
    {
      id: "schedule",
      tone: scheduled ? "ready" : "neutral",
      label: scheduled ? "Draft night locked" : "Starts when the commissioner launches it",
    },
    {
      id: "access",
      tone: "ready",
      label: testMode ? "Practice link ready to share" : "Member link ready to share",
    },
  ];
}

export function draftJoinSupport({
  canJoin = true,
  leagueName = "",
  testMode = false,
  membersOnly = false,
} = {}) {
  const league = leagueName || "this league";
  if (membersOnly) {
    return `${league}'s live draft is for league members only. Sign in with the account that already has a team.`;
  }
  if (!canJoin) return "This draft is already underway.";
  if (testMode) {
    return `Enter a name to sit in ${league}'s practice draft. No account needed.`;
  }
  return `You are joining ${league} — the same league as the commissioner, not a one-night side room. Enter a team name to take a seat.`;
}

export function draftJoinAccountNote({ authenticated = false, membersOnly = false } = {}) {
  if (membersOnly) {
    return authenticated
      ? "If this account is on the league, you can enter the room. If not, ask your commissioner for an invite."
      : "Sign in to enter. Guests cannot join a live draft.";
  }
  if (authenticated) {
    return "You are signed in. This seat becomes your team in the league after the draft.";
  }
  return "No account needed for this practice draft. Guests stay in the room.";
}

export function shareableAppUrl(url, origin) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  const host = String(
    origin
    || (typeof window !== "undefined" && window.location?.origin)
    || "",
  ).replace(/\/$/, "");
  try {
    const parsed = new URL(raw, host || "http://localhost");
    if (!host) return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return `${host}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return raw;
  }
}

export function managerClaimLabel() {
  return "Invite link";
}

export function managerClaimExplainer() {
  return "Text this link to the group. They make a ScoreSense account, pick their team, then mark nights that work.";
}

export function managerClaimWhatHappens() {
  return "Anyone with the link signs in and claims an open team. After they claim, Draft asks them to mark nights that work. Assign a specific email only when you need to lock a seat to one person.";
}

export function managerClaimCopied() {
  return "Copied — paste it in the text thread.";
}

export function managerClaimTextBody({ leagueName, url } = {}) {
  const league = String(leagueName || "").trim() || "the league";
  const link = String(url || "").trim();
  const lines = [
    `You're in ${league} on ScoreSense.`,
    "Open this, claim your team, then mark nights that work.",
  ];
  if (link) lines.push("", link);
  return lines.join("\n");
}

export function managerClaimCopyTextLabel({ copied = false } = {}) {
  return copied ? "Text copied" : "Copy text";
}

export function managerClaimTextCopied() {
  return "Copied the message — paste it in the group text.";
}

export function managerClaimRotateHint() {
  return "Rotating the link retires the old one. People who already claimed stay in the league.";
}

export function memberInviteExplainer() {
  return "The invite link on Draft is the simple path: text it, they claim a team and mark nights that work. Email invite still assigns a named seat to one address when you need that lock.";
}

export function emailManagersHint() {
  return "Emails people already on this league (claimed accounts or pending email invites) so they can open the member-only draft room.";
}

export function liveDraftMembersOnlyMessage() {
  return "This live draft is for league members. Ask your commissioner for a league invite or room code first.";
}

export function franchiseResizeHint() {
  return "Add an empty seat with a full cap before the next auction. Existing contracts stay put. Invite the manager after the seat exists.";
}

export function addFranchiseLabel() {
  return "Add franchise";
}

export function addFranchiseSupport({ nextCount, cap } = {}) {
  const seats = Number(nextCount);
  const salary = Number(cap);
  const seatBit = Number.isFinite(seats) && seats > 0 ? `League becomes ${seats} teams.` : "Adds one seat.";
  const capBit = Number.isFinite(salary) && salary > 0
    ? ` The new club starts at $${salary} with no keepers.`
    : " The new club starts with a full cap and no keepers.";
  return `${seatBit}${capBit}`;
}

export function removeFranchiseLabel() {
  return "Remove franchise";
}

export function removeFranchiseConfirm(name) {
  const label = String(name || "").trim() || "this franchise";
  return `Remove ${label}? The seat closes. Contracts must already be gone.`;
}

export function removeFranchiseBlocked(reason) {
  return String(reason || "This franchise stays.");
}

export function franchiseSeatSummary({ configured, actual } = {}) {
  const seats = Number(configured);
  const clubs = Number(actual);
  if (!Number.isFinite(clubs) || clubs < 0) return "Franchises";
  if (Number.isFinite(seats) && seats > 0 && seats !== clubs) {
    return `${clubs} franchises · ${seats} seats`;
  }
  return `${clubs} franchise${clubs === 1 ? "" : "s"}`;
}

export function draftNightHeading() {
  return "Draft night";
}

export function draftNightSupport({ scheduled = false, compact = false } = {}) {
  if (compact) {
    return scheduled
      ? "Only if the locked night has to move off the calendar."
      : "Only if the overlap is wrong.";
  }
  return scheduled
    ? "This night is locked. The room can auto-start then. Unlock only if it has to move."
    : "Lock a night from the overlaps, or set one here. The room can auto-start then.";
}

export function draftNightEmpty() {
  return "Not locked yet";
}

export function draftNightLockAction({ scheduled = false, busy = false } = {}) {
  if (busy) return "Locking…";
  return scheduled ? "Update locked night" : "Lock this night";
}

export function draftNightUnlockAction() {
  return "Unlock";
}

export function draftNightChangeSummary() {
  return "Change the locked night";
}

export function draftNightLockedChip() {
  return "Locked";
}
