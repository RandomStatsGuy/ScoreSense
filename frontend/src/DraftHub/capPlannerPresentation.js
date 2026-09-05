/** User-facing copy for Fantasy → Cap. */

export const CAP_MOVE_COPY = {
  title: "After this move",
  hint: "Cut a name or enter a bid. The leftover here updates.",
  cutLabel: "Cut",
  bidLabel: "Bid",
  none: "No cut",
  reset: "Reset",
  now: "Now",
  after: "After",
  leftoverWord: "leftover",
  over: (amount) => `This bid puts you ${amount} over. Cut more or bid less.`,
};

export const CAP_EXTEND_COPY = {
  title: "Extend contract",
  playerLabel: "Player",
  yearsLabel: "Years",
  selectPlayer: "Select player",
  queue: "Queue extension",
};

export const CAP_FIGURE_COPY = {
  leftover: "Leftover",
  againstCap: "Against this cap",
  againstCapHint: "Salary plus dead cap",
  salary: "Salary",
  deadCap: "Dead cap",
  keepPastDraft: "Keep past this draft",
  onThisSheet: "On this sheet",
  rulesHeading: "League rules",
  stepUp: "Annual step-up",
  cutRefund: "Cut refund",
  leagueSpend: "League spend",
  seasonAgainst: "against cap",
  seasonLeftover: "leftover",
};

export const CAP_NEED_COPY = {
  browseFreeAgents: "Browse free agents",
};

export const CAP_MODEL_COPY = {
  years: "Years left include this season and drop when the draft is marked complete.",
  summary: "How cap years work",
};

export const CAP_DRAFT_COPY = {
  markComplete: "Mark draft complete",
  markCompleteRest: "on Roster management · Contracts when the auction ends.",
};

export const CAP_SHEET_COPY = {
  title: "Cap sheet",
  hint: "Cap hit by season. Years with no hits are hidden.",
};

export function leftoverAfterMove({ remaining = 0, cutSalary = 0, cutRefundPct = 0.5, bid = 0 } = {}) {
  const rem = Number(remaining) || 0;
  const salary = Number(cutSalary) || 0;
  const refund = Number.isFinite(Number(cutRefundPct)) ? Number(cutRefundPct) : 0.5;
  const freed = salary * refund;
  const spend = Number(bid) || 0;
  return rem + freed - spend;
}

export function leftoverAfterMoveYears({
  years = [],
  cutHits = [],
  cutRefundPct = 0.5,
  bid = 0,
} = {}) {
  const refund = Number.isFinite(Number(cutRefundPct)) ? Number(cutRefundPct) : 0.5;
  const spend = Number(bid) || 0;
  return years.map((year, idx) => {
    const remaining = Number(year.cap_remaining) || 0;
    const committed = Number(year.total_committed) || 0;
    const hit = Number(cutHits[idx] || 0);
    const nextRemaining = idx === 0
      ? remaining + hit * refund - spend
      : remaining + hit;
    const nextCommitted = idx === 0
      ? committed - hit * refund + spend
      : committed - hit;
    return { ...year, cap_remaining: nextRemaining, total_committed: nextCommitted };
  });
}

export function againstCap({ spent = 0, deadCap = 0 } = {}) {
  return (Number(spent) || 0) + (Number(deadCap) || 0);
}

/** Whole-dollar leftover and against-cap that always sum to the cap. */
export function displayCapPair({ leftover, salaryCap } = {}) {
  const cap = Math.round(Number(salaryCap) || 0);
  const rem = Number(leftover);
  if (!Number.isFinite(rem)) return { leftover: null, against: null, cap };
  const leftoverRounded = Math.round(rem);
  return { leftover: leftoverRounded, against: cap - leftoverRounded, cap };
}

/** Dollars on Cap. Negative leftover is -$12, not $-12. */
export function fmtCapMoney(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const value = Math.round(Number(n));
  return value < 0 ? `-$${Math.abs(value)}` : `$${value}`;
}

/**
 * Apply a cut or bid to the leftover already shown, so Now $123 − $200 bid
 * reads After -$77 — not a second rounding of the raw remaining.
 */
export function leftoverAfterMoveDisplay({
  years = [],
  salaryCap,
  cutHits = [],
  cutRefundPct = 0.5,
  bid = 0,
} = {}) {
  const refund = Number.isFinite(Number(cutRefundPct)) ? Number(cutRefundPct) : 0.5;
  const spend = Math.round(Number(bid) || 0);
  return years.map((year, idx) => {
    const pair = displayCapPair({ leftover: year.cap_remaining, salaryCap: year.salary_cap ?? salaryCap });
    const hit = Number(cutHits[idx] || 0);
    const leftover = idx === 0
      ? (pair.leftover ?? 0) + Math.round(hit * refund) - spend
      : (pair.leftover ?? 0) + Math.round(hit);
    const next = displayCapPair({ leftover, salaryCap: pair.cap });
    return {
      ...year,
      cap_remaining: next.leftover,
      total_committed: next.against,
    };
  });
}

export function capEquationNote({ leftover, salaryCap, against } = {}) {
  const pair = displayCapPair({ leftover, salaryCap });
  const againstN = pair.against ?? Math.round(Number(against) || 0);
  const rem = pair.leftover;
  const leftoverBit = rem != null && rem < 0
    ? `${fmtCapMoney(Math.abs(rem))} over`
    : `${fmtCapMoney(rem ?? leftover)} leftover`;
  return `${fmtCapMoney(againstN)} of ${fmtCapMoney(pair.cap || salaryCap)} against cap · ${leftoverBit}`;
}

