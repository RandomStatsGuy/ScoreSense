export const FANTASY_CHAT_COPY = {
  eyebrow: "League chat",
  titleFallback: "League chat",
  context: "Everyone in the league",
  leagueChat: "League chat",
  openConversation: "Open conversation",
  closeConversation: "Close conversation",
  openChat: "Open league chat",
  closeChat: "Close league chat",
  dismissLauncher: "Hide league chat",
  restoreLauncher: "Show league chat",
  holdToHide: "Hold to hide chat",
  hideBubble: "Hide chat bubble",
  minimize: "Minimize chat",
  direct: "Direct",
  staff: "Staff",
  staffOnly: "Commissioners only",
  league: "League",
  directTitle: "Your direct messages",
  newDirect: "Message a manager",
  noManagers: "No other managers have joined yet.",
  noMessages: "No messages yet — say hello.",
  loading: "Loading messages…",
  send: "Send",
  sending: "Sending…",
  messageLeague: "Message your league…",
  messageStaff: "Message commissioners…",
  messageDirect: (name) => `Message ${name}…`,
  mention: "Mention a league manager",
  react: "Add a reaction",
  addEmoji: "Add emoji",
  composerHint: "@ to mention a manager · Enter to send",
  clear: "Clear chat",
  settings: "Notification settings",
  notifications: "Notifications",
  notificationsTitle: "Your notifications",
  notificationsSubtitle: "Choose what gets your attention",
  onSite: "These alerts appear while you’re on ScoreSense.",
  alertKinds: "On-site alerts",
  chatBubble: "Chat bubble",
  showBubble: "Show chat bubble",
  restoreHint: "Restore it here after hiding it.",
  badgeHint: "Unread chats still count on the bubble when message alerts are off.",
  allRead: "All caught up.",
  markRead: "Mark all read",
  noAlerts: "No notifications yet.",
  reviewTrade: "Review trade",
  openMessage: "Open message",
  dismissAlert: "Dismiss notification",
  retry: "Retry",
  saved: "Saved",
  members: "Managers in your league",
};

export const CHAT_REACTIONS = ["👍", "😂", "🔥", "👀", "🤝", "❤️"];
export const CHAT_HOLD_MS = 600;
export const CHAT_NOTIFICATION_OPTIONS = [
  { id: "trade", label: "Trade offers & responses", hint: "When a trade needs your attention." },
  { id: "direct", label: "Direct messages", hint: "Messages sent just to you." },
  { id: "mention", label: "@mentions", hint: "When a manager mentions you." },
  { id: "league", label: "League messages", hint: "Off by default. The bubble still counts unread." },
];

export function chatInitials(name) {
  return String(name || "Manager").trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase();
}

export function matchingChatMembers(members, query, ownTeamId) {
  const needle = String(query || "").toLowerCase();
  return (members || []).filter(member => member.id !== ownTeamId
    && `${member.name} ${member.team_name || ""}`.toLowerCase().includes(needle)).slice(0, 6);
}

export function messageMentionIds(text, members) {
  return (members || []).filter(member => {
    const escaped = member.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\w])@${escaped}(?!\\w)`, "i").test(text);
  }).map(member => member.id);
}

export function unreadChatLabel(count) {
  return count > 99 ? "99+" : String(count);
}

export function incomingSiteAlerts(notifications, seenIds, preferences) {
  return (notifications || []).filter(item => !seenIds.has(item.id)
    && !item.read_at && preferences?.[item.kind] === true);
}

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

export function normalizeChatLauncherEdge(edge, { mobile = false } = {}) {
  if (CHAT_EDGES.includes(edge)) return edge;
  return mobile ? "bottom" : "right";
}

export function readChatLauncherEdge(storage = defaultSessionStorage(), { mobile = false } = {}) {
  try {
    const stored = storage?.getItem(CHAT_LAUNCHER_EDGE_KEY);
    if (stored) return normalizeChatLauncherEdge(stored, { mobile });
    return mobile ? "bottom" : "right";
  } catch {
    return mobile ? "bottom" : "right";
  }
}

export function writeChatLauncherEdge(edge, storage = defaultSessionStorage()) {
  const next = normalizeChatLauncherEdge(edge, { mobile: false });
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

/** Visible poll stays tight. Hidden tabs back off so Home's "network quiet" is not a 12s chat loop. */
export const CHAT_POLL_MS = 12_000;
export const CHAT_POLL_COMPACT_MS = 4_000;
export const CHAT_POLL_HIDDEN_MS = 60_000;

export function chatPollMs({ compact = false, hidden = false } = {}) {
  if (hidden) return CHAT_POLL_HIDDEN_MS;
  return compact ? CHAT_POLL_COMPACT_MS : CHAT_POLL_MS;
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
