import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DESTINATIONS,
  destinationForSection,
  rememberDestination,
  snapshotDestination,
} from "./lastDestinations.js";

function memoryStorage(seed = {}) {
  const data = { ...seed };
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
  };
}

test("snapshotDestination keeps office and insight panes", () => {
  assert.deepEqual(
    snapshotDestination({ view: "hub", hubSubView: "office", officeTab: "access" }),
    { hubSubView: "office", officeTab: "access", insightTab: null },
  );
  assert.deepEqual(
    snapshotDestination({ view: "projections", projectionsTab: "season", seasonMode: "preseason" }),
    { projectionsTab: "season", seasonMode: "preseason" },
  );
});

test("entering Fantasy lands on Home while the active Fantasy tab keeps its page", () => {
  const storage = memoryStorage();
  rememberDestination({ view: "hub", hubSubView: "planner" }, storage);
  rememberDestination({ view: "projections", projectionsTab: "weekly", seasonMode: "live" }, storage);
  assert.deepEqual(
    destinationForSection("hub", { current: { view: "projections" }, storage }),
    { hubSubView: "home", officeTab: null, insightTab: null },
  );
  assert.deepEqual(
    destinationForSection("hub", {
      current: { view: "hub", hubSubView: "week" },
      storage,
    }),
    { hubSubView: "week", officeTab: null, insightTab: null },
  );
});

test("unknown sections stay empty and defaults apply on first visit", () => {
  const storage = memoryStorage();
  assert.deepEqual(destinationForSection("account", { storage }), {});
  assert.deepEqual(destinationForSection("tools", { storage }), DEFAULT_DESTINATIONS.tools);
});


test("Projections and Tools still restore their saved destinations", () => {
  const storage = memoryStorage();
  rememberDestination({ view: "projections", projectionsTab: "season", seasonMode: "preseason" }, storage);
  rememberDestination({ view: "tools", toolsTab: "best-ball" }, storage);
  assert.deepEqual(destinationForSection("projections", { current: { view: "hub" }, storage }),
    { projectionsTab: "season", seasonMode: "preseason" });
  assert.deepEqual(destinationForSection("tools", { current: { view: "hub" }, storage }), { toolsTab: "best-ball" });
});
