export const CORRECTIONS_COPY = {
  undo: "Undo changes",
  manager: "Manager", week: "Week", bench: "Bench", slot: "Slot", position: "Position",
  emptySlot: "Empty", needsPlayer: "Needs a starter", fill: "Fill", destination: "Add to",
  search: "Search players", searchPlaceholder: "Player name or NFL team", searching: "Finding players…",
  searchHelp: "Choose a saved bench player or search by name. Assign only players who belonged to this team that week.",
  noMatches: "No eligible players found. Try another name or use advanced details.",
  assign: "Assign", assignedElsewhere: "On another historical roster", advanced: "Advanced player details",
  playerName: "Player name", playerId: "Player ID", manual: "Enter player manually", review: "Review your changes",
  noChanges: "No changes yet. Fill an empty slot or move a player to another slot.",
  title: "Corrections",
  support: "Repair a past week's roster and starters. Current rosters and later lineups stay unchanged.",
  missing: "No historical roster recorded. Assign the players who belonged to this team that week.",
  reason: "Reason for correction",
  empty: "I reviewed all teams and acknowledge that unfilled starter slots score zero.",
  add: "Add historical player",
  preview: "Preview correction",
  publish: "Publish corrected results",
  published: "Historical results published. Current rosters and later lineups were not changed.",
  history: "Published corrections",
  loading: "Loading historical records…",
  remove: "Remove historical player",
};

export function correctionTeamRows(context) {
  return (context?.teams || []).map(team => ({
    team_id: team.id,
    players: (context.lineups || []).filter(row => row.team_id === team.id).map(row => ({
      player_id: row.player_id, player_name: row.player_name || "", nfl_team: row.nfl_team || "",
      position: row.position || "QB", slot: row.slot || "BN",
    })),
  }));
}


export function correctionSlots(capacity = {}) {
  return Object.entries(capacity).flatMap(([position, count]) =>
    Array.from({ length: Number(count) || 0 }, (_, index) => ({
      id: `${position}${index + 1}`, label: Number(count) > 1 ? `${position} ${index + 1}` : position,
    })));
}

export function correctionSlotRows(players, slots) {
  return slots.map(slot => ({ ...slot, player: players.find(player => player.slot === slot.id) || null }));
}

export function assignCorrectionPlayer(players, player, slot) {
  // Filling a slot never drops its previous occupant from the historical roster.
  return [...players.filter(item => String(item.player_id).replace(/^sleeper-/, "") !== String(player.player_id).replace(/^sleeper-/, "")).map(item =>
    slot !== "BN" && item.slot === slot ? { ...item, slot: "BN" } : item), { ...player, slot }];
}

export function correctionChanges(before, after) {
  return after.flatMap(team => {
    const previous = before.find(item => item.team_id === team.team_id)?.players || [];
    const ids = new Set([...previous, ...team.players].map(player => player.player_id));
    return [...ids].flatMap(id => {
      const old = previous.find(player => player.player_id === id);
      const next = team.players.find(player => player.player_id === id);
      return JSON.stringify(old) === JSON.stringify(next) ? [] : [{team_id: team.team_id,
        name: next?.player_name || old?.player_name || id, before: old?.slot || "Not on roster", after: next?.slot || "Removed"}];
    });
  });
}
