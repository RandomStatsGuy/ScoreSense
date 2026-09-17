import { isPickDraft } from "./draftEntryStatus.js";
import { normalizeHubPosition } from "./hubPositions.js";

export const RULES_COPY = {
  eyebrow: "League rules",
  heading: "League rules",
  support: "Set scoring, salary, contract, roster, and draft rules for your league.",
  saveFootnote: "Saving these rules does not rewrite existing contract schedules.",
  staffOnly: "Managers can read these rules here. Only commissioners can change them.",
  commissionerManaged: "Commissioner managed",
  glanceSaved: "Currently saved",
  glancePreview: "Preview of your changes",
  save: "Save league rules",
  saving: "Saving…",
  saved: "League rules saved.",
  saveFailed: "Rules could not be saved.",
  fixBeforeSave: "Fix the highlighted rules before saving.",
  noChanges: "No changes to save.",
  lastSaved: (when) => (when ? `Last saved ${when}` : ""),
  leaveTitle: "Leave without saving?",
  leaveUnsaved: "Unsaved rule edits stay on this page only. Leave and managers keep the last saved league.",
  leaveConfirm: "Leave",
  keepEditing: "Keep editing",
  templatesTitle: "Start over from a league template",
  templatesHelp: "Fills this form and keeps your scoring settings. League rules stay unsaved until you press Save.",
  templateConfirmTitle: (label) => `Replace these rules with ${label}?`,
  templateConfirmLead: (label) => (
    `Applying ${label} replaces the current rules on this page. It does not save until you press Save.`
  ),
  templateConfirm: "Replace rules",
  templateUndo: "Undo",
  templateApplied: (label) => `${label} is on the form. Save when this is the league you want.`,
  templateMissing: "Reload the page to use templates.",
  templateFailed: "Template could not be applied.",
  draftBehaviorHint: "Clock and nomination defaults for the live room.",
  rosterMin: "Min",
  rosterMax: "Max",
  rosterPosition: "Position",
  secondsSuffix: "sec",
  liveRosterShort: (minSum, liveCount) => (
    `Position minimums require ${minSum} players. This roster has ${liveCount}.`
  ),
  fixedPointRange: (minSum) => (
    `These limits require exactly ${minSum} players per team.`
  ),
  livePosShort: (labels) => (
    `Your roster does not meet these position minimums (${labels}).`
  ),
  rookieTerm: "Default rookie contract length",
  vetTerm: "Default veteran contract length",
  keepRookieFlat: "Keep rookie deals flat",
  keepRookieFlatHelp: "Year one and two of a rookie deal stay at the signing salary. The step-up starts on an extension.",
  keepVetFlat: "Keep vet deals flat",
  keepVetFlatHelp: "Year one and two of a vet deal stay at the signing salary. The step-up starts on an extension.",
  allowExtensions: "Allow extensions",
  allowExtensionsHelp: "A final-year rookie deal or vet deal may take one extension. An extension cannot be extended again.",
  allowRookieExtensions: "Allow rookie deal extensions",
  allowRookieExtensionsHelp: "A rookie contract can be extended once, in its final year. An extension cannot be extended again.",
  allowVetExtensions: "Allow vet deal extensions",
  allowVetExtensionsHelp: "A veteran contract can be extended once, in its final year. An extension cannot be extended again.",
  previewRookie: "Rookie deal",
  previewVet: "Vet deal",
  previewExtension: "Extension",
  previewFlat: "Flat salary",
  previewStep: "Increases each year",
  cutRefund: "Cut refund",
  cutRefundHelp: "Dead cap is rounded down to the nearest dollar. Cutting $1 is $0 dead; cutting $7 is $3 dead at 50%.",
};

export function rulesCopyForFormat(pickDraft) {
  return pickDraft
    ? {
        support: "Set scoring, roster, and draft rules for your league.",
        saveFootnote: "Saving these rules does not change existing rosters or scored weeks.",
      }
    : { support: RULES_COPY.support, saveFootnote: RULES_COPY.saveFootnote };
}

export const FORMAT_OPTIONS = [
  { id: "auction", label: "Salary cap", hint: "Nominate and bid with contracts." },
  { id: "snake", label: "Snake", hint: "Pick order reverses each round." },
  { id: "linear", label: "Linear", hint: "The same order every round." },
];

export const ROSTER_LIMIT_KEYS = ["qb", "rb", "wr", "te", "k", "def"];

