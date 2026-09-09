/** User-facing copy for the Trades This Week before → after strip. */

import { weekHeroCopy } from "./weekBoard.js";

export const TRADE_WEEK_COPY = {
  eyebrow: "This Week",
  private: "Your starters only.",
  missing: "Week projections are not on the board yet.",
  empty: "Lineups open after the draft.",
};

export function formatWeekPts(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(1);
}

export function tradeWeekDeltaLine(preview) {
  if (!preview?.available) return "";
  const sign = preview.delta > 0 ? "+" : "";
  return `${formatWeekPts(preview.before_p50)} → ${formatWeekPts(preview.after_p50)} (${sign}${formatWeekPts(preview.delta)})`;
}

export function tradeWeekTone(delta) {
  if (delta > 0) return "up";
  if (delta < 0) return "down";
  return "even";
}

function nameList(rows = []) {
  const shown = rows.slice(0, 2).map((row) => row.player_name).filter(Boolean);
  const extra = rows.length - shown.length;
  if (extra > 0) return `${shown.join(", ")} +${extra}`;
  if (shown.length === 2) return `${shown[0]} and ${shown[1]}`;
  return shown[0] || "";
}

export function tradeWeekSupport(preview) {
  const bumped = preview?.bumped_starters || [];
  const lost = preview?.lost_starters || [];
  if (!bumped.length && !lost.length) return TRADE_WEEK_COPY.private;
  if (bumped.length && lost.length) {
    const incoming = bumped[0];
    const outgoing = lost[0];
    return `Incoming ${incoming.position} bumps your ${outgoing.slot || outgoing.position}.`;
  }
  if (bumped.length === 1) return `Incoming ${bumped[0].player_name} starts.`;
  if (bumped.length) return `Incoming ${nameList(bumped)} start.`;
  if (lost.length === 1) return `You lose starting ${lost[0].player_name}.`;
  return `You lose starting ${nameList(lost)}.`;
}

export function tradeWeekEmptyCopy({
  emptyRoster = false,
  projectionsMissing = false,
  draftCompleted = false,
} = {}) {
  if (emptyRoster) {
    return weekHeroCopy({ emptyRoster: true, draftCompleted }).heading;
  }
  if (projectionsMissing) {
    return weekHeroCopy({ poorCoverage: true }).heading;
  }
  return TRADE_WEEK_COPY.missing;
}

export function tradeWeekFaceRows(preview, limit = 2) {
  const rows = [
    ...(preview?.bumped_starters || []),
    ...(preview?.lost_starters || []),
  ];
  return {
    shown: rows.slice(0, limit),
    overflow: Math.max(0, rows.length - limit),
  };
}
