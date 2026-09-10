/** User-facing copy and deal-finder helpers for Fantasy → Rosters. */

import { fmtSal } from "./rosterFormat.js";
import { playerTradeableInWindow } from "./acquisitionWindow.js";
import { hubTeamLabel, hubTeamParts } from "./hubTeamLabel.js";

export const DEALS_VIEW = "deals";

export const ROSTERS_COPY = {
  eyebrow: "Rosters",
  heading: "League rosters",
  support:
    "Compare contracts and find players to trade for.",
  proposeTrade: "Propose trade",
  refreshLeague: "Refresh league",
  exportExcel: "Download Excel",
  exportBusy: "Preparing workbook…",
  exportTitle: "Workbook of every roster, salary, and history row. Opens in Excel.",
  dealsNav: "Contract values",
  dealsHeading: "Overpays and bargains",
  dealsCaption:
    "Contracts ranked by the difference between salary and estimated value.",
  dealsEmpty: "No contracts are above or below their estimated value.",
  dealsHint: "Select a team to view its full roster.",
  managersHeading: "Managers",
  emptyRoster: "No active players.",
  addToTrade: "Add to trade",
  tradeFor: "Trade for",
  tradeLocked: "Offseason trades apply only to contracts that survive the next draft.",
  tradeLockedShort: "Survives the draft only",
  extendable: "Extendable",
  expiring: "Expiring",
  you: "you",
  player: "Player",
  pos: "Pos",
  cap: "Cap",
  years: "Years",
  type: "Type",
  contract: "Contract",
  actions: "Actions",
  glanceEyebrow: "At a glance",
  glanceDealsTitle: "Contract values",
  glanceOverpays: "Overpays",
  glanceBargains: "Bargains",
  glanceManagers: "Managers",
  glanceCommitted: "Committed",
  glanceDead: "Dead cap",
  glanceFree: "Cap room",
  glanceExpiring: "Expiring",
  loading: "Loading league rosters",
};

export function contractGradeLabel(grade) {
  if (grade === "good") return "Bargain";
  if (grade === "bad") return "Overpay";
  if (grade === "fair") return "Fair";
  return null;
}

export function contractGradeClass(grade) {
  if (grade === "good") return "hub-value-delta-pos";
  if (grade === "bad") return "hub-value-delta-neg";
  return "hub-value-delta-fair";
}

export function isZeroDelta(value) {
  if (value == null || value === "") return true;
  const n = Number(value);
  return !Number.isFinite(n) || n === 0;
}

/** Describe the salary difference from estimated value. */
export function contractGradeText(row) {
  const grade = contractGradeLabel(row?.contract_grade);
  if (!grade) return null;
  if (row?.contract_grade === "fair" || isZeroDelta(row?.value_delta)) return "At estimated value";
  const delta = Number(row.value_delta);
  return `${fmtSal(Math.abs(delta))} ${delta > 0 ? "above" : "below"} estimated value`;
}

export function expireChipLabel(chip) {
  if (chip === "extend") return ROSTERS_COPY.extendable;
  if (chip === "fa") return ROSTERS_COPY.expiring;
  return null;
}

export function joinFacts(parts) {
  return (parts || [])
    .map((part) => (part == null ? "" : String(part).trim()))
    .filter(Boolean)
    .join(" · ");
}

export function yearsLeftLabel(row) {
  const yrs = row?.years_remaining ?? row?.contract_years;
  if (yrs == null || yrs === "") return "—";
  const n = Number(yrs);
  if (!Number.isFinite(n)) return String(yrs);
  return n === 1 ? "1 yr" : `${n} yrs`;
}

export function activeRoster(block) {
  return (block?.roster || []).filter((r) => r && String(r.roster_status || "active") === "active");
}

export function managerDealFacts(block) {
  const roster = activeRoster(block);
  const stats = block?.stats || {};
  const expiring = roster.filter((r) => r.expire_chip === "fa").length;
  let worst = null;
  for (const row of roster) {
    if (row.contract_grade !== "bad" || row.value_delta == null) continue;
    if (!worst || Number(row.value_delta) > Number(worst.value_delta)) worst = row;
  }
  return {
    free: stats.unspent,
    expiring,
    worstOverpay: worst?.value_delta ?? null,
    worstName: worst?.player_name || "",
  };
}

