/** Shared DFS / lineup-builder presentation (Tools → DFS). */

import { displayNflTeam } from "./nflTeamAbbrev.js";

export const DFS_WORKSPACE_COPY = {
  eyebrow: "Tournament workspace", title: "Your lineups, built together.", support: "Choose your pool. Control your exposure. Review the whole set.",
  build: "Build lineups", results: "Results", settings: "Build settings", contest: "Contest", contestNote: "Projection-based construction. Contest-return estimates are not available.",
  format: "Format", slate: "Slate", season: "Season", week: "Week", count: "Lineups", goal: "Score to optimize", captain: "Locked Captain", anyCaptain: "Choose from the pool", captainLimit: "Captain max", noCaptain: "No Captain", exposure: "Max player exposure", differences: "Minimum differences", salary: "Salary range", min: "Minimum salary", max: "Maximum salary", stacks: "Stacking & other rules", qbStack: "Pass catchers per QB", bringBack: "Include an opposing receiver", maxTeam: "Max players per team", jitter: "Projection variation", jitterNote: "Variation changes the input scores between builds. It is not a game simulation.", lockNote: "Locked players appear in every lineup. Other limits count toward the requested set; the Exposure tab shows actual usage.",
  pool: "Player pool", exposureTab: "Exposure", notes: "Build notes", search: "Search players…", player: "Player", proj: "Proj.", own: "Own.", actions: "Actions", lock: "Lock", skip: "Skip", clear: "Clear locks and skips", noPlayers: "No players match these filters.", projections: "Import projections & ownership", salaryImport: "Import salary CSV", projectionHelp: "CSV columns: ID, Proj, Floor, Ceiling, optional Ownership (0–100). Use this slate’s FLEX IDs and base points, before Captain multipliers.", missingOwnership: "Ownership not loaded. Duplication and contest-return estimates are unavailable.", missingProjection: "Missing estimates are excluded from builds. Fixed estimates are shown separately from modeled projections.",
  selected: "Selected lineup", empty: "Load a slate, choose your settings, and build your first lineup.", saved: "Saved with original inputs", save: "Save for postgame review", used: "Salary used", unused: "Unused", rebuild: "Rebuild lineups", building: "Building…", notesLabel: "Your game script and pregame reasoning", notesHelp: "These notes are saved with the build. They do not change the source projections.",
  newLineups: "New lineups", upload: "Upload to My Lineups", uploadHelp: "A lineup CSV creates lineups. It does not enter a contest or edit reserved entries.", download: "Download lineup CSV", detail: "Download detail CSV", existing: "Reserved entries", edit: "Update existing entries", editHelp: "Import the CSV from DraftKings’ Edit Entries page, then review which lineup goes into each entry.", template: "Import Edit Entries CSV", assignment: "Entry assignments", keep: "Keep current lineup", sequential: "Assign lineups in order", entryDownload: "Download Edit Entries CSV", verifySlate: "I checked that this template is for the same slate and start time.", restriction: "If upload succeeds but entry is blocked, record the exact message, contest ID and time for DraftKings support. Export checks cannot verify account eligibility.",
  imported: "Imported", previous: "Previous", next: "Next", total: "Total", captainCount: "Captain", all: "All", loading: "Loading player pool",
};

