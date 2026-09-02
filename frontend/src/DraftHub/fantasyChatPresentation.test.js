import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAT_LAUNCHER_DISMISS_KEY,
  FANTASY_CHAT_COPY,
  fantasyChatDockClass,
  readChatLauncherDismissed,
  writeChatLauncherDismissed,
} from "./fantasyChatPresentation.js";

test("chat copy names the conversation, not Draft Hub", () => {
  const blob = Object.values(FANTASY_CHAT_COPY).join(" ");
  assert.match(blob, /League chat|conversation/i);
  assert.doesNotMatch(blob, /Draft Hub|Submit|permission/i);
});

test("launcher dismiss persists only while the session says so", () => {
  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };

  assert.equal(readChatLauncherDismissed(storage), false);
  assert.equal(writeChatLauncherDismissed(true, storage), true);
  assert.equal(storage.getItem(CHAT_LAUNCHER_DISMISS_KEY), "1");
  assert.equal(readChatLauncherDismissed(storage), true);
  assert.equal(writeChatLauncherDismissed(false, storage), false);
  assert.equal(readChatLauncherDismissed(storage), false);
});

test("dock classes mark the open stage and the dismissed launcher", () => {
  assert.equal(fantasyChatDockClass(), "fantasy-chat-dock");
  assert.equal(fantasyChatDockClass({ open: true }), "fantasy-chat-dock is-open");
  assert.equal(
    fantasyChatDockClass({ dismissed: true }),
    "fantasy-chat-dock is-dismissed",
  );
  assert.equal(
    fantasyChatDockClass({ open: true, dismissed: true }),
    "fantasy-chat-dock is-open",
  );
});
