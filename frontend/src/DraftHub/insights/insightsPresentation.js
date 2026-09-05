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

function ownerFromMap(team, ownerMap) {
  if (!team || !ownerMap) return "";
  const raw = String(team);
  const trimmed = raw.trim();
  return ownerMap[trimmed]
    || ownerMap[trimmed.toLowerCase()]
    || ownerMap[raw]
    || ownerMap[raw.toLowerCase()]
    || "";
}

export function teamDisplayName(row, ownerMap, yearSpecific) {
  if (row?.display_name) return row.display_name;
  const team = String(row?.team_name || row?.name || "").trim();
  const owner = String(row?.owner_name || ownerFromMap(team, ownerMap) || "").trim();
  if (!team) return owner || "—";
  if (!owner || owner.toLowerCase() === team.toLowerCase()) return team;
  if (yearSpecific) return `${owner} · ${team}`;
  return owner;
}

export function managerLabel(award, ownerMap, yearSpecific) {
  if (award?.display_name) return award.display_name;
  const team = String(award?.team_name || "").trim();
  const owner = String(award?.owner_name || ownerFromMap(team, ownerMap) || "").trim();
  if (!team && owner) return owner;
  if (!owner || owner.toLowerCase() === team.toLowerCase()) return team || owner;
  if (yearSpecific) return `${owner} · ${team}`;
  return owner;
}

/** True when the rank label is the owner and the team nickname can sit underneath. */
export function rankShowsTeam(row) {
  const label = String(row?.label || "").trim();
  const team = String(row?.teamName || row?.team_name || "").trim();
  if (!label || !team) return false;
  if (label.toLowerCase() === team.toLowerCase()) return false;
  return !label.toLowerCase().includes(team.toLowerCase());
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

/**
 * Share of a rank-bar track when values sit in a tight band.
 * Zero is the wrong baseline for career totals. Last place still gets a sliver.
 */
export function fieldRankShare(value, values, { pad = 0.12, sliver = 6 } = {}) {
  const nums = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite);
  const n = Number(value);
  if (!Number.isFinite(n) || !nums.length) return 0;
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  if (max <= min) return 100;
  const floor = Math.max(0, min - (max - min) * pad);
  if (max <= floor) return 100;
  const pct = ((n - floor) / (max - floor)) * 100;
  return Math.max(sliver, Math.min(100, pct));
}

export function gapFromLeader(value, leader, digits = 1) {
  const v = Number(value);
  const top = Number(leader);
  if (!Number.isFinite(v) || !Number.isFinite(top)) return null;
  return Math.round((top - v) * (10 ** digits)) / (10 ** digits);
}

export function formatPoints(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export function formatRecordLine(row) {
  const wins = Number(row?.wins) || 0;
  const losses = Number(row?.losses) || 0;
  const ties = Number(row?.ties) || 0;
  return ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

export function formatScoringRankValue(row) {
  const gap = Number(row?.gapFromFirst);
  if (Number.isFinite(gap) && gap > 0) return `−${formatPoints(gap)}`;
  return formatPoints(row?.total ?? row?.total_points);
}

export function overviewRecordRows(records, ownerMap) {
  const list = (records || []).filter((row) => (Number(row.games) || 0) > 0).slice(0, 8);
  const values = list.map((row) => Number(row.win_pct) || 0);
  return list.map((row, idx) => ({
    ...row,
    rank: idx + 1,
    label: teamDisplayName(row, ownerMap, false),
    teamName: row.team_name,
    fillPct: fieldRankShare(Number(row.win_pct) || 0, values),
  }));
}

export function overviewScoringRows(scorers, ownerMap) {
  const list = (scorers || []).slice(0, 8);
  const values = list.map((row) => Number(row.total_points) || 0);
  const leader = values[0] || 0;
  return list.map((row, idx) => {
    const total = Number(row.total_points) || 0;
    return {
      ...row,
      rank: idx + 1,
      label: teamDisplayName(row, ownerMap, false),
      teamName: row.team_name,
      total,
      fillPct: fieldRankShare(total, values),
      gapFromFirst: gapFromLeader(total, leader),
    };
  });
}

export function mostTitlesLine(mostTitles, ownerMap) {
  if (!mostTitles || !(Number(mostTitles.titles) > 1)) return "";
  const who = teamDisplayName({
    owner_name: mostTitles.owner_name,
    team_name: mostTitles.team_name,
  }, ownerMap, false);
  const n = Number(mostTitles.titles);
  if (!who) return `${n} titles`;
  return `${who} · ${n} titles`;
}

export function scoringRaceRows(standings, { ownerMap, yearSpecific = false } = {}) {
  const rows = [...(standings || [])].sort(
    (a, b) => (Number(b.total_points) || 0) - (Number(a.total_points) || 0),
  );
  const totals = rows.map((team) => Number(team.total_points) || 0);
  const leader = totals[0] || 0;
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
      fillPct: fieldRankShare(total, totals),
      pctOfLeader: leader > 0 ? (total / leader) * 100 : 0,
      gapFromFirst: gapFromLeader(total, leader),
    };
  });
}

