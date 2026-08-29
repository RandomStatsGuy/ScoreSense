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

export function lobbyChipLabel({ claimed = 0, teamCount = 12, live = false } = {}) {
  const target = Math.max(1, Number(teamCount) || 12);
  const seated = Math.max(0, Number(claimed) || 0);
  if (live) return "Drafting";
  if (seated >= target) return "Room full";
  return `${seated} of ${target} seated`;
}
