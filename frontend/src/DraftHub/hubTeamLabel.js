/** Live Hub / Sleeper team label. Names change; prefer the linked Sleeper name. */
export function hubTeamLabel(team) {
  if (!team) return "";
  const live = String(team.sleeper_team_name || "").trim();
  const name = String(team.name || team.team_name || "").trim();
  return live || name;
}