export function leftoverMoveReadout({ current, after } = {}) {
  const now = Number(current);
  const next = Number(after);
  if (!Number.isFinite(now) || !Number.isFinite(next)) return null;
  const over = next < -0.005;
  return {
    current: now,
    after: next,
    over,
    overBy: over ? Math.abs(next) : 0,
    changed: Math.abs(next - now) > 0.005,
  };
}

const INACTIVE_ROSTER_STATUSES = new Set([
  "cut",
  "cut_before_draft",
  "waived",
  "traded",
  "expired",
]);

function normalizeNeedPosition(position) {
  const pos = String(position || "").toUpperCase();
  if (pos === "DST") return "DEF";
  return pos;
}

function isActiveNeedRow(row) {
  const status = String(row?.roster_status || "active").toLowerCase();
  return !INACTIVE_ROSTER_STATUSES.has(status);
}

export function parseNeedErrors(errors = []) {
  const needs = [];
  const other = [];
  for (const error of errors) {
    const match = String(error).match(/Need\s+(\d+)\s+more\s+([A-Z]+)/i);
    if (match) {
      const minMatch = String(error).match(/min\s+(\d+)/i);
      needs.push({
        count: Number(match[1]),
        position: match[2].toUpperCase(),
        min: minMatch ? Number(minMatch[1]) : undefined,
      });
    } else {
      other.push(error);
    }
  }
  return { needs, other };
}

/** Per-position shortfall against the current roster, not the floor. */
export function rosterPositionNeeds({ roster = [], limits = {} } = {}) {
  const counts = {};
  for (const row of roster || []) {
    if (!row || !isActiveNeedRow(row)) continue;
    const pos = normalizeNeedPosition(row.position);
    if (!pos) continue;
    counts[pos] = (counts[pos] || 0) + 1;
  }
  const needs = [];
  let minimumTotal = 0;
  for (const [key, lim] of Object.entries(limits || {})) {
    const pos = normalizeNeedPosition(key);
    const min = Number(lim?.min) || 0;
    minimumTotal += min;
    const have = counts[pos] || 0;
    if (min > 0 && have < min) {
      needs.push({ count: min - have, position: pos, min });
    }
  }
  return { needs, minimumTotal };
}

export function rosterNeedLine(needs = [], { minimumTotal } = {}) {
  if (!needs.length) return "";
  const total = needs.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const parts = needs.map((row) => `${row.count} ${row.position}`).join(" · ");
  const floor = Number(minimumTotal);
  if (Number.isFinite(floor) && floor > 0) {
    return `You need ${total} more to reach the ${floor}-player minimum: ${parts}`;
  }
  return `You need ${total} more player${total === 1 ? "" : "s"}: ${parts}`;
}

export function capSheetYearOffsets({ roster = [], yearCount = 0, hitFor } = {}) {
  const offsets = [];
  const getter = typeof hitFor === "function" ? hitFor : () => null;
  for (let offset = 1; offset < yearCount; offset += 1) {
    const any = roster.some((row) => {
      const hit = getter(row, offset);
      return hit != null && Number.isFinite(Number(hit));
    });
    if (any) offsets.push(offset);
  }
  return offsets;
}

export function capRailPrimary({ pendingCut = null, remaining = 0 } = {}) {
  if (pendingCut?.player_name) {
    const dead = Number(pendingCut.dead_cap);
    const salary = Number(pendingCut.salary);
    const deadBit = Number.isFinite(dead) ? `+$${Math.round(dead)} dead` : "+$0 dead";
    const roomBit = Number.isFinite(salary) ? `−$${Math.round(salary)} room` : "−$0 room";
    return {
      kind: "undo-cut",
      label: `Undo cut · ${pendingCut.player_name}`,
      detail: `${deadBit}, ${roomBit}`,
      playerId: pendingCut.player_id,
    };
  }
  const room = Number(remaining);
  const spend = Number.isFinite(room) ? `$${Math.round(room)} to spend.` : "Open the room.";
  return {
    kind: "room",
    label: `Open draft room · ${spend}`,
  };
}

export function positionFromNeedError(error) {
  const match = String(error || "").match(/more\s+([A-Z]+)/i);
  return match ? match[1].toUpperCase() : "";
}

export function formatNeedError(error) {
  return String(error || "")
    .replace(/\s*\(min\s+(\d+)\s*\/\s*max\s+(\d+)\)/i, " · min $1, max $2")
    .replace(/\s*\(min\s+(\d+)\)/i, " · min $1");
}

export function roomAfterBid({ remaining, bid } = {}) {
  const rem = Number(remaining);
  const spend = Number(bid);
  if (!Number.isFinite(rem) || !Number.isFinite(spend)) return null;
  return rem - spend;
}

export function vsCostCell({ preDraft = false, remaining, bid, valueDelta } = {}) {
  if (preDraft) {
    if (bid == null || bid === "") return "—";
    if (!Number.isFinite(Number(bid))) return "—";
    const after = roomAfterBid({ remaining, bid });
    if (after == null) return "—";
    return `Room after: $${Math.round(after)}`;
  }
  if (valueDelta == null || !Number.isFinite(Number(valueDelta))) return "—";
  const n = Number(valueDelta);
  return `${n <= 0 ? "" : "+"}$${Math.round(Math.abs(n))}`;
}

export function capHeroCopy({ empty = false, preDraft = false } = {}) {
  if (empty) {
    return {
      eyebrow: "Cap",
      heading: "Can you afford the bid after the cut?",
      support: "No contracts yet. Add them on My team or leftover cap is a guess.",
    };
  }
  return {
    eyebrow: "Cap",
    heading: "Can you afford the bid after the cut?",
    support: preDraft
      ? "Final-year deals leave unless you extend. Cut the wrong name and you eat dead cap into the draft."
      : "Against this cap is salary plus dead cap. Leftover is what you can still bid.",
  };
}
