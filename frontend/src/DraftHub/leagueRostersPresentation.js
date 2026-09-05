/** User-facing copy and deal-finder helpers for Fantasy → Rosters. */

import { fmtSal } from "./rosterFormat.js";
import { playerTradeableInWindow } from "./acquisitionWindow.js";
import { hubTeamLabel, hubTeamParts } from "./hubTeamLabel.js";

export const DEALS_VIEW = "deals";

export const ROSTERS_COPY = {
  eyebrow: "Rosters",
  heading: "Find a deal worth trading for.",
  support:
    "Overpays and cheap years across the league. A cheap year is a trade chip; an overpay is someone else's problem until you take it.",
  proposeTrade: "Propose trade",
  refreshLeague: "Refresh league",
  dealsNav: "Deals",
  dealsHeading: "Overpays and bargains",
  dealsCaption:
    "Every Overpay and Bargain in the league, sorted by how far the salary sits from fair.",
  dealsEmpty: "No overpays or bargains right now — every marketable contract is Fair.",
  dealsHint: "Open a manager to see Fair contracts and the rest of the roster.",
  managersHeading: "Managers",
  emptyRoster: "No active players.",
  addToTrade: "Add to trade",
  tradeFor: "Trade for",
  tradeLocked: "Offseason trades apply only to contracts that survive the next draft.",
  tradeLockedShort: "Survives the draft only",
  extendable: "Extendable",
  expiresFa: "Expires — FA",
  you: "you",
  player: "Player",
  pos: "Pos",
  cap: "Cap",
  years: "Years",
  type: "Type",
  contract: "Contract",
  actions: "Actions",
  glanceEyebrow: "At a glance",
  glanceDealsTitle: "Deals",
  glanceOverpays: "Overpays",
  glanceBargains: "Bargains",
  glanceManagers: "Managers",
  glanceCommitted: "Committed",
  glanceDead: "Dead cap",
  glanceFree: "Free",
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

/** Judgment word alone when the dollar delta is zero; Overpay/Bargain keep vs-fair. */
export function contractGradeText(row) {
  const grade = contractGradeLabel(row?.contract_grade);
  if (!grade) return null;
  if (grade === "Fair" || isZeroDelta(row?.value_delta)) return grade;
  const delta = Number(row.value_delta);
  const signed = `${delta > 0 ? "+" : "−"}${fmtSal(Math.abs(delta))}`;
  const parts = [grade, `(${signed})`];
  if (row.fair_value != null) parts.push(`vs ${fmtSal(row.fair_value)} fair`);
  return parts.join(" ");
}

export function expireChipLabel(chip) {
  if (chip === "extend") return ROSTERS_COPY.extendable;
  if (chip === "fa") return ROSTERS_COPY.expiresFa;
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
  if (facts?.free != null) parts.push(`${fmtSal(facts.free)} free`);
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
