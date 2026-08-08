/** Office sub-tab config — Chat for all members; staff panes for commissioners. */

export const OFFICE_TABS = [
  { id: "chat", label: "Chat", roles: ["owner", "commissioner"] },
  { id: "current", label: "Current", roles: ["commissioner"] },
  { id: "historic", label: "Historic", roles: ["commissioner"] },
  { id: "members", label: "Members", roles: ["commissioner"] },
];

/** Legacy Insights desk URLs → Office panes. */
export const OFFICE_LEGACY_INSIGHT_REDIRECT = {
  desk: "current",
  salaries: "historic",
  contracts: "historic",
};

export function normalizeOfficeTab(tabId) {
  return OFFICE_TABS.some((t) => t.id === tabId) ? tabId : null;
}

export function isOfficeTabAllowed(tabId, isCommissioner) {
  const id = normalizeOfficeTab(tabId);
  if (!id) return false;
  const tab = OFFICE_TABS.find((t) => t.id === id);
  if (!tab) return false;
  const role = isCommissioner ? "commissioner" : "owner";
  return tab.roles.includes(role);
}

export function visibleOfficeTabs(isCommissioner) {
  const role = isCommissioner ? "commissioner" : "owner";
  return OFFICE_TABS.filter((t) => t.roles.includes(role));
}

export function defaultOfficeTab(isCommissioner) {
  return isCommissioner ? "current" : "chat";
}
