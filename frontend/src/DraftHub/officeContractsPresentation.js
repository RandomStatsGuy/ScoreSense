/**
 * Roster management · Contracts copy and pending-write helpers.
 */
import { isRetainedThroughDraft } from "./draftRoomHelpers.js";
import {
  contractDeadCapStory,
  dealCanTakeExtension,
  fmtSal,
  pendingForRow,
  preDraftCutDeadCap,
  rosterSlotKey,
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
  queueDrop: "Drop — no dead cap",
  undoDrop: "Undo drop",
  dropNow: "Drop",
  dropConfirmLabel: "Queue drop",
  dropConfirmNow: "Drop",
  acquired: "Acquired",
  acquiredAuction: "Auction",
  acquiredFaLottery: "FA lottery",
  bidLabel: "Winning bid",
  bidSupport: "Winning bid. Writes the live roster Rosters reads.",
  expiredToFa: "Expired to FA",
  expiredToFaSupport:
    "These deals ticked to zero. They do not occupy leftover. Drop removes them from this roster.",
  liveEditNote: "Roster management live edit",
  liveSaved: "Saved. Rosters now matches this contract.",
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
  extendToKeep: "Extend to keep",
  expiring: "Expiring",
};

export const OFFICE_ACQUIRED_OPTIONS = [
  { value: "draft", label: OFFICE_CONTRACTS_COPY.acquiredAuction },
  { value: "post_draft_fa", label: OFFICE_CONTRACTS_COPY.acquiredFaLottery },
];

export function isExpiredToFaRow(row) {
  if (!row) return false;
  const status = String(row.roster_status || "active");
  if (status === "cut_before_draft") return false;
  if (status === "expired") return true;
  return rowYears(row) < 1;
}

export function isLiveOfficeRow(row) {
  if (!row) return false;
  if (String(row.roster_status || "active") === "cut_before_draft") return false;
  return !isExpiredToFaRow(row);
}

export function partitionOfficeRoster(roster = []) {
  const live = [];
  const expired = [];
  const cuts = [];
  for (const row of roster || []) {
    const status = String(row?.roster_status || "active");
    if (status === "cut_before_draft") {
      cuts.push(row);
      continue;
    }
    if (isExpiredToFaRow(row)) expired.push(row);
    else live.push(row);
  }
  return { live, expired, cuts };
}

export function contractStateChip({
  rosterStatus,
  yearsLeft,
  contractType,
  draftCompleted,
  queuedDrop = false,
  rules = null,
} = {}) {
  if (queuedDrop) return { label: "Drop queued", tone: "cut" };
  if (rosterStatus === "cut_before_draft") return { label: "Cut", tone: "cut" };
  if (!draftCompleted && Number(yearsLeft) <= 1) {
    if (dealCanTakeExtension(contractType, rules)) {
      return { label: OFFICE_CONTRACTS_COPY.extendToKeep, tone: "keep" };
    }
    return { label: OFFICE_CONTRACTS_COPY.expiring, tone: "warn" };
  }
  return null;
}

export function contractStateClass(tone) {
  return `hub-roster-status hub-roster-status--${tone || "ok"}`;
}

export function cutButtonCopy(row, rules, { queuedCut = false, draftCompleted = false } = {}) {
  const isCut = queuedCut || row?.roster_status === "cut_before_draft";
  const name = row?.player_name || "player";
  if (isCut) {
    if (row?.can_undo_cut === false) {
      const owner = row.claimed_by_owner;
      return {
        label: "Undo cut is closed",
        ariaLabel: `Undo cut of ${name} is closed`,
        disabled: true,
        support: owner
          ? `They're on ${owner}'s roster.`
          : "They're on another roster.",
      };
    }
    return {
      label: "Undo cut",
      ariaLabel: `Undo cut of ${name}`,
    };
  }
  const story = contractDeadCapStory({ ...row, roster_status: "active" }, rules);
  return {
    label: `Cut · +${fmtSal(story.freed)} room, ${fmtSal(story.dead)} dead`,
    ariaLabel: draftCompleted
      ? `Cut ${name} with dead cap`
      : `Queue cut of ${name} before draft`,
  };
}

export function cutConfirmCopy(row, rules) {
  const name = row?.player_name || "this player";
  const story = contractDeadCapStory({ ...row, roster_status: "active" }, rules);
  return {
    title: `Cut ${name}?`,
    message: (
      `Frees ${fmtSal(story.freed)} leftover. Dead cap ${fmtSal(story.dead)}. `
      + "Drop if you meant no penalty."
    ),
    confirmLabel: "Cut",
  };
}

export function dropLeftoverFreed(row, draftCompleted = false) {
  if (!row || !isRetainedThroughDraft(row, draftCompleted)) return 0;
  const salary = Number(row.salary);
  return Number.isFinite(salary) ? salary : 0;
}

