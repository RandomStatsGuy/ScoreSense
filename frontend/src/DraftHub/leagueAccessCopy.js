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
  return testMode ? "Practice draft link" : "League draft link";
}

export function draftInviteExplainer({ testMode = false } = {}) {
  if (testMode) {
    return "Friends open this link, type a name, and sit in the practice room. No ScoreSense account needed. Your real league is unchanged.";
  }
  return "This invites someone into this league's draft — not a separate pickup room. They pick a team name and take a seat. No account is required to draft. If they are signed in or create an account, that seat becomes their team in this league.";
}

export function draftInviteWhatHappens({ testMode = false } = {}) {
  if (testMode) {
    return "They land on a join page, enter a display name, and sit down. No team setup or account is required.";
  }
  return "They land on a join page for this league, enter a team name, and sit in the draft. They do not have to create an account first. Signed-in people keep the team after draft night; guests stay in the draft room only.";
}

export function draftLobbyHeroSupport({ testMode = false } = {}) {
  if (testMode) {
    return "Send the practice link. Friends sit down with a name — no ScoreSense account.";
  }
  return "Share the league draft link. Managers join this league, pick a team name, and wait for the clock. An account is optional for draft night.";
}

export function draftJoinSupport({ canJoin = true, leagueName = "", testMode = false } = {}) {
  if (!canJoin) return "This draft is already underway.";
  const league = leagueName || "this league";
  if (testMode) {
    return `Enter a name to sit in ${league}'s practice draft. No account needed.`;
  }
  return `You are joining ${league} — the same league as the commissioner, not a one-night side room. Enter a team name to take a seat.`;
}

export function draftJoinAccountNote({ authenticated = false } = {}) {
  if (authenticated) {
    return "You are signed in. This seat becomes your team in the league after the draft.";
  }
  return "No account needed for draft night. Guests stay in the draft room. Create a ScoreSense account if you want this team on League Home after the draft.";
}

export function memberInviteExplainer() {
  return "Email invite assigns a named team and full league access (Home, roster, trades). The recipient signs in or creates an account with that exact email. Different from the draft lobby link, which lets anyone walk into this league's draft with just a name.";
}

export function emailManagersHint() {
  return "Emails people already on this league (claimed accounts or pending email invites). Share the league draft link for anyone else.";
}
