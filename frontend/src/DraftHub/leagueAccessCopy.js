/** User-facing copy for creating leagues and inviting managers. */

export const CREATE_LEAGUE_VALUE = "__create__";
export const SOLO_VALUE = "__solo__";

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

export function draftLobbyHeroSupport({ testMode = false } = {}) {
  if (testMode) {
    return "Send the practice link. Friends sit down with a name — no ScoreSense account.";
  }
  return "Text the invite link so managers can claim a team. Share the room link on draft night.";
}

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
      label: scheduled ? "Draft night scheduled" : "Starts when the commissioner launches it",
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
  return "Text this link to the group. They make a ScoreSense account, then pick their team.";
}

export function managerClaimWhatHappens() {
  return "Anyone with the link signs in and claims an open team. Assign a specific email only when you need to lock a seat to one person.";
}

export function managerClaimCopied() {
  return "Copied — paste it in the text thread.";
}

export function managerClaimRotateHint() {
  return "Rotating the link retires the old one. People who already claimed stay in the league.";
}

export function memberInviteExplainer() {
  return "The invite link on Draft is the simple path: text it, they claim a team. Email invite still assigns a named seat to one address when you need that lock.";
}

export function emailManagersHint() {
  return "Emails people already on this league (claimed accounts or pending email invites) so they can open the member-only draft room.";
}

export function liveDraftMembersOnlyMessage() {
  return "This live draft is for league members. Ask your commissioner for a league invite or room code first.";
}

export function draftNightHeading() {
  return "Draft night";
}

export function draftNightSupport({ scheduled = false } = {}) {
  return scheduled
    ? "Managers already see this time. You can still start earlier from the lobby."
    : "Pick the night after you see the shared calendar. The room can auto-start then.";
}

export function draftNightEmpty() {
  return "Not scheduled yet";
}