export const DFS_RESULTS_COPY = {
  title:"See what your lineups earned.",support:"Track the money. Review the decisions behind it.",history:"Import contest history",scores:"Import lineup results",fees:"Entry fees",payouts:"Payouts",net:"Net profit",roi:"ROI",chart:"Spend against payouts",cumulative:"Cumulative · settled cash entries",sample:"Returns describe the imported sample. A profitable period alone does not establish a lasting edge.",empty:"Import contest history to see your entry fees and payouts.",coverage:"Import coverage",matched:"Entries with complete finances",undated:"Settled entries without dates",unsettled:"Unsettled or void entries",groups:"Where did the returns come from?",group:"Group by",stack:"QB stacks",captain:"Captain",contest:"Contest",salary:"Salary left",count:"Entries",noGroups:"Import results or link a saved build to see lineup groups.",descriptive:"These groups describe your entries, not the whole field. Counts and fees matter when comparing returns.",review:"Review an entry",entry:"Entry",date:"Date",points:"Actual points",rank:"Rank",saved:"Saved builds",snapshot:"Original build snapshot",link:"Link saved build",none:"No saved build",lineup:"Lineup",saveLink:"Save link",notes:"Postgame notes",saveNote:"Save review note",projection:"Saved projection sum",difference:"Actual minus saved projection",compareHelp:"This compares the actual lineup total with the saved sum of player projections. It does not identify the cause of a miss.",noSnapshot:"Link this entry to a saved pregame build to compare projections and exposure.",before:"At build time",after:"After the game",journal:"Which assumptions held? Was a role change knowable before lock? Keep hindsight separate from the original decision.",importTitle:"Review your import",mapping:"Match CSV columns",unmapped:"Not in this file",site:"Site",kind:"Import type",historyKind:"Fees and payouts",resultsKind:"Scores and lineups",contestOverride:"Contest ID (if absent from the file)",settled:"These entries are settled",payoutHelp:"Payout must be the total credited cash prize, not net profit. Keep tickets, refunded and promotional entries out of this cash import.",preview:"Preview entries",saveImport:"Save imported entries",cancel:"Cancel import",remove:"Remove entry",removeConfirm:"Remove this entry from your results? The original CSV and saved build remain available.",all:"All sites",noChart:"Dated, settled cash entries will appear here.",partial:"Some settled entries have incomplete financial data. Totals cover complete entries only; ROI is unavailable.",
};

export const OBJECTIVES = [
  { id: "median", label: "Proj (P50)", shortLabel: "Proj", hint: "Maximize the sum of player median projections" },
  { id: "floor", label: "Floor (P10)", shortLabel: "Floor", hint: "Maximize the sum of player P10 estimates; this is not a lineup floor" },
  { id: "ceiling", label: "Ceiling (P90)", shortLabel: "Ceiling", hint: "Maximize the sum of player P90 estimates; this is not a lineup ceiling or win probability" },
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
  shootoutTitle: "Pick the totals",
  shootoutSupport: "Tap every high-total game you want stacked. That does not lock a player. Pin a stack if you want that side.",
  shootoutEmpty: "No Vegas lines for this week.",
  shootoutCaptain: "Captain mode fills from this game. The CPT slot is 1.5×.",
  clearGames: "Clear games",
  stacksTitle: "Stacks from these games",
  stacksSupport: "Build takes a QB from the games you marked. Pin a stack only if you want that quarterback.",
  useStack: "Use this stack",
  stackInBuild: "In the build",
};

const TEAM_MATCH = Object.freeze({
  LAR: "LA",
  LA: "LA",
  WSH: "WAS",
  WAS: "WAS",
  JAC: "JAX",
  JAX: "JAX",
  LVR: "LV",
  LV: "LV",
  OAK: "LV",
});

const PASS_CATCHERS = new Set(["WR", "TE"]);
const SKILL_POSITIONS = new Set(["RB", "WR", "TE"]);

export function normalizeDfsTeam(team) {
  const raw = String(team || "").trim().toUpperCase();
  if (!raw || raw === "NAN" || raw === "NONE" || raw === "NULL") return "";
  return TEAM_MATCH[raw] || raw;
}

export function sameDfsTeam(left, right) {
  const a = normalizeDfsTeam(left);
  const b = normalizeDfsTeam(right);
  return Boolean(a && a === b);
}

export function gameStackLabel(game = {}) {
  const away = displayNflTeam(game.away);
  const home = displayNflTeam(game.home);
  if (away === "—" && home === "—") return "";
  return `${away} @ ${home}`;
}

export function slateGames(games = [], pool = []) {
  if (!games.length) return [];
  const teams = new Set(
    (pool || []).map((row) => normalizeDfsTeam(row.Team)).filter(Boolean),
  );
  if (!teams.size) return games;
  const matched = games.filter((game) => (
    teams.has(normalizeDfsTeam(game.home)) && teams.has(normalizeDfsTeam(game.away))
  ));
  return matched.length ? matched : games;
}

