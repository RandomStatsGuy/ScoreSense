/** League-wide roster-management tabs. Persistent chat lives outside this workspace. */

export const OFFICE_TABS = [
  { id: "current", label: "Contracts", group: "rosters", roles: ["commissioner"], salaryOnly: true },
  { id: "historic", label: "Salary sheets", group: "records", roles: ["commissioner"], salaryOnly: true },
  { id: "members", label: "Members", group: "league", roles: ["commissioner"] },
  { id: "access", label: "Access & imports", group: "league", roles: ["commissioner"] },
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

function officeUsesContracts(capabilities) {
  if (!capabilities) return true;
  return capabilities.uses_contracts !== false;
}

export function isOfficeTabAllowed(tabId, isCommissioner, capabilities) {
  const id = normalizeOfficeTab(tabId);
  if (!id) return false;
  const tab = OFFICE_TABS.find((t) => t.id === id);
  if (!tab) return false;
  const role = isCommissioner ? "commissioner" : "owner";
  if (!tab.roles.includes(role)) return false;
  if (tab.salaryOnly && !officeUsesContracts(capabilities)) return false;
  return true;
}

export function visibleOfficeTabs(isCommissioner, capabilities) {
  const role = isCommissioner ? "commissioner" : "owner";
  return OFFICE_TABS.filter((t) => {
    if (!t.roles.includes(role)) return false;
    if (t.salaryOnly && !officeUsesContracts(capabilities)) return false;
    return true;
  });
}

export function defaultOfficeTab(isCommissioner, capabilities) {
  return visibleOfficeTabs(isCommissioner, capabilities)[0]?.id || "members";
}
