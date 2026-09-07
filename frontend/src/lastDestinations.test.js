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

test("rememberDestination restores the last Fantasy page after leaving the area", () => {
  const storage = memoryStorage();
  rememberDestination({ view: "hub", hubSubView: "planner" }, storage);
  rememberDestination({ view: "projections", projectionsTab: "weekly", seasonMode: "live" }, storage);
  assert.deepEqual(
    destinationForSection("hub", { current: { view: "projections" }, storage }),
    { hubSubView: "planner", officeTab: null, insightTab: null },
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
