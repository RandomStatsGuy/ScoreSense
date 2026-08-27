/** Centralized Draft Hub player-table columns by draft mode. */

export const PICK_DRAFT_SORT_OPTIONS = [
  { id: "season_proj", label: "Projected points" },
  { id: "season_p10", label: "Floor" },
  { id: "season_p90", label: "Ceiling" },
  { id: "pos_rank", label: "Positional rank" },
  { id: "adp", label: "ADP" },
  { id: "player", label: "Name" },
];

export const AUCTION_SORT_OPTIONS = [
  { id: "fair_value", label: "Suggested bid" },
  { id: "risk_score", label: "Risk score" },
  { id: "season_proj", label: "Projected points" },
  { id: "season_spread", label: "Season spread" },
  { id: "upside_skew", label: "Upside skew" },
  { id: "value_delta", label: "Vs cost" },
  { id: "player", label: "Name" },
];

/** Resolve a user-facing sort label without leaking internal snake_case keys. */
export function sortLabelForKey(options, key) {
  const found = (options || []).find((option) => option.id === key)?.label;
  if (found) return found;
  return String(key || "Sort")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const COL = {
  player: { id: "player", label: "Player", className: "col-player" },
  team: { id: "team", label: "Team", className: "hub-col-team" },
  pos: { id: "position", label: "Pos", className: "hub-col-pos" },
  proj: { id: "season_proj", label: "Projected pts", className: "hub-col-proj" },
  perGame: { id: "per_game_proj", label: "Per-game", className: "hub-col-pg" },
  spread: { id: "season_spread", label: "Spread", className: "hub-col-spread" },
  p10: { id: "season_p10", label: "P10", className: "hub-col-p10" },
  p50: { id: "season_p50", label: "P50", className: "hub-col-p50" },
  p90: { id: "season_p90", label: "P90", className: "hub-col-p90" },
  minSal: { id: "min_sal", label: "Min", className: "hub-col-min" },
  maxSal: { id: "max_sal", label: "Max", className: "hub-col-max" },
  valueRange: { id: "value_range", label: "Value", className: "hub-col-value" },
  fairValue: { id: "fair_value", label: "Suggested bid", className: "hub-col-fv" },
  risk: { id: "risk_score", label: "Risk", className: "hub-col-risk" },
  delta: { id: "value_delta", label: "Vs cost", className: "hub-col-delta" },
  posRank: { id: "pos_rank", label: "Pos rank", className: "hub-col-posrank" },
  need: { id: "need", label: "Fit", className: "hub-col-need" },
  tier: { id: "tier", label: "Tier", className: "hub-col-tier" },
  status: { id: "status", label: "Status", className: "hub-col-status" },
  actions: { id: "actions", label: "", className: "hub-col-actions" },
};

/**
 * Column schema for the live player table.
 * Keep auction-only fields out of snake/linear by construction.
 */
export function columnsForDraftMode({
  pickDraft = false,
  compact = false,
  advanced = false,
  draftConsole = false,
  showDelta = true,
  showStatus = true,
  showAdd = false,
  showSelect = false,
  riskActive = false,
} = {}) {
  const actionCol = Boolean(showAdd || showSelect || draftConsole);
  const columns = [COL.player];

  if (advanced && !draftConsole) columns.push(COL.team);
  if (!draftConsole) columns.push(COL.pos);
  columns.push(COL.proj);

  if (pickDraft) {
    columns.push(COL.posRank);
    if (draftConsole) columns.push(COL.need);
    if (advanced) {
      columns.push(COL.p10, COL.p50, COL.p90, COL.perGame, COL.spread);
    } else if (draftConsole && compact) {
      // Median + floor/ceiling bar live in the projected-pts cell.
    }
  } else {
    if (advanced) {
      columns.push(COL.perGame, COL.spread);
      if (!compact || !draftConsole) columns.push(COL.minSal, COL.maxSal);
    }
    if (draftConsole) columns.push(COL.valueRange);
    columns.push(COL.fairValue);
    if (draftConsole || advanced || riskActive) columns.push(COL.risk);
    if (showDelta) columns.push(COL.delta);
    columns.push(COL.tier);
  }

  if (showStatus) columns.push(COL.status);
  if (actionCol) columns.push(COL.actions);

  const ids = columns.map((c) => c.id);
  const has = (id) => ids.includes(id);
  return {
    pickDraft: Boolean(pickDraft),
    columns,
    ids,
    colCount: columns.length,
    showFairValue: has("fair_value"),
    showValueRange: has("value_range"),
    showCostDelta: has("value_delta"),
    showSalaryBounds: has("min_sal"),
    showRiskScore: has("risk_score"),
    showTier: has("tier"),
    showPosRank: has("pos_rank"),
    showNeed: has("need"),
    showPosCol: has("position"),
    showTeam: has("team"),
    showP10: has("season_p10"),
    showP50: has("season_p50"),
    showP90: has("season_p90"),
    showPerGame: has("per_game_proj"),
    showSpread: has("season_spread"),
    showStatus: has("status"),
    actionCol,
    sortOptions: pickDraft ? PICK_DRAFT_SORT_OPTIONS : AUCTION_SORT_OPTIONS,
    defaultSortKey: pickDraft ? "season_proj" : "fair_value",
  };
}

export function positionalRanks(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    const pos = String(row?.position || "").toUpperCase();
    if (!groups.has(pos)) groups.set(pos, []);
    groups.get(pos).push(row);
  }
  const ranks = new Map();
  for (const list of groups.values()) {
    list.sort((a, b) => (Number(b?.season_proj) || 0) - (Number(a?.season_proj) || 0));
    list.forEach((row, idx) => {
      if (row?.player_id) ranks.set(String(row.player_id), idx + 1);
    });
  }
  return ranks;
}

export const AUCTION_COLUMN_IDS = ["fair_value", "value_range", "value_delta", "min_sal", "max_sal", "tier", "risk_score"];

export function pickDraftSchemaHasNoAuctionColumns(schema) {
  const banned = new Set(["fair_value", "value_range", "value_delta", "min_sal", "max_sal", "tier"]);
  return !(schema?.ids || []).some((id) => banned.has(id));
}
