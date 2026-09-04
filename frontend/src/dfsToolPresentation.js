/** Shared DFS / lineup-builder presentation (Tools → DFS). */

export const OBJECTIVES = [
  { id: "median", label: "Proj (P50)", shortLabel: "Proj", hint: "Maximize expected points" },
  { id: "floor", label: "Floor (P10)", shortLabel: "Floor", hint: "Safer lineup for close matchups" },
  { id: "ceiling", label: "Ceiling (P90)", shortLabel: "Ceiling", hint: "Upside-chasing lineup" },
  { id: "value", label: "Value (pts/$1k)", shortLabel: "Value", hint: "Maximize points per salary dollar", dfsOnly: true },
];

export const DEFAULT_FORMATS = {
  seasonal: {
    label: "Season-long PPR",
    description: "1 QB · 2 RB · 2 WR · 1 TE · 1 FLEX",
    salary_cap: null,
    base_site: null,
  },
  draftkings: {
    label: "DraftKings Classic",
    description: "QB · 2 RB · 3 WR · TE · FLEX · DST",
    salary_cap: 50000,
    base_site: "draftkings",
  },
  fanduel: {
    label: "FanDuel Classic",
    description: "QB · 2 RB · 3 WR · TE · FLEX · DST",
    salary_cap: 60000,
    base_site: "fanduel",
  },
  draftkings_showdown: {
    label: "DraftKings Showdown",
    description: "CPT (1.5× pts, 1.5× salary) + 5 FLEX",
    salary_cap: 50000,
    base_site: "draftkings",
    slate_category: "showdown",
    captain_label: "CPT",
  },
  fanduel_single: {
    label: "FanDuel Single game",
    description: "MVP (1.5× pts, 1.5× salary) + 5 FLEX",
    salary_cap: 60000,
    base_site: "fanduel",
    slate_category: "showdown",
    captain_label: "MVP",
  },
};

export const FORMAT_PERSONALITY = {
  seasonal: { icon: "S", note: "Best-effort PPR from weekly projections. No salary cap." },
  draftkings: { icon: "DK", note: "Classic 9-spot under a $50k cap." },
  fanduel: { icon: "FD", note: "Classic 9-spot under a $60k cap." },
  draftkings_showdown: { icon: "SD", note: "One game. The CPT slot pays 1.5× at 1.5× salary." },
  fanduel_single: { icon: "SG", note: "One game. The MVP slot pays 1.5× at 1.5× salary." },
};

export const SLATE_CATEGORIES = [
  { id: "main", label: "Main", hint: "Full weekend slate" },
  { id: "primetime", label: "Primetime", hint: "TNF, SNF, and MNF" },
  { id: "showdown", label: "Showdown", hint: "Single-game CPT + FLEX" },
  { id: "all", label: "All", hint: "Every posted slate" },
];

export const LINEUP_COUNTS = [1, 3, 5, 10, 20, 50, 150];

export const STACK_OPTIONS = [
  { id: 0, label: "Off", hint: "No stacking rule" },
  { id: 1, label: "QB +1", hint: "One same-team pass catcher with each QB" },
  { id: 2, label: "QB +2", hint: "Two same-team pass catchers with each QB" },
];

export const RANDOMNESS_OPTIONS = [
  { id: 0, label: "Off", hint: "Pure projections every build" },
  { id: 0.05, label: "Subtle", hint: "Small jitter for near-optimal variety" },
  { id: 0.12, label: "Medium", hint: "Tournament-style variety" },
  { id: 0.25, label: "Wild", hint: "Big swings for large entry counts" },
];

export const EXPOSURE_OPTIONS = [
  { id: 0, label: "No cap" },
  { id: 0.6, label: "60%" },
  { id: 0.5, label: "50%" },
  { id: 0.4, label: "40%" },
  { id: 0.3, label: "30%" },
  { id: 0.2, label: "20%" },
];

export const TEAM_LIMIT_OPTIONS = [
  { id: 0, label: "No limit" },
  { id: 4, label: "4 per team" },
  { id: 3, label: "3 per team" },
  { id: 2, label: "2 per team" },
];

/** Minimum-spend presets expressed as "salary left on the table". */
export const MIN_SPEND_OPTIONS = [
  { id: 0, label: "Any spend" },
  { id: 1000, label: "≤ $1,000 left" },
  { id: 500, label: "≤ $500 left" },
  { id: 200, label: "≤ $200 left" },
];

