import { isPickDraft } from "./draftEntryStatus.js";

export const ROSTER_LIMIT_KEYS = ["qb", "rb", "wr", "te", "k", "def"];

export const DEFAULT_RULES = {
  draft_type: "auction",
  salary_cap: 200,
  roster_size_max: 27,
  risk_tolerance: 0,
  auction: {
    min_bid: 1,
    nomination_timer_sec: 60,
    bid_timer_sec: 30,
    bid_extension_sec: 5,
    bot_reaction_delay_sec: 4,
    allow_mid_draft_cuts: true,
  },
  roster: {
    qb: { min: 2, max: 4, starter: 1 },
    rb: { min: 4, max: 8, starter: 2 },
    wr: { min: 4, max: 8, starter: 2 },
    te: { min: 1, max: 3, starter: 1 },
    k: { min: 0, max: 2, starter: 1 },
    def: { min: 0, max: 2, starter: 1 },
  },
  contracts: {
    max_years: 3,
    cut_refund_pct: 0.5,
    extension_step_up: 5,
    rookie_years: 2,
    veteran_years: 2,
    rookie_salary_static: true,
    one_renewal_after_rookie: true,
    allow_veteran_renewal: false,
  },
};

export function mergeLeagueRules(incoming = {}) {
  const roster = {};
  ROSTER_LIMIT_KEYS.forEach((pos) => {
    roster[pos] = {
      ...DEFAULT_RULES.roster[pos],
      ...(incoming.roster?.[pos] || {}),
    };
  });
  if (incoming.roster?.flex || DEFAULT_RULES.roster.flex) {
    roster.flex = {
      ...(DEFAULT_RULES.roster.flex || {}),
      ...(incoming.roster?.flex || {}),
    };
  }
  return {
    ...DEFAULT_RULES,
    ...incoming,
    roster,
    auction: { ...DEFAULT_RULES.auction, ...(incoming.auction || {}) },
    contracts: { ...DEFAULT_RULES.contracts, ...(incoming.contracts || {}) },
  };
}

function numberInRange(value, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max;
}

export function validateLeagueSettings({ name, season, rules }) {
  const merged = mergeLeagueRules(rules);
  const errors = {};
  const maxYears = Number(merged.contracts.max_years);

  if (!String(name || "").trim()) errors.name = "Give the league a name.";
  if (!numberInRange(season, 2020, 2100)) errors.season = "Use a season from 2020–2100.";
  if (!isPickDraft(merged) && !numberInRange(merged.salary_cap, 1, 100000)) {
    errors.salary_cap = "Salary cap must be greater than $0.";
  }
  if (!numberInRange(maxYears, 1, 5)) {
    errors.max_years = "Choose 1–5 years.";
  }
  if (!numberInRange(merged.contracts.rookie_years, 1, maxYears || 5)) {
    errors.rookie_years = "Rookie term cannot exceed the maximum contract length.";
  }
  if (!numberInRange(merged.contracts.veteran_years, 1, maxYears || 5)) {
    errors.veteran_years = "Veteran term cannot exceed the maximum contract length.";
  }
  if (!numberInRange(merged.contracts.extension_step_up, 0, 100000)) {
    errors.extension_step_up = "Annual step-up cannot be negative.";
  }
  if (!numberInRange(merged.contracts.cut_refund_pct, 0, 1)) {
    errors.cut_refund_pct = "Cut refund must be between 0% and 100%.";
  }
  ROSTER_LIMIT_KEYS.forEach((pos) => {
    const min = Number(merged.roster[pos]?.min);
    const max = Number(merged.roster[pos]?.max);
    if (!Number.isFinite(min) || min < 0 || !Number.isFinite(max) || max < min) {
      errors[`roster_${pos}`] = "Minimum must be zero or more and cannot exceed maximum.";
    }
  });
  const minimumRoster = ROSTER_LIMIT_KEYS.reduce(
    (total, pos) => total + Number(merged.roster[pos]?.min || 0),
    0,
  );
  if (!numberInRange(merged.roster_size_max, Math.max(1, minimumRoster), 100)) {
    errors.roster_size_max = `Roster size must be at least ${minimumRoster}, the sum of position minimums.`;
  }
  return errors;
}

export function contractSchedule(baseSalary, years, stepUp, staticSalary = false) {
  const base = Number(baseSalary) || 0;
  const count = Math.max(1, Number(years) || 1);
  const step = staticSalary ? 0 : (Number(stepUp) || 0);
  return Array.from({ length: count }, (_, index) => base + step * index);
}

export function rulesSummary(rules) {
  const merged = mergeLeagueRules(rules);
  const contracts = merged.contracts;
  if (isPickDraft(merged)) {
    const label = merged.draft_type === "linear" ? "Linear draft" : "Snake draft";
    return [
      { id: "format", label: "Format", value: label },
      { id: "roster", label: "Roster cap", value: `${merged.roster_size_max || "Position limits"}` },
      { id: "order", label: "Order", value: merged.draft_type === "linear" ? "Same each round" : "Reverses each round" },
    ];
  }
  return [
    { id: "cap", label: "Salary cap", value: `$${Number(merged.salary_cap || 0).toLocaleString()}` },
    { id: "max", label: "Max extension", value: `${contracts.max_years} year${Number(contracts.max_years) === 1 ? "" : "s"}` },
    {
      id: "rookie",
      label: "Rookie deals",
      value: `${contracts.rookie_years} year${Number(contracts.rookie_years) === 1 ? "" : "s"} · ${contracts.rookie_salary_static ? "Flat" : "Steps up"}`,
    },
    {
      id: "veteran",
      label: "New veteran deals",
      value: `${contracts.veteran_years} year${Number(contracts.veteran_years) === 1 ? "" : "s"}`,
    },
    {
      id: "renewals",
      label: "Extensions",
      value: contracts.allow_veteran_renewal ? "Rookies + veterans" : (contracts.one_renewal_after_rookie ? "Rookies only" : "Disabled"),
    },
    { id: "roster", label: "Roster size", value: `${merged.roster_size_max} players` },
  ];
}
