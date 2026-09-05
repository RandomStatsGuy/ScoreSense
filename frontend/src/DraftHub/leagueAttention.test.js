import assert from "node:assert/strict";
import test from "node:test";
import {
  ageShort,
  buildLeagueAttentionItems,
  filterAttentionForView,
  leagueDisplayName,
  leaguePhaseLabel,
  leagueRoleLabel,
  resolveOverflowAttentionItems,
} from "./leagueAttention.js";

test("league identity is name · phase · role, never Hub", () => {
  const ctx = { league_name: "My Auction", draft_completed: false, is_commissioner: true };
  assert.equal(leagueDisplayName(ctx, { inLeague: true }), "My Auction");
  assert.equal(leaguePhaseLabel(ctx, { inLeague: true }), "Pre-draft");
  assert.equal(leagueRoleLabel(ctx, { inLeague: true }), "Commissioner");
  assert.equal(leagueDisplayName(ctx, { inLeague: false }), "Solo prep");
});

test("Needs attention names Cap for over-cap and Review extensions for extend", () => {
  const items = buildLeagueAttentionItems({
    inLeague: true,
    overCapLabel: "$12",
    mustExtendCount: 2,
  });
  assert.equal(items.find((item) => item.id === "over-cap")?.actionLabel, "Cap");
  assert.equal(items.find((item) => item.id === "extend")?.actionLabel, "Review extensions");
  assert.equal(items.find((item) => item.id === "extend")?.action, "roster-extend");
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

test("ageShort formats minutes for a recent stamp", () => {
  const at = new Date(Date.now() - 33 * 60 * 1000).toISOString();
  assert.equal(ageShort(at), "33m");
});

test("attention for the open view stays off the overflow list", () => {
  const items = [{ id: "over-cap", action: "planner", label: "Over cap $12" }];
  assert.equal(filterAttentionForView(items, "planner").length, 0);
  assert.equal(filterAttentionForView(items, "home").length, 1);
});

test("Review extensions stays visible on My team so it can filter the table", () => {
  const items = [{ id: "extend", action: "roster-extend", label: "2 need extension" }];
  assert.equal(filterAttentionForView(items, "roster").length, 1);
});

test("overflow keeps chrome attention until freshness computes items", () => {
  const chromeItems = [{ id: "cap-sheets", label: "Cap sheets stale", actionLabel: "Sync sheets" }];
  assert.deepEqual(resolveOverflowAttentionItems([], chromeItems), chromeItems);
  const computed = [{ id: "projections", label: "Projections stale" }];
  assert.deepEqual(resolveOverflowAttentionItems(computed, chromeItems), computed);
  assert.deepEqual(resolveOverflowAttentionItems([], null), []);
});