export function isCaptainFormat(siteId, formats = DEFAULT_FORMATS) {
  const cfg = formats[siteId] || DEFAULT_FORMATS[siteId];
  if (cfg?.captain_label) return true;
  return Boolean(cfg?.roster?.cpt);
}

export function captainLabel(siteId, formats = DEFAULT_FORMATS) {
  const cfg = formats[siteId] || DEFAULT_FORMATS[siteId] || {};
  return cfg.captain_label || "CPT";
}

export function defaultSlateCategory(siteId, formats = DEFAULT_FORMATS) {
  const cfg = formats[siteId] || DEFAULT_FORMATS[siteId] || {};
  return cfg.slate_category || "all";
}

export function slateProviderSite(siteId, formats = DEFAULT_FORMATS) {
  const cfg = formats[siteId] || DEFAULT_FORMATS[siteId] || {};
  return cfg.base_site || null;
}

export function formatSalary(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `$${Number(value).toLocaleString()}`;
}

export function rosterHint(site, formats = DEFAULT_FORMATS) {
  const cfg = formats[site] || DEFAULT_FORMATS[site] || DEFAULT_FORMATS.seasonal;
  return cfg.description || "";
}

export function formatPersonality(siteId, formats = DEFAULT_FORMATS) {
  const preset = FORMAT_PERSONALITY[siteId];
  const cfg = formats[siteId] || DEFAULT_FORMATS[siteId] || {};
  return {
    icon: preset?.icon || String(siteId || "?").slice(0, 2).toUpperCase(),
    note: preset?.note || cfg.description || "Build a valid lineup for this format.",
    label: cfg.label || siteId,
  };
}

export function filterObjectives(isDfs) {
  return OBJECTIVES.filter((objective) => !objective.dfsOnly || isDfs);
}

export function objectiveLabel(objectiveId, isDfs = true) {
  const match = filterObjectives(isDfs).find((objective) => objective.id === objectiveId);
  return match?.label || "Proj (P50)";
}

export const DFS_STEP_COPY = {
  formatTitle: "Choose the format",
  formatSupport: "Cap, captain, or season-long. Pick the one you are entering.",
};

export function dfsHeroCopy({ isDfs = true, siteLabel = "DraftKings Classic" } = {}) {
  if (isDfs) {
    return {
      eyebrow: "DFS",
      heading: "Fill a valid lineup under the cap.",
      support: `Pick a ${siteLabel} slate, lock names you need, then build. Leave salary on the table and you lose to someone who spent it.`,
    };
  }
  return {
    eyebrow: "Lineups",
    heading: "Build this week's PPR lineup.",
    support: "Lock or skip names, then optimize. A wasted flex is points you left in the pool.",
  };
}

export function dfsHeroNote({ isDfs = true } = {}) {
  if (isDfs) {
    return {
      title: "Salaries from the slate.",
      body: "Projections stay ScoreSense. For entertainment and research only.",
    };
  }
  return {
    title: "Projections, not picks.",
    body: "For entertainment and research only. Not gambling or financial advice.",
  };
}

export function dfsStatusChip({
  isDfs = true,
  loadingSalaries = false,
  importStats = null,
  slateMeta = null,
  poolCount = 0,
} = {}) {
  if (loadingSalaries) return { label: "Loading slate", tone: "readonly" };
  if (slateMeta?.offseason_placeholder) return { label: "Offseason slate", tone: "readonly" };
  if (isDfs && importStats?.matched != null) {
    return { label: `${importStats.matched} salaries`, tone: "active" };
  }
  if (poolCount > 0) return { label: `${poolCount} players`, tone: "active" };
  return { label: isDfs ? "Pick a slate" : "Weekly pool", tone: "readonly" };
}

