/**
 * Roster-management section helpers (SCORE-21).
 * Groups admin tools and owns Sheets first-use / explanation copy.
 */

export const SHEETS_GUIDE_STORAGE_KEY = "hub.commissioner.sheetsGuide.dismissed";

export function commissionerIntro(isCommissioner) {
  if (isCommissioner) {
    return {
      title: "Roster management",
      purpose: "Manage team contracts, salary sheets, and league access.",
      audience: "Commissioners and co-commissioners",
    };
  }
  return {
    title: "Roster management",
    purpose: "Only commissioners can edit contracts and team access here.",
    audience: null,
  };
}

export function sheetsDefaultHint() {
  return "Edit player positions, salaries, status, and acquisition methods in the table.";
}

/**
 * Historic / year-sheet caveats for the explanation panel (not dense default copy).
 * @param {string|number} year
 */
export function sheetsGuideCopy(year) {
  const y = year != null && String(year).trim() ? String(year) : "this year";
  return {
    summary: "What does a year sheet mean?",
    paragraphs: [
      `The ${y} salary sheet records that season's contracts. It may differ from the current roster after trades and player additions.`,
      "Use Contracts for current rosters and Cap for extensions. Use salary sheets to review and correct past-season records.",
      "Use Sync league at the top of the page to update league data, or import a salary sheet.",
    ],
  };
}

/** Whether the Sheets guide should start open (first visit). */
export function shouldAutoOpenSheetsGuide(storage = globalThis.localStorage) {
  try {
    return storage?.getItem?.(SHEETS_GUIDE_STORAGE_KEY) !== "1";
  } catch {
    return true;
  }
}

export function markSheetsGuideSeen(storage = globalThis.localStorage) {
  try {
    storage?.setItem?.(SHEETS_GUIDE_STORAGE_KEY, "1");
  } catch {
    /* ignore quota / private mode */
  }
}