export const SCORING_GROUPS = [
  { label: "Offense", fields: [
    ["passing_yards", "Passing yard", 0.04],
    ["passing_tds", "Passing touchdown", 4],
    ["interceptions", "Interception thrown", -2],
    ["rushing_yards", "Rushing yard", 0.1],
    ["rushing_tds", "Rushing touchdown", 6],
    ["receptions", "Reception", 1],
    ["receiving_yards", "Receiving yard", 0.1],
    ["receiving_tds", "Receiving touchdown", 6],
    ["fumbles_lost", "Fumble lost", -2],
    ["passing_2pt_conversions", "Passing two-point conversion", 2],
    ["rushing_2pt_conversions", "Rushing two-point conversion", 2],
    ["receiving_2pt_conversions", "Receiving two-point conversion", 2],
    ["special_teams_tds", "Player return touchdown", 6],
  ] },
  { label: "Kicker", fields: [
    ["pat_made", "Extra point made", 1],
    ["pat_missed", "Extra point missed", -1],
    ["fg_made_0_19", "Field goal made: 0-19 yards", 3],
    ["fg_made_20_29", "Field goal made: 20-29 yards", 3],
    ["fg_made_30_39", "Field goal made: 30-39 yards", 3],
    ["fg_made_40_49", "Field goal made: 40-49 yards", 4],
    ["fg_made_50_59", "Field goal made: 50-59 yards", 5],
    ["fg_made_60_plus", "Field goal made: 60+ yards", 5],
    ["fg_missed", "Field goal missed", -1],
  ] },
  { label: "Defense / special teams", fields: [
    ["def_sacks", "Sack", 1],
    ["def_interceptions", "Interception", 2],
    ["def_fumble_recoveries", "Fumble recovery", 2],
    ["def_touchdowns", "Defense / special teams touchdown", 6],
    ["def_safeties", "Safety", 2],
    ["def_blocked_kicks", "Blocked kick", 2],
    ["def_2pt_returns", "Two-point return", 2],
    ["def_points_allowed_0", "Points allowed: 0", 10],
    ["def_points_allowed_1_6", "Points allowed: 1-6", 7],
    ["def_points_allowed_7_13", "Points allowed: 7-13", 4],
    ["def_points_allowed_14_20", "Points allowed: 14-20", 1],
    ["def_points_allowed_21_27", "Points allowed: 21-27", 0],
    ["def_points_allowed_28_34", "Points allowed: 28-34", -1],
    ["def_points_allowed_35_plus", "Points allowed: 35+", -4],
  ] },
  { label: "Yardage bonuses", fields: [
    ["bonus_passing_300", "Passing: 300-399 yards", 0],
    ["bonus_passing_400", "Passing: 400+ yards", 0],
    ["bonus_rushing_100", "Rushing: 100-199 yards", 0],
    ["bonus_rushing_200", "Rushing: 200+ yards", 0],
    ["bonus_receiving_100", "Receiving: 100-199 yards", 0],
    ["bonus_receiving_200", "Receiving: 200+ yards", 0],
  ] },
];
export const SCORING_FIELDS = SCORING_GROUPS.flatMap((group) => group.fields);
export const DEFAULT_SCORING = Object.fromEntries(SCORING_FIELDS.map(([key, , value]) => [key, value]));
export const SCORING_COPY = {
  title: "Scoring & lineup host",
  native: "ScoreSense native league",
  sleeper: "Sleeper-linked league",
  nativeHelp: "Set lineups in This Week. Game center updates scores from these saved rules as weekly NFL stats arrive, including while games are still in progress.",
  sleeperHelp: "Sleeper controls scoring rules, starting lineups, live points, and stat corrections. Change them in Sleeper; Game center reads its results. ScoreSense still manages local contracts, cap, and draft tools.",
  supported: "Kicker and defense calculations require their actual statistics; unavailable data blocks scoring. Yardage bonuses use only the highest reached band. Defense points allowed uses one band; a missing value is not a shutout.",
  effect: "Saving scoring rules leaves existing results unchanged. Recalculate a week in Game center to apply the new rules to that week's totals and standings.",
  projections: "Projection and Strategy estimates remain PPR-based and are separate from recorded league scores.",
  points: "Points per stat",
  receptionHelp: "Reception: 0 for standard, 0.5 for half PPR, or 1 for full PPR.",
  invalid: "Enter a finite points value from −100 to 100.",
  openSleeper: "Open league in Sleeper",
};