export function dropButtonCopy(row, { queuedDrop = false, draftCompleted = false } = {}) {
  if (queuedDrop) {
    return {
      label: OFFICE_CONTRACTS_COPY.undoDrop,
      ariaLabel: `Undo queued drop of ${row?.player_name || "player"}`,
    };
  }
  const name = row?.player_name || "player";
  if (draftCompleted) {
    return {
      label: OFFICE_CONTRACTS_COPY.dropNow,
      ariaLabel: `Drop ${name} with no dead cap`,
    };
  }
  const freed = dropLeftoverFreed(row, draftCompleted);
  return {
    label: freed
      ? `Drop · +${fmtSal(freed)} leftover, $0 dead`
      : OFFICE_CONTRACTS_COPY.queueDrop,
    ariaLabel: `Queue drop of ${name} with no dead cap`,
  };
}

export function dropConfirmCopy(row, { draftCompleted = false } = {}) {
  const name = row?.player_name || "this player";
  const freed = dropLeftoverFreed(row, draftCompleted);
  const leftoverLine = freed
    ? ` Leftover goes up ${fmtSal(freed)}.`
    : "";
  return {
    title: `Drop ${name}?`,
    message: `Removes ${name} from this team.${leftoverLine} No dead cap. Cut if you meant a penalty.`,
    confirmLabel: draftCompleted
      ? OFFICE_CONTRACTS_COPY.dropConfirmNow
      : OFFICE_CONTRACTS_COPY.dropConfirmLabel,
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

export function teamCapStats(block, salaryCap, rules, draftCompleted = false) {
  const parts = partitionOfficeRoster(block?.roster);
  const occupying = (block?.roster || []).filter((r) => (
    isRetainedThroughDraft(r, draftCompleted)
  ));
  const cuts = parts.cuts;
  const committed = occupying.reduce((sum, r) => sum + Number(r.salary || 0), 0);
  const deadCap = cuts.reduce((sum, r) => sum + preDraftCutDeadCap(r, rules), 0);
  const cap = Number(salaryCap) || 200;
  const playerCount = draftCompleted ? parts.live.length : activeRoster(block?.roster).length;
  return {
    committed,
    deadCap,
    remaining: cap - committed - deadCap,
    cap,
    playerCount,
    cutCount: cuts.length,
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
  const key = rosterSlotKey(baseline) || playerId;
  const cur = { ...(prev[key] || prev[playerId] || { playerId }), ...patch, playerId };
  if (patch.drop === false) delete cur.drop;
  const next = { ...prev };
  if (pendingMatchesBaseline(cur, baseline)) delete next[key];
  else next[key] = cur;
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
    .filter((r) => !pendingForRow(pendingByPlayer, r)?.drop)
    .map((r) => applyPendingToRow(r, pendingForRow(pendingByPlayer, r)));
  return { ...block, roster };
}

export function summarizePending(teams, pendingByPlayer, salaryCap, rules, draftCompleted = false) {
  const items = Object.values(pendingByPlayer || {});
  let capImpact = 0;
  for (const block of teams || []) {
    const before = teamCapStats(block, salaryCap, rules, draftCompleted).remaining;
    const after = teamCapStats(
      applyPendingToBlock(block, pendingByPlayer), salaryCap, rules, draftCompleted,
    ).remaining;
    capImpact += after - before;
  }
  return {
    count: items.length,
    capImpact,
    dropCount: items.filter((p) => p.drop).length,
    cutCount: items.filter((p) => !p.drop && p.rosterStatus === "cut_before_draft").length,
  };
}

export function salaryRoomForRow(block, pendingByPlayer, row, salaryCap, rules, draftCompleted = false) {
  const others = { ...(pendingByPlayer || {}) };
  const key = rosterSlotKey(row) || row.player_id;
  const cur = { ...(pendingForRow(others, row) || { playerId: row.player_id }) };
  delete cur.salary;
  others[key] = cur;
  const stats = teamCapStats(
    applyPendingToBlock(block, others), salaryCap, rules, draftCompleted,
  );
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

export function validatePendingForTeam(block, pendingByPlayer, salaryCap, rules, draftCompleted = false) {
  const errors = [];
  for (const row of block?.roster || []) {
    const pending = pendingByPlayer[row.player_id];
    if (!pending || pending.drop) continue;
    if (pending.salary != null) {
      const max = salaryRoomForRow(
        block, pendingByPlayer, row, salaryCap, rules, draftCompleted,
      );
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
  const before = teamCapStats(block, salaryCap, rules, draftCompleted);
  const after = teamCapStats(
    applyPendingToBlock(block, pendingByPlayer), salaryCap, rules, draftCompleted,
  );
  if (after.remaining < 0 && after.remaining < before.remaining - 0.005) {
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
