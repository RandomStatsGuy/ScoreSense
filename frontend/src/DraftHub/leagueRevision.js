export const LEAGUE_REVISION_POLL_MS = 30_000;

export function leagueRevisionKey(payload) {
  const live = Number(payload?.live_roster_revision) || 0;
  const historic = Number(payload?.historic_snapshot_revision) || 0;
  return `${live}:${historic}`;
}

/** The first read sets the baseline; later reads report whether rosters or contracts changed. */
export function nextLeagueRevision(known, payload) {
  const key = leagueRevisionKey(payload);
  return { known: key, changed: known != null && key !== known };
}