export function parseSalaryCap(salaryCap) {
  if (salaryCap == null || salaryCap === "") return null;
  const value = Number(salaryCap);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function salarySpend({ totalSalary, salaryCap, salaryRemaining } = {}) {
  const cap = parseSalaryCap(salaryCap);
  const spent = Number(totalSalary);
  const used = Number.isFinite(spent) ? spent : 0;
  if (cap == null) {
    return { pct: 0, used, remaining: null, over: false, cap: null };
  }
  const remaining = (
    salaryRemaining != null
    && salaryRemaining !== ""
    && Number.isFinite(Number(salaryRemaining))
  )
    ? Number(salaryRemaining)
    : cap - used;
  const pct = Math.min(100, Math.max(0, (used / cap) * 100));
  return { pct, used, remaining, over: remaining < 0, cap };
}

export function lockedSalaryTotal(pool = [], lockedIds = []) {
  const locked = new Set(Array.from(lockedIds || [], (id) => String(id)));
  return (pool || []).reduce((sum, row) => {
    if (!locked.has(String(row.player_id))) return sum;
    const salary = Number(row.salary);
    return sum + (Number.isFinite(salary) ? salary : 0);
  }, 0);
}

export function capMeterTone({ remaining, cap } = {}) {
  if (!Number.isFinite(remaining) || !Number.isFinite(cap) || cap <= 0) return "neutral";
  if (remaining < 0) return "over";
  if (remaining / cap <= 0.05) return "tight";
  return "healthy";
}

export function dfsSummaryItems({
  siteLabel,
  season,
  week,
  slateName,
  isDfs = true,
  salaryCap,
  lockedCount = 0,
  excludedCount = 0,
  objectiveId = "median",
  lineupCount = 1,
  constructionSummary = "",
} = {}) {
  const items = [
    { id: "format", label: "Format", value: siteLabel || "—" },
    {
      id: "week",
      label: "Week",
      value: season != null && week != null ? `${season} · Wk ${week}` : "—",
    },
  ];
  if (isDfs) {
    items.push({ id: "slate", label: "Slate", value: slateName || "—" });
    items.push({ id: "cap", label: "Salary cap", value: formatSalary(parseSalaryCap(salaryCap)) });
  }
  items.push({ id: "goal", label: "Goal", value: objectiveLabel(objectiveId, isDfs) });
  items.push({ id: "locks", label: "Locked / skipped", value: `${lockedCount} / ${excludedCount}` });
  if (Number(lineupCount) > 1) {
    items.push({ id: "lineups", label: "Lineups", value: String(lineupCount) });
  }
  if (constructionSummary) {
    items.push({ id: "rules", label: "Rules", value: constructionSummary });
  }
  return items;
}

export function constructionSummary({
  stackCount = 0,
  bringBack = false,
  maxPerTeam = 0,
  maxExposure = 0,
  randomness = 0,
  minSpendLeft = 0,
  isDfs = true,
  lineupCount = 1,
} = {}) {
  const bits = [];
  if (stackCount > 0) bits.push(`QB +${stackCount}`);
  if (stackCount > 0 && bringBack) bits.push("bring-back");
  if (maxPerTeam > 0) bits.push(`≤${maxPerTeam}/team`);
  if (Number(lineupCount) > 1 && maxExposure > 0 && maxExposure < 1) {
    bits.push(`≤${Math.round(maxExposure * 100)}% exposure`);
  }
  if (randomness > 0) {
    const match = RANDOMNESS_OPTIONS.find((opt) => opt.id === randomness);
    bits.push(`${(match?.label || `${Math.round(randomness * 100)}%`).toLowerCase()} randomness`);
  }
  if (isDfs && minSpendLeft > 0) bits.push(`≤$${minSpendLeft.toLocaleString()} unspent`);
  return bits.join(" · ");
}

export function formatSlateOption(slate = {}) {
  const name = slate.name || slate.slate_id || "Slate";
  const games = Number(slate.game_count);
  const players = Number(slate.player_count);
  const extras = [];
  if (Number.isFinite(games) && games > 0 && !String(name).includes("game")) {
    extras.push(`${games}g`);
  }
  if (Number.isFinite(players) && players > 0) extras.push(`${players} players`);
  return extras.length ? `${name} (${extras.join(" · ")})` : name;
}

export function slateLoadCopy({
  site,
  formats = DEFAULT_FORMATS,
  importStats = null,
  loadingSalaries = false,
  slateMeta = null,
  slateCount = null,
} = {}) {
  const cfg = formats[site] || DEFAULT_FORMATS[site] || DEFAULT_FORMATS.seasonal;
  const roster = rosterHint(site, formats);
  if (loadingSalaries) return `${cfg.label} — loading live salaries…`;
  const sparse = Number.isFinite(Number(slateCount)) && Number(slateCount) > 0 && Number(slateCount) <= 2;
  if (!importStats) {
    if (sparse) {
      return `${cfg.label} — ${roster}. DraftKings has posted ${slateCount} NFL slate${Number(slateCount) === 1 ? "" : "s"} so far; more weekend slates appear here as they go live.`;
    }
    return `${cfg.label} — ${roster}. Pick a slate or import a CSV.`;
  }
  const bits = [`${importStats.matched} matched`];
  if (importStats.dst_added) bits.push(`${importStats.dst_added} DST`);
  if (importStats.pool_without_salary) {
    bits.push(`${importStats.pool_without_salary} without salary`);
  }
  if (slateMeta?.offseason_placeholder) bits.push("offseason/test slate");
  if (sparse) bits.push(`${slateCount} slate${Number(slateCount) === 1 ? "" : "s"} posted`);
  return `${cfg.label} — ${roster}. Slate loaded: ${bits.join(" · ")}`;
}

export function emptyLineupCopy({ optimizing = false, isDfs = true } = {}) {
  if (optimizing) return "Running optimizer…";
  if (isDfs) return "Lock or skip players, then build a lineup under the cap.";
  return "Lock or skip players, then build a lineup.";
}

export function optimizeButtonLabel({ optimizing = false, lineupCount = 1 } = {}) {
  if (optimizing) return "Optimizing…";
  if (Number(lineupCount) > 1) return `Build ${lineupCount} lineups`;
  return "Build this lineup";
}

export function vegasKickoffLabel(kickoffEt, weekday) {
  if (!kickoffEt) return weekday ? String(weekday).slice(0, 3) : "TBD";
  const date = new Date(kickoffEt);
  if (Number.isNaN(date.getTime())) return weekday ? String(weekday).slice(0, 3) : "TBD";
  const day = date.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" });
  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
  return `${day} ${time}`;
}

/** Number(null) is 0 — treat null/empty as a missing line instead. */
function lineNumber(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function vegasSpreadLabel(game = {}) {
  const spread = lineNumber(game.spread_line);
  if (spread == null) return "No line";
  if (spread === 0) return "Pick 'em";
  const favorite = spread > 0 ? game.home : game.away;
  return `${favorite} -${Math.abs(spread)}`;
}

export function vegasTotalLabel(game = {}) {
  const total = lineNumber(game.total_line);
  if (total == null) return "O/U —";
  return `O/U ${total}`;
}

export function vegasImplied(value) {
  const num = lineNumber(value);
  return num != null ? num.toFixed(1) : "—";
}

/** One-line matchup context for a pool row: "vs NE · 24.0 implied". */
export function teamMatchupHint(teamCtx) {
  if (!teamCtx || !teamCtx.opponent) return "";
  const at = teamCtx.is_home ? "vs" : "@";
  const implied = lineNumber(teamCtx.implied_total);
  const impliedText = implied != null ? ` · ${implied.toFixed(1)} implied` : "";
  return `${at} ${teamCtx.opponent}${impliedText}`;
}

export function highestTotalGameId(games = []) {
  let best = null;
  let bestTotal = null;
  for (const game of games) {
    const total = lineNumber(game.total_line);
    if (total == null) continue;
    if (bestTotal == null || total > bestTotal) {
      best = game;
      bestTotal = total;
    }
  }
  return best ? best.game_id : null;
}

export function exposureListCopy({ lineupCount = 0 } = {}) {
  return {
    title: "Exposure",
    hint: `Share of your ${lineupCount} lineups each player appears in.`,
  };
}

export function launchCopy({ isDfs = true, hasLineup = false, siteLabel = "DraftKings Classic" } = {}) {
  if (hasLineup) {
    return {
      title: "Lineup is built.",
      body: isDfs
        ? "Salary and projection sit together. Swap a lock if the news moved."
        : "Projected points by slot. Swap a lock if your week changed.",
    };
  }
  if (isDfs) {
    return {
      title: "Nine spots, one cap.",
      body: `A ${siteLabel} lineup. Go over the cap and it will not submit.`,
    };
  }
  return {
    title: "Set the lineup.",
    body: "Best-effort PPR from this week's projections.",
  };
}
