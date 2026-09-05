/** Which players hang on the My team locker wall, and how we name that set. */

export const LOCKER_WALL_LIMIT = 6;
export const LOCKER_WALL_MAX = 8;

function activeRoster(roster) {
  return (roster || []).filter((row) => String(row.roster_status || "active") === "active");
}

function capHit(row) {
  return Number(row?.salary || 0);
}

export function lockerWallPlayers(roster, lockerPlayerIds, { limit = LOCKER_WALL_LIMIT } = {}) {
  const active = activeRoster(roster);
  const byId = Object.fromEntries(active.map((row) => [row.player_id, row]));
  const curated = (lockerPlayerIds || []).map((id) => byId[id]).filter(Boolean);
  if (curated.length) {
    const players = curated.slice(0, LOCKER_WALL_MAX);
    const cut = (roster || []).length - active.length;
    return {
      players,
      caption: cut > 0
        ? `Your lockers · ${players.length} of ${active.length} active`
        : `Your lockers · ${players.length} of ${active.length}`,
      curated: true,
    };
  }
  const players = [...active]
    .sort((a, b) => capHit(b) - capHit(a) || String(a.player_name || "").localeCompare(String(b.player_name || "")))
    .slice(0, limit);
  return {
    players,
    caption: players.length ? `Top ${players.length} by cap hit` : "No lockers yet",
    curated: false,
  };
}
