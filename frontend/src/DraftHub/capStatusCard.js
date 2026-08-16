import { fmtSal } from "./rosterFormat.js";

/**
 * Single decision figure for Cap planner (SCORE-19).
 * Returns null when remaining is missing/non-finite.
 */
export function buildCapStatusCard({
  remaining,
  spent,
  salaryCap,
  rosterSize,
  deadCap = 0,
  preDraft = false,
} = {}) {
  if (remaining == null || remaining === "") return null;
  const rem = Number(remaining);
  if (!Number.isFinite(rem)) return null;

  const abs = Math.abs(rem);
  let tone = "under";
  let headline;
  if (rem < -0.005) {
    tone = "over";
    headline = `You are ${fmtSal(abs)} over cap`;
  } else if (Math.abs(rem) < 0.005) {
    tone = "at";
    headline = "You are at the cap";
  } else {
    headline = `You are ${fmtSal(rem)} under cap`;
  }

  const metaParts = [];
  if (Number.isFinite(Number(spent)) && Number.isFinite(Number(salaryCap))) {
    metaParts.push(`${fmtSal(spent)} of ${fmtSal(salaryCap)} committed`);
  } else if (Number.isFinite(Number(spent))) {
    metaParts.push(`${fmtSal(spent)} committed`);
  }
  if (rosterSize != null && rosterSize !== "") {
    metaParts.push(`${rosterSize} player${Number(rosterSize) === 1 ? "" : "s"}`);
  }
  if (Number(deadCap) > 0) {
    metaParts.push(`${fmtSal(deadCap)} dead cap`);
  }

  return {
    tone,
    headline,
    meta: metaParts.join(" · "),
    remaining: rem,
    label: preDraft ? "This season" : "Auction budget",
  };
}
