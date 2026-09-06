/** Pure helpers for live-auction theater on the block card. */

export const SOLD_HOLD_MS = 1000;
export const BID_PULSE_MS = 150;

export function clockUrgency(seconds, { paused = false } = {}) {
  if (paused || seconds == null || !Number.isFinite(Number(seconds))) return "idle";
  const n = Number(seconds);
  if (n <= 5) return "urgent";
  if (n <= 10) return "late";
  return "ok";
}

export function clockRingOffset(seconds, duration, circumference) {
  const total = Number(duration);
  const left = Number(seconds);
  const circ = Number(circumference);
  if (!Number.isFinite(circ) || circ <= 0) return 0;
  if (!Number.isFinite(total) || total <= 0) return circ;
  if (!Number.isFinite(left) || left <= 0) return circ;
  const ratio = Math.min(1, Math.max(0, left / total));
  return circ * (1 - ratio);
}

export function shouldHoldSoldCard({ simulating = false, pickDraft = false, event = null } = {}) {
  if (simulating || pickDraft) return false;
  return event?.event_type === "win";
}

/**
 * Event ticks after a win are usually bids/noms, not a new award.
 * Keep the current hold so a decoupled timer can expire it.
 * Clear only when the room leaves live-auction theater.
 */
export function soldHoldDecision({
  lastAward = null,
  simulating = false,
  pickDraft = false,
} = {}) {
  if (simulating || pickDraft) return "clear";
  if (!lastAward) return "keep";
  if (shouldHoldSoldCard({ simulating, pickDraft, event: lastAward })) return "set";
  return "keep";
}

export function positionChipTone({ count = 0, min = 0, max = null } = {}) {
  const n = Number(count) || 0;
  const floor = Number(min) || 0;
  const ceiling = max == null || max === "" || max === "—" ? null : Number(max);
  if (Number.isFinite(ceiling) && n > ceiling) return "over";
  if (n > 0 && n >= floor && (ceiling == null || n <= ceiling)) return "filled";
  return "empty";
}

export function pinAuctionStage({
  pickDraft = false,
  nominee = null,
  soldHold = null,
  simulating = false,
} = {}) {
  if (pickDraft) return true;
  return Boolean(nominee || soldHold || simulating);
}
