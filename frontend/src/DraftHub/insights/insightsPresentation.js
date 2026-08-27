/**
 * Insights talking-point helpers. Pure functions so Spend/Scoring can lead
 * with discussion starters instead of a spreadsheet.
 */

export const POS_COLORS = {
  QB: "#6366f1",
  RB: "#22c55e",
  WR: "#f59e0b",
  TE: "#ec4899",
  K: "#a855f7",
  DEF: "#64748b",
};

const TONE_PRIORITY = { gold: 0, bad: 1, good: 2 };

export function teamDisplayName(row, ownerMap, yearSpecific) {
  if (row?.display_name) return row.display_name;
  const team = row?.team_name || row?.name || "";
  const owner = row?.owner_name
    || (team && ownerMap ? (ownerMap[team] || ownerMap[team.toLowerCase()]) : null)
    || "";
  if (!team) return owner || "—";
  if (!owner || owner.toLowerCase() === team.toLowerCase()) return team;
  if (yearSpecific) return `${owner} · ${team}`;
  return owner;
}

export function managerLabel(award, ownerMap, yearSpecific) {
  if (award?.display_name) return award.display_name;
  const team = award?.team_name || "";
  const owner = award?.owner_name
    || (team && ownerMap ? (ownerMap[team] || ownerMap[team.toLowerCase()]) : null)
    || "";
  if (!team && owner) return owner;
  if (!owner || owner.toLowerCase() === team.toLowerCase()) return team || owner;
  if (yearSpecific) return `${owner} · ${team}`;
  return owner;
}

export function metricValue(team, pos, mode) {
  if (mode === "pct") return team.pct_by_position?.[pos] ?? 0;
  return team.spend_by_position?.[pos] ?? 0;
}

export function formatSpendValue(value, mode) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  if (mode === "pct") return `${Number(value).toFixed(1)}%`;
  return `$${Math.round(Number(value))}`;
}

/**
 * Mix gold / shame / bargain first so the landing view starts an argument.
 */
export function featureAwards(awards, limit = 4) {
  const list = Array.isArray(awards) ? awards.filter(Boolean) : [];
  if (!list.length) return { featured: [], rest: [] };

  const featured = [];
  const used = new Set();
  for (const tone of ["gold", "bad", "good"]) {
    if (featured.length >= limit) break;
    const hit = list.find((a) => (a.tone || "neutral") === tone && !used.has(a.id));
    if (hit) {
      featured.push(hit);
      used.add(hit.id);
    }
  }
  const leftovers = list
    .filter((a) => !used.has(a.id))
    .sort((a, b) => (TONE_PRIORITY[a.tone] ?? 3) - (TONE_PRIORITY[b.tone] ?? 3));
  for (const award of leftovers) {
    if (featured.length >= limit) break;
    featured.push(award);
    used.add(award.id);
  }
  return {
    featured,
    rest: list.filter((a) => !used.has(a.id)),
  };
}

export function positionSpendLeaders(teams, positions, {
  metric = "dollars",
  ownerMap,
  yearSpecific = false,
} = {}) {
  const rows = Array.isArray(teams) ? teams : [];
  const posList = Array.isArray(positions) ? positions : [];
  return posList.map((pos) => {
    const ranked = rows
      .map((team) => {
        const value = Number(metricValue(team, pos, metric === "pct" ? "pct" : "dollars")) || 0;
        return {
          teamId: team.team_id,
          teamName: team.team_name,
          label: teamDisplayName(team, ownerMap, yearSpecific),
          value,
        };
      })
      .sort((a, b) => b.value - a.value);
    const max = ranked[0]?.value || 0;
    const second = ranked[1]?.value || 0;
    return {
      position: pos,
      ranked: ranked.map((row) => ({
        ...row,
        pctOfLeader: max > 0 ? (row.value / max) * 100 : 0,
      })),
      max,
      gap: max - second,
      leader: ranked[0] || null,
    };
  }).filter((row) => row.max > 0);
}

export function pickDiscussablePosition(leaders, preferred = ["RB", "WR", "QB", "TE"]) {
  const list = Array.isArray(leaders) ? leaders : [];
  if (!list.length) return preferred[0] || "";
  const preferredSet = new Set(preferred);
  let best = list[0];
  let bestScore = -1;
  for (const row of list) {
    const prefBoost = preferredSet.has(row.position) ? 1.15 : 1;
    const score = (Number(row.gap) || 0) * prefBoost;
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best?.position || list[0].position;
}

export function scoringRaceRows(standings, { ownerMap, yearSpecific = false } = {}) {
  const rows = [...(standings || [])].sort(
    (a, b) => (Number(b.total_points) || 0) - (Number(a.total_points) || 0),
  );
  const leader = Number(rows[0]?.total_points) || 0;
  return rows.map((team, idx) => {
    const total = Number(team.total_points) || 0;
    return {
      teamId: team.team_id,
      teamName: team.team_name,
      label: teamDisplayName(team, ownerMap, yearSpecific),
      total,
      avg: team.avg_points,
      weeks: team.weeks_scored,
      rank: idx + 1,
      pctOfLeader: leader > 0 ? (total / leader) * 100 : 0,
      gapFromFirst: Math.round((leader - total) * 10) / 10,
    };
  });
}

export function insightsHeroStatus(featured) {
  const top = featured?.[0];
  if (!top) return "";
  const title = top.title ? String(top.title) : "Award";
  const headline = top.headline ? String(top.headline) : "";
  return headline ? `${title} · ${headline}` : title;
}