export const DEFAULT_RULES = {
  scoring: DEFAULT_SCORING,
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
    veteran_salary_static: true,
    one_renewal_after_rookie: true,
    allow_veteran_renewal: true,
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
    scoring: { ...DEFAULT_SCORING, ...(incoming.scoring || {}) },
    auction: { ...DEFAULT_RULES.auction, ...(incoming.auction || {}) },
    contracts: { ...DEFAULT_RULES.contracts, ...(incoming.contracts || {}) },
  };
}

function numberInRange(value, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max;
}

export function rosterMinimumSum(rules) {
  const merged = mergeLeagueRules(rules);
  return ROSTER_LIMIT_KEYS.reduce(
    (total, pos) => total + Number(merged.roster[pos]?.min || 0),
    0,
  );
}

export function validateLeagueSettings({ name, season, rules }) {
  const merged = mergeLeagueRules(rules);
  const errors = {};
  const maxYears = Number(merged.contracts.max_years);
  for (const [key] of SCORING_FIELDS) {
    if (merged.scoring[key] === "" || !numberInRange(merged.scoring[key], -100, 100)) errors[`scoring.${key}`] = SCORING_COPY.invalid;
  }


  if (!String(name || "").trim()) errors.name = "Give the league a name.";
  if (!numberInRange(season, 2020, 2100)) errors.season = "Use a season from 2020–2100.";
  if (!isPickDraft(merged) && !numberInRange(merged.salary_cap, 1, 100000)) {
    errors.salary_cap = "Salary cap must be greater than $0.";
  }
  if (!numberInRange(maxYears, 1, 5)) {
    errors.max_years = "Choose 1–5 years.";
  }
  if (!numberInRange(merged.contracts.rookie_years, 1, maxYears || 5)) {
    errors.rookie_years = "Rookie deal term cannot exceed the maximum contract length.";
  }
  if (!numberInRange(merged.contracts.veteran_years, 1, maxYears || 5)) {
    errors.veteran_years = "Vet deal term cannot exceed the maximum contract length.";
  }
  if (!numberInRange(merged.contracts.extension_step_up, 0, 100000)) {
    errors.extension_step_up = "Annual salary increase cannot be negative.";
  }
  if (!numberInRange(merged.contracts.cut_refund_pct, 0, 1)) {
    errors.cut_refund_pct = "Cut refund must be between 0% and 100%.";
  }
  if (!isPickDraft(merged)) {
    if (!numberInRange(merged.auction.min_bid, 1, 100000)) {
      errors.min_bid = "Minimum bid must be at least $1.";
    }
    if (!numberInRange(merged.auction.nomination_timer_sec, 5, 600)) {
      errors.nomination_timer_sec = "Nomination clock must be 5–600 seconds.";
    }
    if (!numberInRange(merged.auction.bid_timer_sec, 5, 600)) {
      errors.bid_timer_sec = "Bid clock must be 5–600 seconds.";
    }
    if (!numberInRange(merged.auction.bid_extension_sec, 0, 120)) {
      errors.bid_extension_sec = "Late-bid extension must be 0–120 seconds.";
    }
  }
  ROSTER_LIMIT_KEYS.forEach((pos) => {
    const min = Number(merged.roster[pos]?.min);
    const max = Number(merged.roster[pos]?.max);
    if (!Number.isFinite(min) || min < 0 || !Number.isFinite(max) || max < min) {
      errors[`roster_${pos}`] = "Minimum must be zero or more and cannot exceed maximum.";
    }
  });
  const minimumRoster = rosterMinimumSum(merged);
  // Explicit null means "no roster cap — position limits bound the roster"
  // (backend total_roster_slots falls back to the sum of position maxes).
  if (merged.roster_size_max != null
    && !numberInRange(merged.roster_size_max, Math.max(1, minimumRoster), 100)) {
    errors.roster_size_max = `Roster size must be at least ${minimumRoster}, the sum of position minimums.`;
  }
  return errors;
}

export function isActiveRosterRow(row) {
  const status = String(row?.roster_status || row?.status || "active").toLowerCase();
  return !/cut|expired|inactive|dropped/.test(status);
}

