/** Insights sub-tab config — analytics only (Desk moved to Office). */

export const INSIGHTS_TABS = [
  { id: "overview", label: "Overview", roles: ["owner", "commissioner"] },
  { id: "cap", label: "Spend", roles: ["owner", "commissioner"], salaryOnly: true },
  { id: "scoring", label: "Scoring", roles: ["owner", "commissioner"] },
  { id: "ownership", label: "History", roles: ["owner", "commissioner"] },
];

/** Legacy tab ids from old URLs. */
export const INSIGHT_TAB_ALIASES = {
  salaries: "cap",
  contracts: "cap",
  desk: "cap",
};

export function normalizeInsightTab(tabId) {
  return INSIGHT_TAB_ALIASES[tabId] || tabId;
}

/** Mirrors officeUsesContracts in hubOfficeTabs.js — unknown means salary league. */
function insightsUseSalaries(capabilities) {
  if (!capabilities) return true;
  return capabilities.uses_salaries !== false;
}

export function isInsightTabAllowed(tabId, isCommissioner, capabilities) {
  const id = normalizeInsightTab(tabId);
  if (!id) return false;
  const tab = INSIGHTS_TABS.find((t) => t.id === id);
  if (!tab) return false;
  if (tab.salaryOnly && !insightsUseSalaries(capabilities)) return false;
  return true;
}

export function visibleInsightsTabs(isCommissioner, capabilities) {
  const role = isCommissioner ? "commissioner" : "owner";
  return INSIGHTS_TABS.filter((t) => {
    if (!t.roles.includes(role)) return false;
    if (t.salaryOnly && !insightsUseSalaries(capabilities)) return false;
    return true;
  });
}

export function defaultInsightTab(isCommissioner, capabilities) {
  return visibleInsightsTabs(isCommissioner, capabilities)[0]?.id || "overview";
}