export function formatManagerRailFacts(facts) {
  const parts = [];
  if (facts?.free != null) parts.push(`${fmtSal(facts.free)} cap room`);
  parts.push(`${facts?.expiring ?? 0} expiring`);
  if (facts?.worstOverpay != null) {
    const n = Number(facts.worstOverpay);
    parts.push(`${n > 0 ? "+" : ""}${fmtSal(n)} overpay`);
  }
  return joinFacts(parts);
}

export function leagueDealRows(teamBlocks) {
  const rows = [];
  for (const block of teamBlocks || []) {
    for (const row of activeRoster(block)) {
      if (row.contract_grade !== "good" && row.contract_grade !== "bad") continue;
      rows.push({
        ...row,
        ownerTeam: block.team,
        ownerTeamId: block.team?.id || "",
      });
    }
  }
  rows.sort((a, b) => {
    const da = Math.abs(Number(a.value_delta) || 0);
    const db = Math.abs(Number(b.value_delta) || 0);
    if (db !== da) return db - da;
    return String(a.player_name || "").localeCompare(String(b.player_name || ""));
  });
  return rows;
}

export function dealCounts(rows) {
  let overpays = 0;
  let bargains = 0;
  for (const row of rows || []) {
    if (row.contract_grade === "bad") overpays += 1;
    if (row.contract_grade === "good") bargains += 1;
  }
  return { overpays, bargains };
}

export function formatDealsRailFacts(rows) {
  const { overpays, bargains } = dealCounts(rows);
  return joinFacts([
    `${overpays} overpay${overpays === 1 ? "" : "s"}`,
    `${bargains} bargain${bargains === 1 ? "" : "s"}`,
  ]);
}

export function tradeLockReason(row, window) {
  if (playerTradeableInWindow(row, window)) return "";
  return window?.message || ROSTERS_COPY.tradeLocked;
}

export function tradeActionLabel({ isOwnTeam }) {
  return isOwnTeam ? ROSTERS_COPY.addToTrade : ROSTERS_COPY.tradeFor;
}

export function rosterHeading(block) {
  if (!block?.team) return ROSTERS_COPY.dealsHeading;
  const parts = hubTeamParts(block.team);
  return parts.owner || parts.team || hubTeamLabel(block.team) || ROSTERS_COPY.dealsHeading;
}

export function rosterCaption(block) {
  if (!block?.team) return ROSTERS_COPY.dealsCaption;
  return `${rosterHeading(block)}'s active contracts.`;
}

export function ownerLine(team) {
  const parts = hubTeamParts(team);
  return parts.owner || parts.team || hubTeamLabel(team) || "Manager";
}

export function nicknameLine(team) {
  const parts = hubTeamParts(team);
  return parts.owner && parts.team ? parts.team : "";
}

export function positionSpendNote(stats) {
  const spend = stats?.by_position_spend || {};
  const counts = stats?.by_position_count || {};
  return Object.entries(spend)
    .filter(([, amt]) => Number(amt) > 0)
    .map(([pos, amt]) => {
      const count = Number(counts[pos]);
      const money = fmtSal(amt);
      return Number.isFinite(count) && count > 0 ? `${pos} ${money} (${count})` : `${pos} ${money}`;
    })
    .join(" · ");
}

export function managerPickerOptions(teamBlocks, dealRows) {
  return [
    {
      id: DEALS_VIEW,
      label: ROSTERS_COPY.dealsNav,
      detail: formatDealsRailFacts(dealRows),
    },
    ...(teamBlocks || []).map((block) => ({
      id: block.team.id,
      label: ownerLine(block.team),
      detail: formatManagerRailFacts(managerDealFacts(block)),
    })),
  ];
}

