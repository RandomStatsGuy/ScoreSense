import { PROJECTIONS_TABS, TOOLS_TABS } from "../appNavigation.js";
import { FANTASY_CHAT_COPY } from "../DraftHub/fantasyChatPresentation.js";

export const MOBILE_CHROME_COPY = {
  goTo: "Go to",
  filters: "Filters",
  leagueChat: FANTASY_CHAT_COPY.leagueChat,
  openChat: FANTASY_CHAT_COPY.openChat,
  closeChat: FANTASY_CHAT_COPY.closeChat,
  projectionsSheet: "Projections",
  toolsSheet: "Tools",
  fantasySheet: "Go to",
  weeklyHint: "This week's floor–ceiling",
  seasonHint: "Season outlook and rest-of-season",
  dfsHint: "Slates, stacks, and exports",
  mockHint: "Practice vs bots",
  bestBallHint: "Season ranks vs ADP",
};

export function chooseDestinationLabel(title) {
  return `${title}, choose destination`;
}

/** Always dismiss the picker, including when the active destination is tapped again. */
export function selectAndDismissDestination(id, onSelect, onClose) {
  onSelect?.(id);
  onClose?.();
}

export function resolveMobileDestination({
  view,
  projectionsTab,
  toolsTab,
  hubTitle,
  hubNeedsSignIn,
} = {}) {
  if (view === "hub") {
    if (hubNeedsSignIn) return { title: "Sign in", picker: null };
    return { title: hubTitle || "Fantasy", picker: "hub" };
  }
  if (view === "projections") {
    const tab = PROJECTIONS_TABS.find((item) => item.id === projectionsTab);
    return { title: tab?.label || "Weekly", picker: "projections" };
  }
  if (view === "tools") {
    const tab = TOOLS_TABS.find((item) => item.id === toolsTab);
    return { title: tab?.label || "Tools", picker: "tools" };
  }
  if (view === "model") return { title: "Model accuracy", picker: null };
  if (view === "admin") return { title: "Admin", picker: null };
  return { title: "ScoreSense", picker: null };
}

export function projectionDestinationItems() {
  return PROJECTIONS_TABS.map((tab) => ({
    id: tab.id,
    label: tab.label,
    hint: tab.id === "weekly" ? MOBILE_CHROME_COPY.weeklyHint : MOBILE_CHROME_COPY.seasonHint,
  }));
}

export function toolDestinationItems() {
  const hints = {
    dfs: MOBILE_CHROME_COPY.dfsHint,
    "mock-draft": MOBILE_CHROME_COPY.mockHint,
    "best-ball": MOBILE_CHROME_COPY.bestBallHint,
  };
  return TOOLS_TABS.map((tab) => ({
    id: tab.id,
    label: tab.label,
    hint: hints[tab.id],
  }));
}
