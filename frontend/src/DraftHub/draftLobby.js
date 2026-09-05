/** Helpers for the shared mock / live draft lobby. */

export function lobbyPath(roomCode) {
  const code = String(roomCode || "").trim().toUpperCase();
  return code ? `/lobby/${code}` : "/lobby";
}

export function lobbyAbsoluteUrl(roomCode, origin) {
  const path = lobbyPath(roomCode);
  if (origin) return `${String(origin).replace(/\/$/, "")}${path}`;
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${path}`;
  }
  return path;
}

export function slotLabel(draftType) {
  const t = String(draftType || "").toLowerCase();
  if (t === "linear") return "Draft position";
  if (t === "snake") return "Draft position";
  return "Nomination order";
}

export function slotHint(draftType) {
  const t = String(draftType || "").toLowerCase();
  if (t === "snake") return "First pick snakes back to you on even rounds.";
  if (t === "linear") return "Same seat every round.";
  return "Who nominates first. Claim a spot or leave it open.";
}

export function roomHeading() {
  return "The room";
}

export function roomSupport({ guestMode = false, testMode = false } = {}) {
  if (guestMode) return "You are in as a guest. Take a seat or leave it open.";
  if (testMode) return "Take a seat. Open seats draft as bots.";
  return "Take a seat. Open seats draft as bots.";
}

export function altLockSummary({ locked = false } = {}) {
  return locked ? "Move the locked night off the calendar" : "Lock a night that is not on the calendar";
}

export function lobbyChipLabel({ claimed = 0, teamCount = 12, live = false } = {}) {
  const target = Math.max(1, Number(teamCount) || 12);
  const seated = Math.max(0, Number(claimed) || 0);
  if (live) return "Drafting";
  if (seated >= target) return "Room full";
  return `${seated} of ${target} claimed`;
}

export function assignClaimedTeamsToOpenSeats(teams = [], teamCount = 12) {
  const n = Math.max(1, Number(teamCount) || 12);
  const list = Array.isArray(teams) ? teams : [];
  const seats = Array.from({ length: n }, () => null);
  const used = new Set();
  for (const team of list) {
    const slot = Number(team?.draft_slot);
    if (Number.isFinite(slot) && slot >= 1 && slot <= n && !seats[slot - 1]) {
      seats[slot - 1] = team;
      used.add(team);
    }
  }
  const claimedUnslotted = list.filter((team) => team?.user_sub && !used.has(team) && !team.is_bot);
  let next = 0;
  return seats.map((team, index) => {
    if (team) return { slot: index + 1, team };
    if (next < claimedUnslotted.length) {
      const claimed = claimedUnslotted[next];
      next += 1;
      return { slot: index + 1, team: claimed };
    }
    return { slot: index + 1, team: null };
  });
}

export function lobbyChipTone({ claimed = 0, teamCount = 12 } = {}) {
  const target = Math.max(1, Number(teamCount) || 12);
  const seated = Math.max(0, Number(claimed) || 0);
  return seated >= target ? "ready" : "caution";
}

export function startDraftIsPrimary({ scheduled = false, claimed = 0, teamCount = 12 } = {}) {
  const target = Math.max(1, Number(teamCount) || 12);
  const seated = Math.max(0, Number(claimed) || 0);
  return Boolean(scheduled) || seated >= target;
}
