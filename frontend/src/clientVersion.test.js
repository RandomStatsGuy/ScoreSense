import test from "node:test";
import assert from "node:assert/strict";
import { isProtectedReloadPath } from "./clientVersion.js";

test("reloads wait until the visitor leaves drafts and editable screens", () => {
  for (const path of [
    "/hub/draft", "/tools/mock-draft", "/hub/rules", "/hub/trades",
    "/hub/roster", "/hub/cap", "/hub/free-agents", "/hub/roster-management/contracts",
    "/hub/office/contracts", "/tools/dfs", "/account", "/admin",
  ]) assert.equal(isProtectedReloadPath(path), true, path);
  for (const path of ["/", "/hub/home", "/hub/game", "/projections/weekly"])
    assert.equal(isProtectedReloadPath(path), false, path);
});
