import test from "node:test";
import assert from "node:assert/strict";
import { MANAGER_NAMES_COPY, RULES_COPY } from "./rulesPresentation.js";
test("manager mapping explains display identity and keeps access separate", () => {
  assert.match(MANAGER_NAMES_COPY.help, /trophies, contracts, and history/);
  assert.match(MANAGER_NAMES_COPY.accountHelp, /joined|joining/);
  assert.match(MANAGER_NAMES_COPY.accountHelp, /do not assign teams/);
  const category = RULES_COPY.categories.find((r) => r.id === "managers");
  assert.ok(category.leagueOnly && category.commissionerOnly);
});
