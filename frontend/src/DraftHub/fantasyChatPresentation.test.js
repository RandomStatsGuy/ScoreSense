import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CHAT_LAUNCHER_DISMISS_KEY,
  CHAT_LAUNCHER_EDGE_KEY,
  FANTASY_CHAT_COPY,
  fantasyChatDockClass,
  hideFantasyChatDock,
  nearestChatEdge,
  readChatLauncherDismissed,
  readChatLauncherEdge,
  writeChatLauncherDismissed,
  writeChatLauncherEdge,
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

test("dock classes mark the open stage, dismissed launcher, and parked edge", () => {
  assert.equal(fantasyChatDockClass(), "fantasy-chat-dock is-edge-right");
  assert.equal(fantasyChatDockClass({ open: true }), "fantasy-chat-dock is-open is-edge-right");
  assert.equal(
    fantasyChatDockClass({ dismissed: true }),
    "fantasy-chat-dock is-dismissed is-edge-right",
  );
  assert.equal(
    fantasyChatDockClass({ open: true, dismissed: true }),
    "fantasy-chat-dock is-open is-edge-right",
  );
  assert.equal(
    fantasyChatDockClass({ edge: "left" }),
    "fantasy-chat-dock is-edge-left",
  );
  assert.equal(
    fantasyChatDockClass({ dragging: true }),
    "fantasy-chat-dock is-dragging is-edge-right",
  );
});

test("nearest edge parks from the pointer, not a magic offset", () => {
  assert.equal(nearestChatEdge(10, 200, 800, 600), "left");
  assert.equal(nearestChatEdge(790, 200, 800, 600), "right");
  assert.equal(nearestChatEdge(400, 10, 800, 600), "top");
  assert.equal(nearestChatEdge(400, 590, 800, 600), "bottom");
});

test("edge placement persists for the session", () => {
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
  assert.equal(readChatLauncherEdge(storage), "right");
  assert.equal(readChatLauncherEdge(storage, { mobile: true }), "bottom");
  assert.equal(writeChatLauncherEdge("left", storage), "left");
  assert.equal(storage.getItem(CHAT_LAUNCHER_EDGE_KEY), "left");
  assert.equal(readChatLauncherEdge(storage, { mobile: true }), "left");
  assert.equal(writeChatLauncherEdge("nope", storage), "right");
});

test("dragging dock drops parent transform so the launcher stays viewport-fixed", () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../styles/product-hierarchy.css"),
    "utf8",
  );
  assert.match(css, /\.fantasy-chat-dock\.is-dragging\s*\{[^}]*transform:\s*none/s);
  assert.match(css, /safe-area-inset-bottom/);
});

test("phone CSS parks dismiss on the bubble, not off the right edge", () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../styles/fantasy-phone.css"),
    "utf8",
  );
  assert.match(css, /\.fantasy-chat-dismiss--on-bubble\s*,|\.fantasy-chat-dismiss--on-bubble\s*\{/);
  assert.match(css, /\.fantasy-chat-dismiss--on-bubble[\s\S]*position:\s*absolute/);
  assert.match(css, /8\.85rem \+ env\(safe-area-inset-bottom/);
});

test("Home hides the edge launcher because the locker is the house", () => {
  assert.equal(hideFantasyChatDock({ house: true }), true);
  assert.equal(hideFantasyChatDock({ hidden: true }), true);
  assert.equal(hideFantasyChatDock({}), false);
});
