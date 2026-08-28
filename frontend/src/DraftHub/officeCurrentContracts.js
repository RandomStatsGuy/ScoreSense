/**
 * Live contracts (Roster management → Contracts / /hub/office/current).
 * Salary + years on this page are the live roster_slot values — pre-draft
 * semantics until the commissioner marks the draft complete.
 */

/** Match a live roster row to a ?player= deep-link (GSIS or Sleeper id). */
export function matchLiveRosterPlayer(row, rawId) {
  const id = String(rawId || "").trim().replace(/^sleeper-/i, "");
  if (!id || !row) return false;
  const candidates = [row.player_id, row.sleeper_player_id]
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  for (const pid of candidates) {
    if (pid === id) return true;
  }
  // Suffix match for GSIS vs sleeper-prefixed ids; require 6+ chars so a
  // short sleeper id like "9" does not match 00-0039139.
  if (id.length < 6) return false;
  for (const pid of candidates) {
    if (pid.endsWith(id) || (pid.length >= 6 && id.endsWith(pid))) return true;
  }
  return false;
}

/** First team block that contains the deep-linked player, or null. */
export function findLiveContractTarget(teams, rawId) {
  const id = String(rawId || "").trim();
  if (!id) return null;
  for (const block of teams || []) {
    const row = (block.roster || []).find((r) => matchLiveRosterPlayer(r, id));
    if (row) return { teamId: block.team?.id || "", row, block };
  }
  return null;
}

/** Tooltip / column hint for live roster salary — not Historic year-sheet copy. */
export function liveRosterSalaryHint(season, draftCompleted) {
  const y = season != null && String(season).trim() ? String(season) : "this";
  if (draftCompleted) {
    return (
      `${y} cap hit after the ${y} draft year tick `
      + "(veteran/extension salaries already stepped where applicable)."
    );
  }
  return (
    `${y} cap hit for the upcoming season (pre-draft). `
    + `Years left include ${y}; they drop by 1 only when the draft is marked complete.`
  );
}

/** One-line intro under Live contracts. */
export function liveContractsIntroHint(season, draftCompleted) {
  const y = season != null && String(season).trim() ? String(season) : "this season";
  if (draftCompleted) {
    return `Keepers for ${y} after the draft year tick. Add missing players here.`;
  }
  return (
    `Pre-draft keepers for ${y}. Salary is the ${y} cap hit; `
    + `years left include ${y}. Add missing players here.`
  );
}

export function liveContractCapHitBlurb(season, draftCompleted) {
  const y = season != null && String(season).trim() ? String(season) : "this";
  if (draftCompleted) {
    return `Cap hit is the ${y} season salary after the draft year tick.`;
  }
  return `Cap hit is the upcoming ${y} season (pre-draft), not a post-draft year tick.`;
}
