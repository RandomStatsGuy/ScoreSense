import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { focusedLeagueId, shouldApplyHubContext } from "./hubContext.js";

const live = {
  mode: "league",
  league_id: "live-1",
  league_name: "My Auction",
  test_mode: false,
};

const practice = {
  mode: "league",
  league_id: "test-1",
  league_name: "Test League",
  test_mode: true,
};

describe("shouldApplyHubContext", () => {
  it("rejects practice rooms even on force", () => {
    assert.equal(shouldApplyHubContext(practice, null, { force: true }), false);
    assert.equal(shouldApplyHubContext(practice, live), false);
  });

  it("applies the first live league on boot", () => {
    assert.equal(shouldApplyHubContext(live, null), true);
    assert.equal(shouldApplyHubContext({ mode: "solo", league_id: null }, null), false);
  });

  it("ignores another live league unless force", () => {
    const other = { ...live, league_id: "live-2", league_name: "Other" };
    assert.equal(shouldApplyHubContext(other, live), false);
    assert.equal(shouldApplyHubContext(other, live, { force: true }), true);
    assert.equal(shouldApplyHubContext(live, live), true);
  });

  it("does not let a solo payload wipe a focused league", () => {
    assert.equal(shouldApplyHubContext({ mode: "solo", league_id: null }, live), false);
    assert.equal(shouldApplyHubContext({ mode: "solo", league_id: null }, live, { force: true }), true);
  });
});

describe("focusedLeagueId", () => {
  it("returns the live focus and never a practice room", () => {
    assert.equal(focusedLeagueId(live), "live-1");
    assert.equal(focusedLeagueId(practice), "");
    assert.equal(focusedLeagueId({ mode: "solo" }), "");
  });
});