export const DEFAULT_AWARD_CATALOG = [
  { id: "highest_paid", group: "spend", default_title: "Highest salary" },
  { id: "most_overpaid", group: "spend", default_title: "Most over market" },
  { id: "worst_contract", group: "spend", default_title: "Highest multiple" },
  { id: "best_bargain", group: "spend", default_title: "Best discount" },
  { id: "waiver_king", group: "spend", default_title: "Most $1 seasons" },
  { id: "cap_hog", group: "spend", default_title: "Largest cap share" },
  { id: "payroll_king", group: "spend", default_title: "Highest committed" },
  { id: "dead_cap_disaster", group: "spend", default_title: "Most dead cap" },
  { id: "nomad", group: "spend", default_title: "Most teams" },
  { id: "loyalty", group: "spend", default_title: "Longest tenure" },
  { id: "career_earnings", group: "spend", default_title: "Career earnings" },
  { id: "biggest_raise", group: "spend", default_title: "Biggest raise" },
  { id: "cap_crunch", group: "spend", default_title: "Least cap remaining" },
  { id: "points_king", group: "scoring", default_title: "Most points" },
  { id: "basement", group: "scoring", default_title: "Fewest points" },
  { id: "weekly_nuke", group: "scoring", default_title: "Highest week" },
  { id: "weekly_disaster", group: "scoring", default_title: "Lowest week" },
  { id: "margin_massacre", group: "scoring", default_title: "Largest weekly margin" },
  { id: "nail_biter", group: "scoring", default_title: "Closest weekly finish" },
  { id: "always_runner_up", group: "scoring", default_title: "Most runner-up weeks" },
  { id: "steady_eddie", group: "scoring", default_title: "Most consistent" },
  { id: "rollercoaster", group: "scoring", default_title: "Least consistent" },
  { id: "floor_collapse", group: "scoring", default_title: "Biggest weekly swing" },
  { id: "participation_trophy", group: "scoring", default_title: "Closest to average" },
  { id: "wire_to_wire", group: "scoring", default_title: "Most weekly highs" },
  { id: "cap_efficiency_goat", group: "scoring", default_title: "Best points per dollar" },
  { id: "cap_efficiency_fraud", group: "scoring", default_title: "Worst points per dollar" },
];

export function awardCatalogFromRules(rules, catalog = DEFAULT_AWARD_CATALOG) {
  const titles = rules?.insight_award_titles && typeof rules.insight_award_titles === "object"
    ? rules.insight_award_titles
    : {};
  return (catalog || []).map((row) => {
    const custom = String(titles[row.id] || "").trim();
    return {
      ...row,
      title: custom || row.default_title,
    };
  });
}

export const INSIGHTS_COPY = {
  overview: {
    eyebrow: "Insights",
    heading: "Who already won this room.",
    support: "Titles, records, and career points. Ignore the gap and you bid like every seat is even.",
    supportWithSeasons: (countLabel) => (
      `Titles, records, and career points across ${countLabel}. Ignore the gap and you bid like every seat is even.`
    ),
    titles: "Titles",
    titlesEmpty: "Champions appear once a season’s bracket is complete.",
    titlesSupport: "Championships from the Sleeper bracket.",
    titlesNone: "No completed championships in the Sleeper history yet.",
    records: "All-time records",
    recordsSupport: "Regular-season wins across every scored year.",
    recordsEmpty: "Win-loss records fill in after scoring history refreshes.",
    scoring: "All-time scoring",
    scoringSupport: "Gap from first in career fantasy points.",
    scoringEmpty: "No scoring history yet.",
    openScoring: "Open scoring",
    empty: "Link a Sleeper league to see champions, records, and scoring leaders.",
    loading: "Loading league history",
  },
  awards: {
    heading: "Award names",
    support: "Rename the labels everyone sees on Insights.",
    restore: "Blank a field and save to restore the original name.",
    save: "Save names",
    saving: "Saving…",
    saved: "Award names saved.",
    failed: "Could not save award names.",
    spend: "Spend",
    scoring: "Scoring",
  },
  spend: {
    eyebrow: "Insights",
    heading: "Who burned the cap.",
    support: "Positional spend and who is out of room. Overspend at RB and you draft thin everywhere else.",
    empty: "Spend appears after the draft writes contracts. $0 committed means nobody has a deal yet.",
  },
  scoring: {
    eyebrow: "Scoring",
    heading: "Find the team that scores but loses.",
    support: "That manager sells high scorers cheap. The standings hide it.",
  },
  history: {
    eyebrow: "History",
    heading: "Follow one player across owners.",
    support: "Contracts and the timeline. Use it when a trade or keeper fight needs the paper trail.",
  },
};

export function insightsHeroStatus(featured, { ownerName, teamName } = {}) {
  const top = featured?.[0];
  if (!top) return "";
  const title = top.title ? String(top.title) : "Award";
  const headline = top.headline ? String(top.headline) : "";
  const owner = String(ownerName || top.owner_name || "").trim();
  const club = String(teamName || top.team_name || headline).trim();
  const titles = top.title_count != null ? `${top.title_count} titles` : "";
  if (owner && club && titles) return `${owner} · ${club} · ${titles}`;
  if (owner && headline) return `${owner} · ${headline}`;
  return headline ? `${title} · ${headline}` : title;
}
