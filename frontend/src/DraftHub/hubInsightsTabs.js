/** Insights sub-tab config — role-gated for commissioner-only surfaces. */

export const INSIGHTS_TABS = [
  { id: "cap", label: "Spend", roles: ["owner", "commissioner"] },
  { id: "scoring", label: "Scoring", roles: ["owner", "commissioner"] },
  { id: "ownership", label: "History", roles: ["owner", "commissioner"] },
  { id: "desk", label: "Desk", roles: ["commissioner"] },
];

/** Legacy tab ids from old URLs — map to current tabs. */
export const INSIGHT_TAB_ALIASES = {
  salaries: "desk",
  contracts: "desk",
};

const COMMISSIONER_ONLY = new Set(["desk"]);

export function normalizeInsightTab(tabId) {
  return INSIGHT_TAB_ALIASES[tabId] || tabId;
}

export function isInsightTabAllowed(tabId, isCommissioner) {
  const id = normalizeInsightTab(tabId);
  if (!id) return false;
  if (COMMISSIONER_ONLY.has(id)) return Boolean(isCommissioner);
  return INSIGHTS_TABS.some((t) => t.id === id);
}

export function visibleInsightsTabs(isCommissioner) {
  const role = isCommissioner ? "commissioner" : "owner";
  return INSIGHTS_TABS.filter((t) => t.roles.includes(role));
}

export function defaultInsightTab(isCommissioner) {
  return visibleInsightsTabs(isCommissioner)[0]?.id || "cap";
}
