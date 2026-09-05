/**
 * Roster-management section helpers (SCORE-21).
 * Groups admin tools and owns Sheets first-use / explanation copy.
 */

export const SHEETS_GUIDE_STORAGE_KEY = "hub.commissioner.sheetsGuide.dismissed";

/** Tab chip groups shown to commissioners. */
export const COMMISSIONER_TAB_GROUPS = [
  { id: "rosters", label: "Rosters" },
  { id: "records", label: "Records" },
  { id: "league", label: "League operations" },
];

export function commissionerIntro(isCommissioner) {
  if (isCommissioner) {
    return {
      title: "Roster management",
      purpose: "Add or cut contracts, edit sheets, and seat managers. A wrong cut here hits every team's cap.",
      audience: "Commissioners and co-commissioners",
    };
  }
  return {
    title: "Roster management",
    purpose: "Commissioner managed. Members cannot edit contracts or seats here.",
    audience: null,
  };
}

export function sheetsDefaultHint() {
  return "Edit Pos, $, Status, and Acquired on the table.";
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
      `${y} sheet = keepers / after-draft roster for ${y} — not a live mid-season snapshot.`,
      "Use Contracts for live keepers and Cap for extend / FA. Sheets reconcile historic year books.",
      "Use Sync league in the strip, or Excel when empty.",
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

/**
 * Insert group labels before the first tab of each commissioner group.
 * @param {Array<{id:string,label:string,group?:string}>} tabs
 */
export function tabsWithGroupLabels(tabs) {
  const out = [];
  let lastGroup = null;
  for (const tab of tabs) {
    const group = tab.group || null;
    if (group && group !== lastGroup) {
      const meta = COMMISSIONER_TAB_GROUPS.find((g) => g.id === group);
      if (meta?.label) {
        out.push({ type: "label", id: `group-${group}`, label: meta.label });
      }
      lastGroup = group;
    }
    out.push({ type: "tab", ...tab });
    if (!group) lastGroup = null;
  }
  return out;
}
