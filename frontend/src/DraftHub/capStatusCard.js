import { fmtSal } from "./rosterFormat.js";
import { againstCap, capEquationNote } from "./capPlannerPresentation.js";

/**
 * Single decision figure for Cap planner (SCORE-19).
 * Returns null when remaining is missing/non-finite.
 */
export function buildCapStatusCard({
  remaining,
  spent,
  salaryCap,
  rosterSize,
  sheetSize,
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

  const against = againstCap({ spent, deadCap });
  const metaParts = [];
  if (Number.isFinite(Number(salaryCap))) {
    metaParts.push(capEquationNote({ against, leftover: rem, salaryCap }));
  } else if (Number.isFinite(against)) {
    metaParts.push(`${fmtSal(against)} against cap`);
  }
  const keep = rosterSize;
  const sheet = sheetSize;
  if (preDraft && keep != null && keep !== "") {
    metaParts.push(`${keep} keep past this draft`);
  }
  if (sheet != null && sheet !== "" && Number(sheet) !== Number(keep)) {
    metaParts.push(`${sheet} on this sheet`);
  } else if (!preDraft && keep != null && keep !== "") {
    metaParts.push(`${keep} player${Number(keep) === 1 ? "" : "s"}`);
  }

  return {
    tone,
    headline,
    meta: metaParts.join(" · "),
    remaining: rem,
    against,
    label: preDraft ? "This season" : "Auction budget",
  };
}
