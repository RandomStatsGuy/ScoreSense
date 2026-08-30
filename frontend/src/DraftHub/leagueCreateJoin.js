export const FALLBACK_LEAGUE_PRESETS = [
  { id: "salary_cap_auction_v1", label: "Salary cap auction" },
  { id: "snake_draft_v1", label: "Snake draft" },
  { id: "linear_draft_v1", label: "Linear draft" },
];

export function leaguePresetOptions(presets) {
  return Array.isArray(presets) && presets.length > 0 ? presets : FALLBACK_LEAGUE_PRESETS;
}

export function parseLeagueTeamCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 2 || count > 20) {
    return { ok: false, error: "Team count must be between 2 and 20." };
  }
  return { ok: true, count };
}
