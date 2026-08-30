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
  },
  draftkings: {
    label: "DraftKings Classic",
    description: "QB · 2 RB · 3 WR · TE · FLEX · DST",
    salary_cap: 50000,
  },
  fanduel: {
    label: "FanDuel Classic",
    description: "QB · 2 RB · 3 WR · TE · FLEX · DST",
    salary_cap: 60000,
  },
};

export const FORMAT_PERSONALITY = {
  seasonal: { icon: "S", note: "Best-effort PPR from weekly projections. No salary cap." },
  draftkings: { icon: "DK", note: "Classic 9-spot under a $50k cap." },
  fanduel: { icon: "FD", note: "Classic 9-spot under a $60k cap." },
};

export const SLATE_CATEGORIES = [
  { id: "main", label: "Main", hint: "Full weekend slate" },
  { id: "primetime", label: "Primetime", hint: "TNF, SNF, and MNF" },
  { id: "showdown", label: "Showdown", hint: "Single-game CPT + FLEX" },
  { id: "all", label: "All", hint: "Every posted slate" },
];

export const LINEUP_COUNTS = [1, 2, 3, 5, 10];

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

export function dfsHeroCopy({ isDfs = true, siteLabel = "DraftKings Classic" } = {}) {
  if (isDfs) {
    return {
      eyebrow: "DFS",
      heading: "Spend the cap. Keep the upside.",
      support: `Pick a ${siteLabel} slate, lock the players you want, then let the optimizer fill a valid lineup.`,
    };
  }
  return {
    eyebrow: "Lineups",
    heading: "A startable week, without the spreadsheet.",
    support: "Best-effort PPR from weekly projections. Lock or skip players, then optimize.",
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
  return items;
}

export function slateLoadCopy({
  site,
  formats = DEFAULT_FORMATS,
  importStats = null,
  loadingSalaries = false,
  slateMeta = null,
} = {}) {
  const cfg = formats[site] || DEFAULT_FORMATS[site] || DEFAULT_FORMATS.seasonal;
  const roster = rosterHint(site, formats);
  if (loadingSalaries) return `${cfg.label} — loading live salaries…`;
  if (!importStats) return `${cfg.label} — ${roster}. Pick a slate or import a CSV.`;
  const bits = [`${importStats.matched} matched`];
  if (importStats.dst_added) bits.push(`${importStats.dst_added} DST`);
  if (importStats.pool_without_salary) {
    bits.push(`${importStats.pool_without_salary} without salary`);
  }
  if (slateMeta?.offseason_placeholder) bits.push("offseason/test slate");
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

export function launchCopy({ isDfs = true, hasLineup = false, siteLabel = "DraftKings Classic" } = {}) {
  if (hasLineup) {
    return {
      title: "Here’s the field.",
      body: isDfs
        ? "Salary and projection sit side by side. Swap locks and rebuild if the room changes."
        : "Projected points by slot. Swap locks and rebuild if your week changes.",
    };
  }
  if (isDfs) {
    return {
      title: "Fill the nine.",
      body: `A ${siteLabel} lineup that spends the cap without wasting a slot.`,
    };
  }
  return {
    title: "Set the week.",
    body: "A best-effort PPR lineup from this week’s projections.",
  };
}
