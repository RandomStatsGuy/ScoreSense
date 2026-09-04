export const FANTASY_CHAT_COPY = {
  eyebrow: "League chat",
  titleFallback: "League chat",
  context: "Same thread as Home. Drag the chip to an edge.",
  leagueChat: "League chat",
  openConversation: "Drag to park",
  closeConversation: "Close conversation",
  openChat: "Open league chat",
  closeChat: "Close league chat",
  dismissLauncher: "Hide league chat",
  restoreLauncher: "Show league chat",
};

export const CHAT_LAUNCHER_DISMISS_KEY = "ss_fantasy_chat_dismissed";
export const CHAT_LAUNCHER_EDGE_KEY = "ss_fantasy_chat_edge";
export const CHAT_EDGES = ["left", "right", "top", "bottom"];

function defaultSessionStorage() {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function readChatLauncherDismissed(storage = defaultSessionStorage()) {
  try {
    return storage?.getItem(CHAT_LAUNCHER_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeChatLauncherDismissed(dismissed, storage = defaultSessionStorage()) {
  const hidden = Boolean(dismissed);
  try {
    if (!storage) return hidden;
    if (hidden) storage.setItem(CHAT_LAUNCHER_DISMISS_KEY, "1");
    else storage.removeItem(CHAT_LAUNCHER_DISMISS_KEY);
  } catch {
    /* private mode / blocked storage */
  }
  return hidden;
}

export function normalizeChatLauncherEdge(edge) {
  return CHAT_EDGES.includes(edge) ? edge : "right";
}

export function readChatLauncherEdge(storage = defaultSessionStorage()) {
  try {
    return normalizeChatLauncherEdge(storage?.getItem(CHAT_LAUNCHER_EDGE_KEY));
  } catch {
    return "right";
  }
}

export function writeChatLauncherEdge(edge, storage = defaultSessionStorage()) {
  const next = normalizeChatLauncherEdge(edge);
  try {
    storage?.setItem(CHAT_LAUNCHER_EDGE_KEY, next);
  } catch {
    /* private mode / blocked storage */
  }
  return next;
}

export function nearestChatEdge(x, y, width, height) {
  const w = Number(width) || 1;
  const h = Number(height) || 1;
  return [
    ["left", Number(x) / w],
    ["right", 1 - Number(x) / w],
    ["top", Number(y) / h],
    ["bottom", 1 - Number(y) / h],
  ].sort((a, b) => a[1] - b[1])[0][0];
}

export function hideFantasyChatDock({ hidden = false, house = false } = {}) {
  return Boolean(hidden || house);
}

export function fantasyChatDockClass({
  open = false,
  dismissed = false,
  edge = "right",
  dragging = false,
} = {}) {
  return [
    "fantasy-chat-dock",
    open ? "is-open" : "",
    dismissed && !open ? "is-dismissed" : "",
    dragging ? "is-dragging" : "",
    `is-edge-${normalizeChatLauncherEdge(edge)}`,
  ]
    .filter(Boolean)
    .join(" ");
}
