import test from "node:test";
import assert from "node:assert/strict";
import { buildAppPath, parseAppPath } from "./routes.js";

test("tools mock-draft tab round-trips", () => {
  assert.deepEqual(parseAppPath("/tools/mock-draft").view, "tools");
  assert.equal(parseAppPath("/tools/mock-draft").toolsTab, "mock-draft");
  assert.equal(parseAppPath("/tools/dfs").toolsTab, "dfs");
  assert.equal(parseAppPath("/tools/unknown").toolsTab, "dfs");
  assert.equal(
    buildAppPath({ view: "tools", toolsTab: "mock-draft" }),
    "/tools/mock-draft",
  );
  assert.equal(buildAppPath({ view: "tools", toolsTab: "dfs" }), "/tools/dfs");
});

test("Fantasy rules and roster management routes round-trip", () => {
  assert.equal(parseAppPath("/hub/rules").hubSubView, "rules");
  assert.equal(buildAppPath({ view: "hub", hubSubView: "rules" }), "/hub/rules");
  assert.equal(parseAppPath("/hub/office").officeTab, "current");
  assert.equal(parseAppPath("/hub/office/chat").officeTab, "current");
  assert.equal(
    buildAppPath({ view: "hub", hubSubView: "office", officeTab: "current" }),
    "/hub/office/current",
  );
});
