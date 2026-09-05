/**
 * Roster management · Contracts copy and pending-write helpers.
 */
import {
  contractDeadCapStory,
  fmtSal,
  preDraftCutDeadCap,
} from "./rosterFormat.js";

export const OFFICE_CONTRACTS_COPY = {
  save: "Save",
  discard: "Discard",
  saving: "Saving…",
  saved: "Saved. Every team's cap now matches these contracts.",
  saveBlocked: "Fix the cap errors before saving. Your edits are still here.",
  leaveTitle: "Unsaved contract edits",
  leaveMessage: "Save or discard before leaving. A wrong cut hits every team's cap.",
  leaveDiscard: "Discard",
  leaveStay: "Keep editing",
  overrideTitle: "Save staff overrides",
  overrideMessage: "These edits write the live roster for every team.",
  overrideLabel: "Override reason",
  overridePlaceholder: "Why are you changing these live contracts?",
  overrideConfirm: "Save overrides",
  moreActions: "More",
  queueDrop: "Queue drop — remove from league",
  undoDrop: "Undo drop",
  refreshAction: "Re-import Sleeper rosters",
  refreshSupport:
    "Overwrites staff contract edits on this page with Sleeper's roster. Sync league in the strip is the usual path.",
  changeMapping: "Change team mapping",
  teamPicker: "Team to edit",
  showAll: "Show all teams",
  searchPlayers: "Search players",
  capOver: (room) => `That salary exceeds remaining room (${fmtSal(room)}).`,
  capInvalid: "Cap must be 0 or more.",
  yearsInvalid: "Years must be at least 1.",
  sleeperLinked: (linked, total) => `Sleeper linked · ${linked}/${total} teams`,
};

export function contractStateChip({
  rosterStatus,
  yearsLeft,
  contractType,
  draftCompleted,
  queuedDrop = false,
} = {}) {
  if (queuedDrop) return { label: "Drop queued", tone: "cut" };
  if (rosterStatus === "cut_before_draft") return { label: "Cut", tone: "cut" };
  if (!draftCompleted && Number(yearsLeft) <= 1) {
    if (contractType === "rookie") return { label: "Extend to keep", tone: "keep" };
    return { label: "Expires — FA", tone: "warn" };
  }
  return null;
}

export function contractStateClass(tone) {
  return `hub-roster-status hub-roster-status--${tone || "ok"}`;
}

export function cutButtonCopy(row, rules, { queuedCut = false } = {}) {
  const isCut = queuedCut || row?.roster_status === "cut_before_draft";
  if (isCut) {
    return {
      label: "Undo cut",
      ariaLabel: `Undo cut of ${row?.player_name || "player"}`,
    };
  }
  const story = contractDeadCapStory({ ...row, roster_status: "active" }, rules);
  return {
    label: `Cut · +${fmtSal(story.freed)} room, ${fmtSal(story.dead)} dead`,
    ariaLabel: `Queue cut of ${row?.player_name || "player"} before draft`,
  };
}

export function dropButtonCopy(row, { queuedDrop = false } = {}) {
  if (queuedDrop) {
    return {
      label: OFFICE_CONTRACTS_COPY.undoDrop,
      ariaLabel: `Undo queued drop of ${row?.player_name || "player"}`,
    };
  }
  return {
    label: OFFICE_CONTRACTS_COPY.queueDrop,
    ariaLabel: `Queue drop of ${row?.player_name || "player"} from the league`,
  };
}

export function pendingTraySummary({ count = 0, capImpact = 0, dropCount = 0 } = {}) {
  const changeWord = count === 1 ? "change" : "changes";
  const sign = capImpact > 0 ? "+" : capImpact < 0 ? "−" : "";
  const parts = [
    `${count} ${changeWord}`,
    `${sign}${fmtSal(Math.abs(capImpact))} cap impact`,
  ];
  if (dropCount > 0) {
    parts.push(`${dropCount} ${dropCount === 1 ? "drop" : "drops"}`);
  }
  return parts.join(" · ");
}

export function capFieldFigures({ free, dead }) {
  return `Free ${fmtSal(free)} · dead ${fmtSal(dead)}`;
}

export function salaryInputMax({ remaining, currentSalary, isCut }) {
  const room = Number(remaining) + (isCut ? 0 : Number(currentSalary) || 0);
  if (!Number.isFinite(room) || room < 0) return 0;
  return Math.round(room);
}

function activeRoster(roster) {
  return (roster || []).filter((r) => r.roster_status !== "cut_before_draft");
}

export function teamCapStats(block, salaryCap, rules) {
  const active = activeRoster(block?.roster);
  const cuts = (block?.roster || []).filter((r) => r.roster_status === "cut_before_draft");
  const committed = active.reduce((sum, r) => sum + Number(r.salary || 0), 0);
  const deadCap = cuts.reduce((sum, r) => sum + preDraftCutDeadCap(r, rules), 0);
  const cap = Number(salaryCap) || 200;
  return {
    committed,
    deadCap,
    remaining: cap - committed - deadCap,
    cap,
    playerCount: active.length,
    cutCount: (block?.roster?.length || 0) - active.length,
  };
}

export function rowYears(row) {
  return Number(row?.contract?.years_remaining ?? row?.contract_years ?? 1);
}

export function rowType(row) {
  return String(row?.contract?.contract_type || "veteran");
}

export function rowStatus(row) {
  return row?.roster_status === "cut_before_draft" ? "cut_before_draft" : "active";
}

