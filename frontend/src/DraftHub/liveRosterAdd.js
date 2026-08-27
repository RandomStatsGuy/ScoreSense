/** Helpers for commissioner add-player on Live contracts. */

export function playerIdFromSuggestion(suggestion) {
  const sleeperId = String(suggestion?.sleeper_player_id || "").trim();
  if (sleeperId) return sleeperId;
  return String(suggestion?.player_id || "").trim();
}

export function buildLiveRosterAddBody({
  suggestion,
  salary,
  years,
  contractType,
  teamId,
  force = false,
}) {
  const playerId = playerIdFromSuggestion(suggestion);
  const name = String(suggestion?.player_name || "").trim();
  if (!playerId || !name) return null;
  const sal = Number(salary);
  const yrs = Number(years);
  if (!Number.isFinite(sal) || sal < 0) return null;
  if (!Number.isFinite(yrs) || yrs < 1) return null;
  const body = {
    player_id: playerId,
    player_name: name,
    team: String(suggestion?.team || "").trim(),
    position: String(suggestion?.position || "").trim() || "WR",
    salary: sal,
    contract_years: Math.round(yrs),
    contract_type: String(contractType || "veteran").trim().toLowerCase() || "veteran",
    force: Boolean(force),
    staff_edit: true,
  };
  const tid = String(teamId || "").trim();
  if (tid) body.team_id = tid;
  const sleeperId = String(suggestion?.sleeper_player_id || "").trim();
  if (sleeperId) body.sleeper_player_id = sleeperId;
  return body;
}

export function isRosterReassignConflict(message) {
  const msg = String(message || "");
  return /already on/i.test(msg) && /confirm/i.test(msg);
}
