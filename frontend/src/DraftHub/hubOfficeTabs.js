/** Commissioner workspace sub-tab config — Chat for all members; admin panes for commissioners. */

export const OFFICE_TABS = [
  { id: "chat", label: "Chat", group: "chat", roles: ["owner", "commissioner"] },
  { id: "current", label: "Contracts", group: "contracts", roles: ["commissioner"] },
  { id: "historic", label: "Sheets", group: "contracts", roles: ["commissioner"] },
  { id: "members", label: "Members", group: "membership", roles: ["commissioner"] },
  { id: "access", label: "Access", group: "access", roles: ["commissioner"] },
];

/** Legacy Insights desk URLs → Commissioner panes. */
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
