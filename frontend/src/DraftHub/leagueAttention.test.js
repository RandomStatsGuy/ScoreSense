import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLeagueAttentionItems,
  filterAttentionForView,
  leagueDisplayName,
  leaguePhaseLabel,
  leagueRoleLabel,
} from "./leagueAttention.js";

test("league identity is name · phase · role, never Hub", () => {
  const ctx = { league_name: "My Auction", draft_completed: false, is_commissioner: true };
  assert.equal(leagueDisplayName(ctx, { inLeague: true }), "My Auction");
  assert.equal(leaguePhaseLabel(ctx, { inLeague: true }), "Pre-draft");
  assert.equal(leagueRoleLabel(ctx, { inLeague: true }), "Commissioner");
  assert.equal(leagueDisplayName(ctx, { inLeague: false }), "Solo prep");
});

test("Needs attention names the stale sheet and the sync", () => {
  const items = buildLeagueAttentionItems({
    inLeague: true,
    capSheetsStale: true,
    isCommish: true,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].label, "Cap sheets stale");
  assert.equal(items[0].actionLabel, "Sync sheets");
  assert.equal(items[0].action, "sheets");
});

test("attention for the open view stays off the overflow list", () => {
  const items = [{ id: "over-cap", action: "planner", label: "Over cap $12" }];
  assert.equal(filterAttentionForView(items, "planner").length, 0);
  assert.equal(filterAttentionForView(items, "home").length, 1);
});
