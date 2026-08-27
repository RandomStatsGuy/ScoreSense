/** Insights sub-tab config — analytics only (Desk moved to Office). */

export const INSIGHTS_TABS = [
  { id: "overview", label: "Overview", roles: ["owner", "commissioner"] },
  { id: "cap", label: "Spend", roles: ["owner", "commissioner"] },
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

export function isInsightTabAllowed(tabId, isCommissioner) {
  const id = normalizeInsightTab(tabId);
  if (!id) return false;
  return INSIGHTS_TABS.some((t) => t.id === id);
}

export function visibleInsightsTabs(isCommissioner) {
  const role = isCommissioner ? "commissioner" : "owner";
  return INSIGHTS_TABS.filter((t) => t.roles.includes(role));
}

export function defaultInsightTab(isCommissioner) {
  return visibleInsightsTabs(isCommissioner)[0]?.id || "overview";
}
