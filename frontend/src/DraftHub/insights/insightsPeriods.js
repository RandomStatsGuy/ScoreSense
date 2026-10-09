import { normalizeHubPosition } from "../hubPositions.js";
import { scoringTeamKey } from "./insightsPresentation.js";

export function periodYears(years, period = { mode: "all" }) {
  const sorted = [...new Set((years || []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  if (period.mode === "last3") return sorted.filter((y) => y >= sorted.at(-1) - 2);
  if (period.mode === "range") return sorted.filter((y) => y >= period.from && y <= period.through);
  return sorted;
}

export function periodLabel(period) {
  if (period.mode === "last3") return "Last 3 years";
  if (period.mode === "range") return period.from === period.through ? String(period.from) : `${period.from}–${period.through}`;
  return "All time";
}

export function landingForPeriod(landing, period) {
  if (!landing || period.mode === "all" || !landing.season_summaries) return landing;
  const years = periodYears(landing.seasons, period);
  const summaries = landing.season_summaries.filter((s) => years.includes(Number(s.season)));
  const managers = new Map();
  for (const summary of summaries) {
    if (summary.preseason) continue;
    for (const row of summary.standings || []) {
      const key = scoringTeamKey(row);
      // A roster number identifies a seat only within its season, never a career.
      const identity = row.owner_id ? key : `${summary.season}:${key}`;
      const prev = managers.get(identity) || { wins: 0, losses: 0, ties: 0, total_points: 0, weeks_scored: 0, seasons_played: 0 };
      managers.set(identity, { ...row,
        wins: prev.wins + Number(row.wins || 0), losses: prev.losses + Number(row.losses || 0),
        ties: prev.ties + Number(row.ties || 0), total_points: prev.total_points + Number(row.total_points || 0),
        weeks_scored: prev.weeks_scored + Number(row.weeks_scored || 0), seasons_played: prev.seasons_played + 1 });
    }
  }
  const rows = [...managers.values()].map((row) => ({ ...row,
    games: row.wins + row.losses + row.ties,
    win_pct: (row.wins + row.ties / 2) / Math.max(row.wins + row.losses + row.ties, 1),
    avg_points: row.total_points / Math.max(row.weeks_scored, 1) }));
  const champions = (landing.champions || []).filter((row) => years.includes(Number(row.season)));
  const titles = new Map();
  for (const row of champions) {
    const key = row.owner_id || `${row.season}:${row.team_name}`;
    const prev = titles.get(key);
    titles.set(key, { ...(prev || row), titles: (prev?.titles || 0) + 1 });
  }
  return { ...landing, champions, seasons_included: summaries.map((s) => s.season),
    record_leaders: [...rows].sort((a, b) => b.win_pct - a.win_pct || b.wins - a.wins || b.total_points - a.total_points),
    scoring_leaders: [...rows].sort((a, b) => b.total_points - a.total_points),
    most_titles: [...titles.values()].sort((a, b) => b.titles - a.titles)[0] || null,
    available: Boolean(rows.length || champions.length), has_records: rows.some((r) => r.games > 0),
    partial: years.some((y) => !summaries.some((s) => Number(s.season) === y)) };
}

export function contractRanks(rows, years, position = "all") {
  const deals = new Map();
  for (const row of rows || []) {
    if (!years.includes(Number(row.season)) || (position !== "all" && normalizeHubPosition(row.position) !== normalizeHubPosition(position))) continue;
    if (!Number.isFinite(row.points) || !Number.isFinite(row.salary) || row.salary <= 0) continue;
    const prev = deals.get(row.deal_id) || { ...row, points: 0, salary: 0, seasons: [], coverage: [] };
    deals.set(row.deal_id, { ...prev, points: prev.points + row.points, salary: prev.salary + row.salary,
      seasons: [...prev.seasons, Number(row.season)], coverage: [...prev.coverage, { season: row.season, week: row.weeks_saved }] });
  }
  const ranked = [...deals.values()].map((r) => ({ ...r, return: r.points / r.salary }));
  const tie = (a, b) => String(a.deal_id).localeCompare(String(b.deal_id));
  return { best: [...ranked].sort((a, b) => b.return - a.return || tie(a, b)),
    worst: [...ranked].sort((a, b) => a.return - b.return || tie(a, b)), count: ranked.length };
}
