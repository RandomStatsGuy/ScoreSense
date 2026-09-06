/** One-line pool read for the wide nomination stage. */

import { normalizeHubPosition } from "./hubPositions.js";
import { fmtSal } from "./rosterFormat.js";

export function draftPoolWhy(row, { isNeed = false } = {}) {
  const pos = normalizeHubPosition(row?.position) || "this position";
  const fair = Number(row?.fair_value ?? row?.model_bid_hint);
  const lo = Number(row?.min_sal);
  const hi = Number(row?.max_sal);
  const hasRange = Number.isFinite(lo) && Number.isFinite(hi) && hi > 0;
  const range = hasRange ? `${fmtSal(lo)}–${fmtSal(hi)}` : null;

  if (isNeed) {
    return range ? `Need ${pos} · ${range}` : `Need ${pos}`;
  }
  if (Number.isFinite(fair) && fair >= 30) {
    return range ? `Board-top bid · ${range}` : "Board-top bid";
  }
  if (Number.isFinite(fair) && fair >= 12) {
    return range ? `Starter price · ${range}` : "Starter price";
  }
  if (range) return `Depth look · ${range}`;
  return `Depth look at ${pos}`;
}

export function rangeBarPercents(minSal, fair, maxSal) {
  const lo = Number(minSal);
  const mid = Number(fair);
  const hi = Number(maxSal);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  const span = hi - lo;
  const clamped = Number.isFinite(mid) ? Math.min(hi, Math.max(lo, mid)) : lo;
  return {
    start: 0,
    mark: ((clamped - lo) / span) * 100,
  };
}