export const ROSTER_BOARD_COPY = {
  tabs: [{ id: "deals", label: "Contract values" }, { id: "teams", label: "Team rosters" }],
  filters: [{ id: "all", label: "All" }, { id: "below", label: "Below estimate" }, { id: "above", label: "Above estimate" }],
  sorts: [{ id: "difference", label: "Largest difference" }, { id: "salary", label: "Highest salary" }, { id: "name", label: "Player name" }],
  search: "Search players", allTeams: "All teams", teamSearch: "Find a manager or team",
  positions: "All positions", explanation: "Difference compares annual salary with ScoreSense estimated value.",
  refresh: "Refresh", refreshing: "Refreshing…", history: "View contract history",
  noLeague: "Choose a league to compare rosters.", noResults: "No contracts match these filters.",
  reset: "Reset filters", select: "Select a player to view their contract.",
  unavailable: "Estimate unavailable", estimate: "Est. value", salary: "Salary", difference: "Difference",
  contract: "Contract", player: "Player", manager: "Manager", close: "Close player details",
  managedBy: "Managed by", remaining: "remaining", capRoom: "Cap room", deadCap: "Dead cap",
  unknownContract: "Contract not recorded", readonly: "Trade actions are unavailable in this view.",
  noId: "This contract needs a matched player before it can be traded.",
  resultCount: (n) => `${n} contract${n === 1 ? "" : "s"}`,
  pagination: (start, end, total) => `Showing ${start}–${end} of ${total} contracts`,
  below: (n) => `${n} below estimate`, above: (n) => `${n} above estimate`,
  selectPlayer: (name) => `View ${name} contract`,
};

export function rosterMoney(value) {
  return value == null || value === "" || !Number.isFinite(Number(value)) ? "—" : fmtSal(Number(value));
}

// Use the API estimate, never infer it from a grade or convert missing values to zero.
export function rosterDifference(row) {
  if (rosterMoney(row?.salary) === "—" || rosterMoney(row?.fair_value) === "—") return null;
  return Number(row.salary) - Number(row.fair_value);
}

export function rosterDifferenceLabel(row) {
  const delta = rosterDifference(row);
  if (delta == null) return ROSTER_BOARD_COPY.unavailable;
  if (delta === 0) return "At estimate";
  return `${fmtSal(Math.abs(delta))} ${delta < 0 ? "below" : "above"}`;
}

export function rosterContractLabel(row) {
  const n = row?.years_remaining ?? row?.contract_years;
  const years = n == null || n === "" ? "" : `${n} year${Number(n) === 1 ? "" : "s"}`;
  const types = { veteran: "Vet deal", rookie: "Rookie deal", extension: "Extension", fa: "Free agent" };
  const type = types[row?.contract_type] || row?.contract_type || "";
  return joinFacts([years, type]) || ROSTER_BOARD_COPY.unknownContract;
}

export function rosterRowKey(row) {
  return `${row.ownerTeamId}:${row.player_id || row.player_name}`;
}

export function rosterBoardRows(blocks, { view = "deals", teamId = "", query = "", position = "", value = "all", sort = "difference" } = {}) {
  const needle = query.trim().toLowerCase();
  const rows = (blocks || []).flatMap(block => activeRoster(block).map(row => ({ ...row, ownerTeam: block.team, ownerTeamId: block.team?.id || "" })));
  return rows.filter(row => {
    const delta = rosterDifference(row);
    if (view === "deals" && (delta == null || delta === 0)) return false;
    if (teamId && row.ownerTeamId !== teamId) return false;
    if (position && row.position !== position) return false;
    if (value === "below" && !(delta != null && delta < 0)) return false;
    if (value === "above" && !(delta != null && delta > 0)) return false;
    return !needle || `${row.player_name} ${row.team || ""}`.toLowerCase().includes(needle);
  }).sort((a,b) => {
    if (sort === "name") return String(a.player_name).localeCompare(String(b.player_name));
    const av = sort === "salary" ? (rosterMoney(a.salary) === "—" ? -Infinity : Number(a.salary)) : (rosterDifference(a) == null ? -Infinity : Math.abs(rosterDifference(a)));
    const bv = sort === "salary" ? (rosterMoney(b.salary) === "—" ? -Infinity : Number(b.salary)) : (rosterDifference(b) == null ? -Infinity : Math.abs(rosterDifference(b)));
    return (av === bv ? 0 : av > bv ? -1 : 1) || String(a.player_name).localeCompare(String(b.player_name));
  });
}
