/**
 * Live contracts (Roster management → Contracts / /hub/office/current).
 * Salary + years on this page are the live roster_slot values — pre-draft
 * semantics until the commissioner marks the draft complete.
 */

export const LIVE_CONTRACT_PHASE = {
  PRE_DRAFT: "pre_draft",
  LIVE_DRAFT: "live_draft",
  AFTER_DRAFT: "after_draft",
};

function seasonLabel(season) {
  return season != null && String(season).trim() ? String(season) : "this";
}

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

/** Pre-draft, live auction, or after the draft year tick. */
export function liveContractPhase({ draftCompleted = false, leagueStatus = "" } = {}) {
  const status = String(leagueStatus || "").toLowerCase();
  if (status === "live") return LIVE_CONTRACT_PHASE.LIVE_DRAFT;
  if (draftCompleted) return LIVE_CONTRACT_PHASE.AFTER_DRAFT;
  return LIVE_CONTRACT_PHASE.PRE_DRAFT;
}

/**
 * Visible year + stage + draft-impact copy for Live contracts.
 * Callers should show this outside collapsed help so the year is obvious.
 */
export function liveContractStage(season, { draftCompleted = false, leagueStatus = "" } = {}) {
  const y = seasonLabel(season);
  const phase = liveContractPhase({ draftCompleted, leagueStatus });
  const yearsHint = (
    "Includes the upcoming season. Years drop by 1 when the commissioner marks draft complete — "
    + "not when the NFL season ends or the planning season advances."
  );

  if (phase === LIVE_CONTRACT_PHASE.LIVE_DRAFT) {
    return {
      phase,
      phaseLabel: "Draft in progress",
      yearLabel: `${y} season`,
      headline: `Editing ${y} keepers while the auction is live`,
      draftImpact: (
        `${y} $ is still committed cap in the room (it reduces remaining draft budget). `
        + `Completing the draft drops years by 1 and steps veteran/extension salaries.`
      ),
      capColumn: `${y} cap`,
      capColumnSub: "in the auction",
      yearsColumn: "Yrs",
      yearsColumnSub: `incl. ${y}`,
      salaryFieldLabel: `${y} cap`,
      yearsFieldLabel: `Yrs (incl. ${y})`,
      capHint: (
        `${y} cap hit in the live auction — committed keepers, not a future year tick.`
      ),
      yearsHint,
      howItWorks: (
        `Cap hit is the ${y} season salary on the live draft board. `
        + `Years include ${y}. Marking the draft complete burns 1 year.`
      ),
      helpSummary: `Draft in progress · ${y} cap · yrs include ${y}`,
      alertVariant: "warn",
    };
  }

  if (phase === LIVE_CONTRACT_PHASE.AFTER_DRAFT) {
    return {
      phase,
      phaseLabel: "After draft",
      yearLabel: `${y} season`,
      headline: `Editing live ${y} contracts — the ${y} draft year tick already ran`,
      draftImpact: (
        `Years already dropped for the ${y} draft. Edits change the live ${y} roster. `
        + `They do not rewind keepers for a future draft — advance the planning season to reopen pre-draft.`
      ),
      capColumn: `${y} cap`,
      capColumnSub: "after year tick",
      yearsColumn: "Yrs",
      yearsColumnSub: "remaining",
      salaryFieldLabel: `${y} cap`,
      yearsFieldLabel: "Yrs remaining",
      capHint: (
        `${y} cap hit after the ${y} draft year tick `
        + "(veteran/extension salaries already stepped where applicable)."
      ),
      yearsHint,
      howItWorks: (
        `Cap hit is the ${y} season salary after the draft year tick.`
      ),
      helpSummary: `After draft · ${y} cap · year tick applied`,
      alertVariant: "info",
    };
  }

  return {
    phase: LIVE_CONTRACT_PHASE.PRE_DRAFT,
    phaseLabel: "Pre-draft",
    yearLabel: `${y} season`,
    headline: `Editing ${y} keeper contracts (pre-draft)`,
    draftImpact: (
      `${y} $ is committed before the auction and comes off that team's draft budget. `
      + `Yrs include ${y} — 1 year left expires to FA at the draft unless extended. `
      + `Marking the draft complete burns 1 year and steps veteran/extension salaries.`
    ),
    capColumn: `${y} cap`,
    capColumnSub: "pre-draft",
    yearsColumn: "Yrs",
    yearsColumnSub: `incl. ${y}`,
    salaryFieldLabel: `${y} cap`,
    yearsFieldLabel: `Yrs (incl. ${y})`,
    capHint: (
      `${y} cap hit for the upcoming season (pre-draft). `
      + `Years left include ${y}; they drop by 1 only when the draft is marked complete.`
    ),
    yearsHint,
    howItWorks: (
      `Cap hit is the upcoming ${y} season (pre-draft), not a post-draft year tick.`
    ),
    helpSummary: `Pre-draft · ${y} cap · yrs include ${y}`,
    alertVariant: "info",
  };
}

export function liveRosterSalaryHint(season, draftCompleted, leagueStatus) {
  return liveContractStage(season, { draftCompleted, leagueStatus }).capHint;
}

export function liveContractsIntroHint(season, draftCompleted, leagueStatus) {
  return liveContractStage(season, { draftCompleted, leagueStatus }).headline;
}

export function liveContractCapHitBlurb(season, draftCompleted, leagueStatus) {
  return liveContractStage(season, { draftCompleted, leagueStatus }).howItWorks;
}