export function pendingMatchesBaseline(pending, row) {
  if (!pending || !row) return true;
  if (pending.drop) return false;
  const sameSal = pending.salary == null || Number(pending.salary) === Number(row.salary);
  const sameYrs = pending.years == null || Number(pending.years) === rowYears(row);
  const sameType = pending.contractType == null || pending.contractType === rowType(row);
  const sameStatus = pending.rosterStatus == null || pending.rosterStatus === rowStatus(row);
  return sameSal && sameYrs && sameType && sameStatus;
}

export function mergePendingChange(prev, playerId, patch, baseline) {
  const cur = { ...(prev[playerId] || { playerId }), ...patch, playerId };
  if (patch.drop === false) delete cur.drop;
  const next = { ...prev };
  if (pendingMatchesBaseline(cur, baseline)) delete next[playerId];
  else next[playerId] = cur;
  return next;
}

export function applyPendingToRow(row, pending) {
  if (!row || !pending) return row;
  const next = {
    ...row,
    contract: { ...(row.contract || {}) },
  };
  if (pending.salary != null && Number.isFinite(Number(pending.salary))) {
    next.salary = Number(pending.salary);
    next.contract.current_salary = Number(pending.salary);
  }
  if (pending.years != null && Number.isFinite(Number(pending.years))) {
    next.contract_years = Number(pending.years);
    next.contract.years_remaining = Number(pending.years);
  }
  if (pending.contractType) {
    next.contract.contract_type = pending.contractType;
  }
  if (pending.rosterStatus) {
    next.roster_status = pending.rosterStatus;
  }
  if (pending.drop) next.queuedDrop = true;
  return next;
}

export function applyPendingToBlock(block, pendingByPlayer) {
  const roster = (block?.roster || [])
    .filter((r) => !pendingByPlayer[r.player_id]?.drop)
    .map((r) => applyPendingToRow(r, pendingByPlayer[r.player_id]));
  return { ...block, roster };
}

export function summarizePending(teams, pendingByPlayer, salaryCap, rules) {
  const items = Object.values(pendingByPlayer || {});
  let capImpact = 0;
  for (const block of teams || []) {
    const before = teamCapStats(block, salaryCap, rules).remaining;
    const after = teamCapStats(applyPendingToBlock(block, pendingByPlayer), salaryCap, rules).remaining;
    capImpact += after - before;
  }
  return {
    count: items.length,
    capImpact,
    dropCount: items.filter((p) => p.drop).length,
    cutCount: items.filter((p) => !p.drop && p.rosterStatus === "cut_before_draft").length,
  };
}

export function salaryRoomForRow(block, pendingByPlayer, row, salaryCap, rules) {
  const others = { ...(pendingByPlayer || {}) };
  const cur = { ...(others[row.player_id] || { playerId: row.player_id }) };
  delete cur.salary;
  others[row.player_id] = cur;
  const stats = teamCapStats(applyPendingToBlock(block, others), salaryCap, rules);
  const effective = applyPendingToRow(row, cur);
  const isCut = rowStatus(effective) === "cut_before_draft" || Boolean(cur.drop);
  return salaryInputMax({
    remaining: stats.remaining,
    currentSalary: Number(row.salary) || 0,
    isCut,
  });
}

export function validateSalaryValue(nextSalary, max) {
  const sal = Number(nextSalary);
  if (!Number.isFinite(sal) || sal < 0) return OFFICE_CONTRACTS_COPY.capInvalid;
  if (Number.isFinite(max) && sal > max) return OFFICE_CONTRACTS_COPY.capOver(max);
  return "";
}

export function validatePendingForTeam(block, pendingByPlayer, salaryCap, rules) {
  const errors = [];
  for (const row of block?.roster || []) {
    const pending = pendingByPlayer[row.player_id];
    if (!pending || pending.drop) continue;
    if (pending.salary != null) {
      const max = salaryRoomForRow(block, pendingByPlayer, row, salaryCap, rules);
      const message = validateSalaryValue(pending.salary, max);
      if (message) errors.push({ playerId: row.player_id, message });
    }
    if (pending.years != null) {
      const yrs = Number(pending.years);
      if (!Number.isFinite(yrs) || yrs < 1) {
        errors.push({ playerId: row.player_id, message: OFFICE_CONTRACTS_COPY.yearsInvalid });
      }
    }
  }
  const after = teamCapStats(applyPendingToBlock(block, pendingByPlayer), salaryCap, rules);
  if (after.remaining < 0) {
    errors.push({
      teamId: block?.team?.id,
      message: `${block?.team?.name || "This team"} would be ${fmtSal(-after.remaining)} over cap.`,
    });
  }
  return errors;
}

export function findPlayerRow(teams, playerId) {
  for (const block of teams || []) {
    const row = (block.roster || []).find((r) => r.player_id === playerId);
    if (row) return { row, block };
  }
  return null;
}

export function pendingNeedsOverrideNote(pendingByPlayer) {
  return Object.values(pendingByPlayer || {}).some((p) => (
    !p.drop
    && (p.salary != null || p.years != null || p.rosterStatus != null)
  ));
}

export function isLeavingContractsPath(fromPath, toPath) {
  const from = String(fromPath || "");
  const to = String(toPath || "");
  const onContracts = /\/hub\/(roster-management\/contracts|office\/current|office\/?$)/.test(from);
  if (!onContracts) return false;
  return !/\/hub\/(roster-management\/contracts|office\/current)/.test(to);
}
