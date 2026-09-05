/** Shared seat labels for idle Draft, Mock, and the live room. */

export function seatOwnership({ teamId, myTeamId } = {}) {
  const id = teamId != null && String(teamId) !== "" ? String(teamId) : "";
  const mineId = myTeamId != null && String(myTeamId) !== "" ? String(myTeamId) : "";
  return {
    mine: Boolean(id && mineId && id === mineId),
    taken: Boolean(id && id !== mineId),
  };
}

export function seatState({ mine = false, taken = false } = {}) {
  if (mine) return "you";
  if (taken) return "taken";
  return "open";
}

export function seatWho({ state, name, variant = "tile", slot } = {}) {
  if (variant === "mark") {
    if (state === "you") return "YOU";
    const n = Number(slot);
    return Number.isFinite(n) && n > 0 ? String(n) : "·";
  }
  if (state === "open") return "Open";
  return String(name || "").trim() || "Open";
}

export function seatAction({ state, variant = "tile" } = {}) {
  if (variant === "mark") return "";
  if (state === "you") return "Yours";
  if (state === "taken") return "Taken";
  return "Take";
}

export function seatModel({
  mine = false,
  taken = false,
  name,
  slot,
  variant = "tile",
} = {}) {
  const state = seatState({ mine, taken });
  return {
    state,
    who: seatWho({ state, name, variant, slot }),
    action: seatAction({ state, variant }),
    slot,
  };
}
