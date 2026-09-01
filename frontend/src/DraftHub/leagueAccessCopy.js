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
  return "Live draft night is for league members. Invite managers to the league first, then share this room link so they can sit down.";
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

export function memberInviteExplainer() {
  return "Email invite assigns a named team and full league access (Home, roster, trades). The recipient signs in or creates an account with that exact email. The draft lobby link is only for members who already have a team — it does not let anyone walk in.";
}

export function emailManagersHint() {
  return "Emails people already on this league (claimed accounts or pending email invites) so they can open the member-only draft room.";
}

export function liveDraftMembersOnlyMessage() {
  return "This live draft is for league members. Ask your commissioner for a league invite or room code first.";
}
