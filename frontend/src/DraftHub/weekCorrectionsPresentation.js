export const CORRECTIONS_COPY = {
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
