export const FANTASY_CHAT_COPY = {
  eyebrow: "League conversation",
  titleFallback: "League chat",
  context: "Stays with you while you move through Fantasy.",
  leagueChat: "League chat",
  openConversation: "Open conversation",
  closeConversation: "Close conversation",
  openChat: "Open league chat",
  closeChat: "Close league chat",
  dismissLauncher: "Hide league chat",
  restoreLauncher: "Show league chat",
};

export const CHAT_LAUNCHER_DISMISS_KEY = "ss_fantasy_chat_dismissed";

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

export function fantasyChatDockClass({ open = false, dismissed = false } = {}) {
  return [
    "fantasy-chat-dock",
    open ? "is-open" : "",
    dismissed && !open ? "is-dismissed" : "",
  ]
    .filter(Boolean)
    .join(" ");
}
