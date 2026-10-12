import { normalizeDfsTeam, DFS_WORKFLOW_COPY as C } from "./dfsToolPresentation.js";

// Free-form provider labels such as "1:00 PM ET" are not reliable timestamps.
function strictKickoff(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/** Retained schedules provide evidence, never authoritative platform lock state. */
export function validatePrelockExport(sources, selectedLineups, { now = Date.now() } = {}) {
  if (!Number.isFinite(now) || !Array.isArray(selectedLineups)) throw new Error("Review the entry assignments before checking pre-lock export.");
  const originals = Array.isArray(sources) ? sources : [sources];
  // Composed lineups retain their original rules and also carry the generated
  // alternative's schedule. Unknown original timing cannot erase known kickoff evidence.
  const allSources = originals.flatMap(source => {
    const records = source?.settings?.replacement_manifest?.replacements ?? [];
    if (!Array.isArray(records) || records.length > 150) throw new Error(C.prelockReplacement);
    return [source, ...records.map(record => record.candidate_source)];
  });
  const schedules = allSources.flatMap(source =>
    Array.isArray(source?.settings?.game_schedule) ? source.settings.game_schedule : []);
  const kickoffs = new Map();
  for (const game of schedules) {
    const kickoff = strictKickoff(game?.kickoff_et);
    if (kickoff === null) continue;
    for (const team of [game.home, game.away].map(normalizeDfsTeam).filter(Boolean)) {
      if (!kickoffs.has(team)) kickoffs.set(team, []);
      kickoffs.get(team).push(kickoff);
    }
  }
  const known = new Set(), unknown = new Set();
  for (const entry of selectedLineups) {
    if (!Array.isArray(entry?.lineup)) throw new Error("Review the selected lineups before checking pre-lock export.");
    for (const row of entry.lineup) {
      const team = normalizeDfsTeam(row.team), times = kickoffs.get(team) || [];
      if (times.some(kickoff => kickoff <= now))
        throw new Error("This entry update is pre-lock only. A selected player's scheduled game has started; late swap is not supported here.");
      const id = row.player_id || `${team}|${row.dfs_id ?? row.player ?? ""}`;
      (times.length ? known : unknown).add(id);
    }
  }
  return { status: unknown.size ? "unknown" : "known_not_started", knownPlayerCount: known.size, unknownPlayerCount: unknown.size };
}
