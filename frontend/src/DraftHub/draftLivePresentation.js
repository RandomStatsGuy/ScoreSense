/** Live auction / mock room copy. */

import { fmtSal } from "./rosterFormat.js";

export const draftLiveCopy = {
  soldStamp: "SOLD",
  soldLabel: "Sold",
  highBid: "High bid",
  highBidder: "High bidder",
  openingBid: "Opening bid",
  waitingFirstBid: "Waiting for first bid…",
  onTheBlock: "On the block",
  winner: "Winner",
  vsFair: "vs fair",
  yourTurnToNominate: "Your turn to nominate",
  yourPick: "Your pick",
  waitingFor: "Waiting for",
  onTheClock: "On the clock",
  nextPrefix: "Next",
  paused: "Paused",
  leftover: "left",
  maxBid: "max",
  nominate: "Nominate",
  pick: "Pick",
  forceNominate: "Force nominate",
  forcePick: "Force pick",
  resume: "Resume",
  pause: "Pause",
  watch: "Watch",
  watching: "Watching",
  queue: "Queue",
  floor: "Low estimate",
  suggested: "Suggested",
  ceiling: "High estimate",
  searchNominate: "Search for a player to nominate…",
  searchPlayer: "Search player or team",
  offlineJob: "No clocks. Record the next win.",
  record: "Record",
  nominatePaused: "Draft paused",
  connectionLive: "Realtime connection is up",
  connectionDelay: "Draft updates may be delayed",
};

export function waitingForName(name) {
  return `${draftLiveCopy.waitingFor} ${name || "the next manager"}`;
}

export function nominationJobLine({
  picking = false,
  isMyTurn = false,
  nominatorName = "",
  paused = false,
  offline = false,
} = {}) {
  if (offline) {
    return paused ? `${draftLiveCopy.paused} · ${draftLiveCopy.offlineJob}` : draftLiveCopy.offlineJob;
  }
  const job = picking
    ? (isMyTurn ? draftLiveCopy.yourPick : `${draftLiveCopy.onTheClock}: ${nominatorName || "a team"}`)
    : (isMyTurn ? draftLiveCopy.yourTurnToNominate : waitingForName(nominatorName));
  return paused ? `${draftLiveCopy.paused} · ${job}` : job;
}

export function nominateDisabledReason({
  paused = false,
  canDraft = false,
  nominatorName = "",
} = {}) {
  if (paused) return draftLiveCopy.nominatePaused;
  if (!canDraft) return waitingForName(nominatorName);
  return "";
}

export function poolSearchPlaceholder({ canDraft = false, pickDraft = false, offline = false } = {}) {
  if (offline) return draftLiveCopy.searchPlayer;
  return canDraft && !pickDraft ? draftLiveCopy.searchNominate : draftLiveCopy.searchPlayer;
}

export function watchLabel(watching) {
  return watching ? draftLiveCopy.watching : draftLiveCopy.watch;
}

export function nextOwnerLine(name) {
  return name ? `${draftLiveCopy.nextPrefix} ${name}` : "";
}

export function poolRowIsPrimary({ playerId, primaryRowId, canDraft = false } = {}) {
  const id = String(playerId || "");
  return Boolean(canDraft && id && id === String(primaryRowId || ""));
}

/** Queue lives on the pool rail during empty nomination — do not keep that tab selected. */
export function activityDockTab(tab, { poolStage = false } = {}) {
  if (poolStage && tab === "queue") return "";
  return tab || "";
}

export function soldPriceLine({ amount, fair } = {}) {
  const price = Number(amount);
  const market = Number(fair);
  if (!Number.isFinite(price)) return "";
  if (!Number.isFinite(market) || market <= 0) return `${fmtSal(price)} won`;
  const delta = price - market;
  if (delta <= -1) return `${fmtSal(price)} · ${fmtSal(Math.abs(delta))} under fair`;
  if (delta >= 1) return `${fmtSal(price)} · ${fmtSal(delta)} over fair`;
  return `${fmtSal(price)} · at fair ${fmtSal(market)}`;
}

export function soldTone({ amount, fair } = {}) {
  const price = Number(amount);
  const market = Number(fair);
  if (!Number.isFinite(price) || !Number.isFinite(market) || market <= 0) return "fair";
  if (price + 0.5 < market) return "discount";
  if (price - 0.5 > market) return "reach";
  return "fair";
}

export function auctionViewerGradeCopy({
  steals = 0,
  reaches = 0,
  leftover = 0,
  spent = 0,
  cap = 200,
} = {}) {
  const stealN = Number(steals) || 0;
  const reachN = Number(reaches) || 0;
  const left = Number(leftover) || 0;
  const paid = Number(spent) || 0;
  const room = Number(cap) || 200;
  const spentPct = room > 0 ? paid / room : 0;

  if (reachN >= 4 && left < 15) {
    return {
      grade: "B−",
      summary: "You bought the room, then ran out.",
    };
  }
  if (stealN >= 3 && reachN <= 1) {
    return {
      grade: "A−",
      summary: "You waited, then took the discounts.",
    };
  }
  if (reachN >= 2 && stealN >= 2) {
    return {
      grade: "B",
      summary: "Steals paid for the reaches.",
    };
  }
  if (left >= 40 && spentPct < 0.7) {
    return {
      grade: "C+",
      summary: "Cap left on the table, stars left on the board.",
    };
  }
  if (reachN === 0 && stealN === 0) {
    return {
      grade: "B",
      summary: "Fair prices. No drama, no wreckage.",
    };
  }
  if (reachN > stealN) {
    return {
      grade: "B−",
      summary: `${reachN} reach${reachN === 1 ? "" : "es"} — hope the projection catches up.`,
    };
  }
  return {
    grade: "B+",
    summary: `${stealN} steal${stealN === 1 ? "" : "s"} · ${reachN} reach${reachN === 1 ? "" : "es"}.`,
  };
}