export function liveRosterPositionCounts(roster = []) {
  const counts = Object.fromEntries(ROSTER_LIMIT_KEYS.map((pos) => [pos, 0]));
  (roster || []).forEach((row) => {
    if (!isActiveRosterRow(row)) return;
    const pos = normalizeHubPosition(row?.position).toLowerCase();
    if (pos in counts) counts[pos] += 1;
  });
  return counts;
}

export function rulesFormWarnings({ rules, roster = [] } = {}) {
  const merged = mergeLeagueRules(rules);
  const warnings = {};
  const minSum = rosterMinimumSum(merged);
  const fixedPoint = ROSTER_LIMIT_KEYS.every((pos) => (
    Number(merged.roster[pos]?.min) === Number(merged.roster[pos]?.max)
  ));
  if (fixedPoint && minSum > 0) {
    warnings.fixed_point = RULES_COPY.fixedPointRange(minSum);
  }
  const live = (roster || []).filter(isActiveRosterRow);
  if (live.length > 0) {
    if (minSum > live.length) {
      warnings.live_roster = RULES_COPY.liveRosterShort(minSum, live.length);
    }
    const counts = liveRosterPositionCounts(live);
    const short = ROSTER_LIMIT_KEYS.filter((pos) => (
      counts[pos] < Number(merged.roster[pos]?.min || 0)
    )).map((pos) => pos.toUpperCase());
    if (short.length) {
      warnings.live_positions = RULES_COPY.livePosShort(short.join(", "));
    }
  }
  return warnings;
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
      label: "New vet deals",
      value: `${contracts.veteran_years} year${Number(contracts.veteran_years) === 1 ? "" : "s"} · ${contracts.veteran_salary_static ? "Flat" : "Steps up"}`,
    },
    {
      id: "renewals",
      label: "Extensions",
      value: extensionPolicyLabel(contracts),
    },
    {
      id: "roster",
      label: "Roster size",
      value: merged.roster_size_max != null
        ? `${merged.roster_size_max} players`
        : "Position limits",
    },
  ];
}

function formatLabel(draftType) {
  return FORMAT_OPTIONS.find((option) => option.id === draftType)?.label || draftType;
}

function moneyLabel(value) {
  return `$${Number(value || 0).toLocaleString()}`;
}

export function leagueAllowsDealExtensions(contracts = {}) {
  return Boolean(contracts.one_renewal_after_rookie) || Boolean(contracts.allow_veteran_renewal);
}

export function applyDealExtensionPolicy(contracts = {}, enabled) {
  const on = Boolean(enabled);
  return {
    ...contracts,
    one_renewal_after_rookie: on,
    allow_veteran_renewal: on,
  };
}

export function extensionPolicyLabel(contracts = {}) {
  const rookies = Boolean(contracts.one_renewal_after_rookie);
  const vets = Boolean(contracts.allow_veteran_renewal);
  if (rookies && vets) return "Rookie deals and vet deals";
  if (rookies) return "Rookie deals only";
  if (vets) return "Vet deals only";
  return "Off";
}

export function snapshotRulesForm({ name, season, rules }) {
  const merged = mergeLeagueRules(rules);
  return JSON.stringify({
    name: String(name || "").trim(),
    season: Number(season) || 0,
    scoring: Object.fromEntries(SCORING_FIELDS.map(([key]) => [key, merged.scoring[key] === "" ? "" : Number(merged.scoring[key])])),
    draft_type: merged.draft_type,
    salary_cap: Number(merged.salary_cap) || 0,
    roster_size_max: merged.roster_size_max == null ? null : Number(merged.roster_size_max),
    risk_tolerance: Number(merged.risk_tolerance) || 0,
    auction: {
      min_bid: Number(merged.auction.min_bid) || 0,
      nomination_timer_sec: Number(merged.auction.nomination_timer_sec) || 0,
      bid_timer_sec: Number(merged.auction.bid_timer_sec) || 0,
      bid_extension_sec: Number(merged.auction.bid_extension_sec) || 0,
      allow_mid_draft_cuts: Boolean(merged.auction.allow_mid_draft_cuts),
    },
    roster: Object.fromEntries(ROSTER_LIMIT_KEYS.map((pos) => ([
      pos,
      {
        min: Number(merged.roster[pos]?.min) || 0,
        max: Number(merged.roster[pos]?.max) || 0,
      },
    ]))),
    contracts: {
      max_years: Number(merged.contracts.max_years) || 0,
      cut_refund_pct: Number(merged.contracts.cut_refund_pct) || 0,
      extension_step_up: Number(merged.contracts.extension_step_up) || 0,
      rookie_years: Number(merged.contracts.rookie_years) || 0,
      veteran_years: Number(merged.contracts.veteran_years) || 0,
      rookie_salary_static: Boolean(merged.contracts.rookie_salary_static),
      veteran_salary_static: Boolean(merged.contracts.veteran_salary_static),
      one_renewal_after_rookie: Boolean(merged.contracts.one_renewal_after_rookie),
      allow_veteran_renewal: Boolean(merged.contracts.allow_veteran_renewal),
    },
  });
}