const STACK_QB_FLOOR = 6;

function stackMedian(row = {}) {
  return Number(row["Projected Points"]) || 0;
}

function stackRank(row = {}) {
  const median = stackMedian(row);
  if (median > 0) return median;
  const ceiling = Number(row["High (P90)"]);
  return Number.isFinite(ceiling) && ceiling > 0 ? ceiling : 0;
}

function stackRowOut(row = {}) {
  if (row.on_bye) return true;
  const status = String(row["Injury Status"] || row.injury_status || "").toLowerCase();
  return /(out|ir|pup|inactive|suspended)/.test(status);
}

export function stackRowEligible(row, { requireSalary = false } = {}) {
  if (!row || !row.player_id) return false;
  if (stackRowOut(row)) return false;
  if (requireSalary && (row.salary == null || row.salary === "")) return false;
  return true;
}

function normalizePos(value) {
  return String(value || "").trim().toUpperCase();
}

export function gameTeamCodes(game = {}) {
  return [normalizeDfsTeam(game.away), normalizeDfsTeam(game.home)].filter(Boolean);
}

function teamPlayers(pool, team, { requireSalary = false } = {}) {
  return (pool || []).filter((row) => (
    stackRowEligible(row, { requireSalary }) && sameDfsTeam(row.Team, team)
  ));
}

export function starterQb(pool, team, { requireSalary = false } = {}) {
  const qbs = teamPlayers(pool, team, { requireSalary })
    .filter((row) => normalizePos(row.Position) === "QB" && stackRank(row) >= STACK_QB_FLOOR)
    .slice()
    .sort((left, right) => stackRank(right) - stackRank(left));
  return qbs[0] || null;
}

export function listGameStacks(pool = [], game = {}, { stackCount = 2, requireSalary = false } = {}) {
  const home = normalizeDfsTeam(game.home);
  const away = normalizeDfsTeam(game.away);
  const sides = [away, home].filter(Boolean);
  const stacks = [];
  for (const team of sides) {
    const qb = starterQb(pool, team, { requireSalary });
    if (!qb) continue;
    const oppTeam = team === home ? away : home;
    const catchers = teamPlayers(pool, team, { requireSalary })
      .filter((row) => PASS_CATCHERS.has(normalizePos(row.Position)))
      .slice()
      .sort((left, right) => stackRank(right) - stackRank(left))
      .slice(0, Math.max(0, stackCount));
    const bring = teamPlayers(pool, oppTeam, { requireSalary })
      .filter((row) => SKILL_POSITIONS.has(normalizePos(row.Position)))
      .slice()
      .sort((left, right) => stackRank(right) - stackRank(left))[0] || null;
    stacks.push({
      id: `${game.game_id || "game"}:${team}:${qb.player_id}`,
      game,
      qb,
      stackTeam: team,
      oppTeam,
      catchers,
      bring,
      complete: catchers.length >= stackCount,
    });
  }
  return stacks.sort((left, right) => stackRank(right.qb) - stackRank(left.qb));
}

export function listSelectedGameStacks(pool, games = [], opts = {}) {
  return (games || []).flatMap((game) => listGameStacks(pool, game, opts));
}

export function pickGameStack(pool = [], game = {}, { stackCount = 2, requireSalary = false } = {}) {
  const listed = listGameStacks(pool, game, { stackCount, requireSalary });
  const stack = listed[0];
  if (!stack) {
    return { game, players: [], complete: false, stackTeam: "", oppTeam: "" };
  }
  const players = [
    { role: "qb", label: "QB", row: stack.qb },
    ...stack.catchers.map((row, index) => ({
      role: "stack",
      label: `${normalizePos(row.Position)} +${index + 1}`,
      row,
    })),
  ];
  if (stack.bring) players.push({ role: "bring", label: "Bring", row: stack.bring });
  return {
    game,
    stackTeam: stack.stackTeam,
    oppTeam: stack.oppTeam,
    players,
    complete: stack.complete && Boolean(stack.bring),
  };
}

