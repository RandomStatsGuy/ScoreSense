/** Owner-first labels. Team nicknames are extra, never the only name when an owner exists. */

function trimName(value) {
  return String(value || "").trim();
}

export function hubTeamParts(team) {
  if (!team) return { owner: "", team: "" };
  const owner = trimName(team.owner_name || team.owner_label);
  const live = trimName(team.sleeper_team_name);
  const name = trimName(team.name || team.team_name);
  const teamName = live || name;
  if (owner && teamName && owner.toLowerCase() === teamName.toLowerCase()) {
    return { owner: "", team: teamName };
  }
  return { owner, team: teamName };
}

export function hubTeamLabel(team, { includeTeam = true } = {}) {
  const { owner, team: teamName } = hubTeamParts(team);
  if (owner && teamName && includeTeam) return `${owner} · ${teamName}`;
  return owner || teamName || "";
}

/** Avatar initials use the manager, never the combined "Owner · Team" label. */
export function hubTeamInitialsName(team) {
  const { owner, team: teamName } = hubTeamParts(team);
  return owner || teamName || "";
}