export function isRulesFormDirty(current, saved) {
  return snapshotRulesForm(current) !== snapshotRulesForm(saved);
}

export function glanceEyebrow(dirty) {
  return dirty ? RULES_COPY.glancePreview : RULES_COPY.glanceSaved;
}

export function rulesSaveDisabledReason({ dirty = false, saving = false, errorCount = 0 } = {}) {
  if (saving) return "";
  if (errorCount > 0) return RULES_COPY.fixBeforeSave;
  if (!dirty) return RULES_COPY.noChanges;
  return "";
}

export function formatLastSaved(date) {
  if (!date) return "";
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  return value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function templateImpact(currentRules, presetRules) {
  const current = mergeLeagueRules(currentRules);
  const next = mergeLeagueRules(presetRules);
  const changes = [];
  if (current.draft_type !== next.draft_type) {
    changes.push(`Draft format becomes ${formatLabel(next.draft_type)}.`);
  }
  if (Number(current.salary_cap) !== Number(next.salary_cap) || isPickDraft(current) !== isPickDraft(next)) {
    changes.push(isPickDraft(next)
      ? "Salary cap becomes none."
      : `Salary cap becomes ${moneyLabel(next.salary_cap)}.`);
  }
  if (current.roster_size_max !== next.roster_size_max) {
    changes.push(next.roster_size_max == null
      ? "Roster size becomes position limits."
      : `Roster size becomes ${next.roster_size_max}.`);
  }
  const currentMin = rosterMinimumSum(current);
  const nextMin = rosterMinimumSum(next);
  if (currentMin !== nextMin) {
    changes.push(`Position minimums become ${nextMin} players.`);
  }
  if (Number(current.contracts.max_years) !== Number(next.contracts.max_years)) {
    changes.push(`Max extension becomes ${next.contracts.max_years} year${Number(next.contracts.max_years) === 1 ? "" : "s"}.`);
  }
  if (Boolean(current.contracts.veteran_salary_static) !== Boolean(next.contracts.veteran_salary_static)) {
    changes.push(
      next.contracts.veteran_salary_static
        ? "New vet deals stay flat. The step-up starts on an extension."
        : "New vet deals step every year.",
    );
  }
  if (Boolean(current.contracts.allow_veteran_renewal) !== Boolean(next.contracts.allow_veteran_renewal)) {
    changes.push(
      next.contracts.allow_veteran_renewal
        ? "Vet deal extensions become available."
        : "Vet deal extensions are disabled.",
    );
  }
  if (Boolean(current.contracts.one_renewal_after_rookie) !== Boolean(next.contracts.one_renewal_after_rookie)) {
    changes.push(
      next.contracts.one_renewal_after_rookie
        ? "Rookie deal extensions become available."
        : "Rookie deal extensions are disabled.",
    );
  }
  if (!changes.length) {
    changes.push("Every field is reset to this template.");
  }
  return changes;
}

export function templateConfirmMessage(preset, currentRules) {
  const label = preset?.label || "this template";
  const impact = templateImpact(currentRules, preset?.rules || {});
  return `${RULES_COPY.templateConfirmLead(label)}\n\n${impact.map((line) => `• ${line}`).join("\n")}`;
}

export function presetRulesFromList(preset) {
  if (!preset?.rules || typeof preset.rules !== "object") return null;
  return mergeLeagueRules(preset.rules);
}

/** Apply a Rules save only if the form is still bound to the league that was written. */
export function shouldApplyWorkspaceSave({
  boundLeagueId = null,
  currentLeagueId = null,
  savedLeagueId = null,
} = {}) {
  const bound = boundLeagueId ? String(boundLeagueId) : "";
  if (!bound) return true;
  if (savedLeagueId && String(savedLeagueId) !== bound) return false;
  if (currentLeagueId && String(currentLeagueId) !== bound) return false;
  return true;
}