export function stackOptionCopy(stack) {
  const qbName = String(stack?.qb?.Player || "").trim() || "QB";
  const team = displayNflTeam(stack?.stackTeam);
  const catcherNames = (stack?.catchers || [])
    .map((row) => String(row.Player || "").trim())
    .filter(Boolean);
  const bringName = String(stack?.bring?.Player || "").trim();
  const mates = catcherNames.length
    ? catcherNames.join(" · ")
    : "Thin on this board — Build still pulls the rest of the team.";
  return {
    title: `${qbName} · ${team}`,
    game: gameStackLabel(stack?.game),
    body: bringName ? `${mates}. Bring-back ${bringName}.` : mates,
  };
}

export function stackPlayerIds(stack) {
  return (stack?.players || [])
    .map((entry) => String(entry.row?.player_id || ""))
    .filter(Boolean);
}

export function replaceStackLocks(locked, previousIds = [], nextIds = []) {
  const next = new Set(Array.from(locked || [], (id) => String(id)));
  for (const id of previousIds) next.delete(String(id));
  for (const id of nextIds) {
    if (id) next.add(String(id));
  }
  return next;
}

export function dropLockId(ids, playerId) {
  const next = new Set(Array.from(ids || [], (id) => String(id)));
  next.delete(String(playerId || ""));
  return next;
}

export function vegasGameCta({ selected = false } = {}) {
  return selected ? "In the build" : "Add this total";
}

export function stackPreviewCopy(stack) {
  const label = gameStackLabel(stack?.game);
  if (!stack?.players?.length) {
    return {
      title: label ? `${label}` : "These games",
      body: "No starter QB on this slate for that game yet.",
    };
  }
  const stackName = displayNflTeam(stack.stackTeam);
  return {
    title: label || "These games",
    body: `${stackName} is one side. Pin a stack if you want that quarterback — Build does not lock him for you.`,
  };
}

export function stackApplyLiveText(stack) {
  const game = gameStackLabel(stack?.game);
  return game ? `${game} is in the build. No player locked.` : "Game is in the build. No player locked.";
}

export function stackClearLiveText() {
  return "Games cleared. Stacks from those totals are off.";
}

export function gamesMarkedCopy(count = 0) {
  const n = Number(count) || 0;
  if (n <= 0) return "";
  return n === 1 ? "1 game in the build" : `${n} games in the build`;
}

