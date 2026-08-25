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