export function dfsHeroCopy({
  isDfs = true,
  siteLabel = "DraftKings Classic",
  captain = false,
} = {}) {
  if (isDfs && captain) {
    return {
      eyebrow: "DFS",
      heading: "Name the captain, then the five.",
      support: `A ${siteLabel} game. The CPT slot is 1.5×. Leave salary on the table and you lose to someone who spent it.`,
    };
  }
  if (isDfs) {
    return {
      eyebrow: "DFS",
      heading: "Pick the high totals.",
      support: `Mark the ${siteLabel} games you want stacked. Pin a stack if you want that quarterback. A loud ceiling does not lock a backup for you.`,
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
  stackGameLabel = "",
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
  if (stackGameLabel) {
    items.push({
      id: "game",
      label: /games/i.test(stackGameLabel) ? "Games" : "Game",
      value: stackGameLabel,
    });
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

export function emptyLineupCopy({ optimizing = false, isDfs = true, hasStack = false } = {}) {
  if (optimizing) return "Running optimizer…";
  if (hasStack) {
    return isDfs
      ? "Build takes a QB stack from the games you marked. Pin a stack if you want that side."
      : "Build takes a stack from the games you marked.";
  }
  if (isDfs) return "Lock or skip players, then build a lineup under the cap.";
  return "Lock or skip players, then build a lineup.";
}

export function optimizeButtonLabel({
  optimizing = false,
  lineupCount = 1,
  hasLineup = false,
  hasStack = false,
} = {}) {
  if (optimizing) return "Optimizing…";
  if (hasLineup) {
    return Number(lineupCount) > 1 ? `Rebuild ${lineupCount} lineups` : "Rebuild this lineup";
  }
  if (hasStack) {
    return Number(lineupCount) > 1
      ? `Build ${lineupCount} lineups around these games`
      : "Build around these games";
  }
  if (Number(lineupCount) > 1) return `Build ${lineupCount} lineups`;
  return "Build this lineup";
}

export const DFS_POOL_COPY = {
  lockSkip: "Lock / Skip",
  clearLocks: "Clear locks",
  inLineup: "In lineup",
  swap: "Swap",
};

export const POOL_COLUMN_TIPS = {
  pos: "Position",
  implied: "Implied team total from the Vegas board",
  salary: "Slate salary",
  proj: "Median projected points (P50)",
  value: "Projected points per $1,000 of salary",
  floor: "Low outcome (P10) — the Floor goal optimizes this",
  ceiling: "High outcome (P90) — the Ceiling goal optimizes this",
};

const FLEX_POSITIONS = new Set(["RB", "WR", "TE"]);
const DST_POSITIONS = new Set(["DST", "DEF"]);

export function pinActionLabel(kind, playerName) {
  const name = String(playerName || "player").trim() || "player";
  return kind === "skip" ? `Skip ${name}` : `Lock ${name}`;
}

export function swapActionLabel(incomingName, outgoingName) {
  const incoming = String(incomingName || "player").trim() || "player";
  const outgoing = String(outgoingName || "").trim();
  if (outgoing) return `Swap ${incoming} in for ${outgoing}`;
  return `Swap ${incoming} into the lineup`;
}

export function buildResultLiveText({
  ok = true,
  playerCount = 0,
  totalPoints = null,
  error = "",
} = {}) {
  if (!ok) return error || "Could not build a valid lineup.";
  const count = Number(playerCount) || 0;
  const people = `${count} player${count === 1 ? "" : "s"}`;
  if (totalPoints != null && Number.isFinite(Number(totalPoints))) {
    return `Lineup is built. ${people}, ${Number(totalPoints).toFixed(1)} total.`;
  }
  return `Lineup is built. ${people}.`;
}

export function swapResultLiveText({ incomingName, outgoingName } = {}) {
  return `Swapped ${outgoingName} for ${incomingName}.`;
}

export function objectiveSortColumn(objectiveId) {
  if (objectiveId === "floor") return "floor";
  if (objectiveId === "ceiling") return "ceiling";
  if (objectiveId === "value") return "value";
  return "proj";
}

export function poolSortValue(row = {}, column, vegasTeams = {}) {
  switch (column) {
    case "player":
      return String(row.Player || "").toLowerCase();
    case "pos":
      return String(row.Position || "");
    case "team":
      return String(row.Team || "");
    case "implied": {
      const num = Number(vegasTeams[row.Team]?.implied_total);
      return Number.isFinite(num) ? num : Number.NEGATIVE_INFINITY;
    }
    case "salary":
      return Number(row.salary) || 0;
    case "proj":
      return Number(row["Projected Points"]) || 0;
    case "value":
      return Number(row.value) || 0;
    case "floor":
      return Number(row["Low (P10)"]) || 0;
    case "ceiling":
      return Number(row["High (P90)"]) || 0;
    default:
      return 0;
  }
}

export function sortPoolRows(rows = [], { column = "proj", dir = "desc" } = {}, vegasTeams = {}) {
  const mul = dir === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const av = poolSortValue(left, column, vegasTeams);
    const bv = poolSortValue(right, column, vegasTeams);
    if (typeof av === "string" || typeof bv === "string") {
      return String(av).localeCompare(String(bv), undefined, { sensitivity: "base" }) * mul;
    }
    return (av - bv) * mul;
  });
}

export function nextExclusiveChoice(ids = [], current, key) {
  const delta = key === "ArrowRight" || key === "ArrowDown"
    ? 1
    : key === "ArrowLeft" || key === "ArrowUp"
      ? -1
      : 0;
  if (!delta || !ids.length) return current;
  const idx = ids.indexOf(current);
  const from = idx < 0 ? 0 : idx;
  return ids[(from + delta + ids.length) % ids.length];
}

function normalizeSlot(value) {
  return String(value || "").trim().toUpperCase();
}

export function slotAcceptsPosition(slot, position) {
  const s = normalizeSlot(slot);
  const p = normalizeSlot(position);
  if (!s || !p) return false;
  if (s === p) return true;
  if (DST_POSITIONS.has(s) && DST_POSITIONS.has(p)) return true;
  if ((s === "FLEX" || s === "F") && FLEX_POSITIONS.has(p)) return true;
  if ((s === "CPT" || s === "MVP") && p && p !== "DST" && p !== "DEF") return true;
  return false;
}

export function pickSwapTarget(lineup = [], position) {
  const exact = lineup.filter((row) => normalizeSlot(row.slot) === normalizeSlot(position)
    || (DST_POSITIONS.has(normalizeSlot(row.slot)) && DST_POSITIONS.has(normalizeSlot(position))));
  const pool = exact.length
    ? exact
    : lineup.filter((row) => slotAcceptsPosition(row.slot, position));
  if (!pool.length) return null;
  return pool.slice().sort((a, b) => (Number(a.proj) || 0) - (Number(b.proj) || 0))[0];
}

export function poolRowToLineupSlot(poolRow, slot) {
  return {
    slot,
    player: poolRow.Player,
    player_id: poolRow.player_id,
    team: poolRow.Team,
    position: poolRow.Position,
    proj: poolRow["Projected Points"],
    salary: poolRow.salary,
    floor: poolRow["Low (P10)"],
    ceiling: poolRow["High (P90)"],
  };
}

export function lineupTotals(lineup = []) {
  return lineup.reduce((acc, row) => {
    const proj = Number(row.proj);
    const salary = Number(row.salary);
    if (Number.isFinite(proj)) acc.totalPoints += proj;
    if (Number.isFinite(salary)) acc.totalSalary += salary;
    return acc;
  }, { totalPoints: 0, totalSalary: 0 });
}

export function swapPoolPlayerIntoLineup(lineup = [], poolRow) {
  if (!poolRow || !lineup.length) return null;
  const incomingId = String(poolRow.player_id || "");
  if (!incomingId) return null;
  if (lineup.some((row) => String(row.player_id) === incomingId)) return null;
  const outgoing = pickSwapTarget(lineup, poolRow.Position);
  if (!outgoing) return null;
  const next = lineup.map((row) => (
    String(row.player_id) === String(outgoing.player_id) && row.slot === outgoing.slot
      ? poolRowToLineupSlot(poolRow, outgoing.slot)
      : row
  ));
  return {
    lineup: next,
    outgoing,
    incoming: poolRow,
    ...lineupTotals(next),
  };
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
  return `${displayNflTeam(favorite)} -${Math.abs(spread)}`;
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

export function launchCopy({
  isDfs = true,
  hasLineup = false,
  siteLabel = "DraftKings Classic",
  stackGameLabel = "",
} = {}) {
  if (hasLineup) {
    return {
      title: "Lineup is built.",
      body: isDfs
        ? "Salary and projection sit together. Swap a lock if the news moved."
        : "Projected points by slot. Swap a lock if your week changed.",
    };
  }
  if (stackGameLabel) {
    return {
      title: `${stackGameLabel}.`,
      body: isDfs
        ? "Build takes a stack from those totals and spends the leftover on other games."
        : "Build takes a stack from those games.",
    };
  }
  if (isDfs) {
    return {
      title: "Nine spots, one cap.",
      body: `A ${siteLabel} lineup. Go over the cap and it will not submit.`,
    };
  }
  return {
    title: "Your lineup.",
    body: "Best-effort PPR from this week's projections.",
  };
}

export function dfsRailTitle({ locked = 0, skipped = 0 } = {}) {
  return `Your lineup · ${locked} locked · ${skipped} skipped`;
}
