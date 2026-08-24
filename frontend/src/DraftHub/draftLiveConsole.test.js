import test from "node:test";
import assert from "node:assert/strict";
import {
  viewerIsCommissioner,
  bidRelation,
  bidRelationLabel,
  riskBand,
  suggestedBidSource,
  nextNominator,
  nextOnClock,
  teamRosterLine,
  teamBudgetLine,
  recapScopes,
  shortContractLabel,
  shouldApplyRoomState,
  mergeRoomState,
  shouldScheduleWsReconnect,
} from "./draftLiveConsole.js";

test("viewerIsCommissioner uses only the viewer's staff flag", () => {
  assert.equal(viewerIsCommissioner({ hubContext: { is_commissioner: true } }), true);
  assert.equal(viewerIsCommissioner({ viewer: { is_commissioner: true } }), true);
  assert.equal(viewerIsCommissioner({ myTeam: { is_commissioner: true } }), true);
  assert.equal(
    viewerIsCommissioner({ hubContext: {}, viewer: {}, myTeam: { is_commissioner: false } }),
    false,
  );
});

test("bidRelation is viewer-relative", () => {
  assert.equal(bidRelation({ myTeamId: "a", highBidderTeamId: "a" }), "winning");
  assert.equal(bidRelation({ myTeamId: "a", highBidderTeamId: "b" }), "outbid");
  assert.equal(bidRelation({ myTeamId: "a", highBidderTeamId: null }), "watching");
  assert.equal(bidRelationLabel("winning"), "You're winning");
  assert.equal(bidRelationLabel("outbid"), "You've been outbid");
});

test("riskBand maps z-scores to Stable / Balanced / Volatile", () => {
  assert.equal(riskBand(-1.29).label, "Stable");
  assert.equal(riskBand(0.1).label, "Balanced");
  assert.equal(riskBand(0.9).label, "Volatile");
  assert.equal(riskBand(null).label, "—");
});

test("suggestedBidSource distinguishes model-neutral vs risk-adjusted", () => {
  assert.equal(suggestedBidSource(false), "model-neutral");
  assert.equal(suggestedBidSource(true), "risk-adjusted");
});

test("nextNominator wraps the nomination order", () => {
  const session = { nomination_order: ["t1", "t2", "t3"], nominator_index: 2 };
  const teams = [{ id: "t1", name: "A" }, { id: "t3", name: "C" }];
  assert.equal(nextNominator(session, teams).id, "t1");
});

test("nextOnClock snakes odd rounds instead of wrapping", () => {
  const session = { nomination_order: ["t1", "t2", "t3"], nominator_index: 2 };
  const teams = [{ id: "t1", name: "A" }, { id: "t3", name: "C" }];
  assert.equal(nextOnClock(session, teams, "linear").id, "t1");
  assert.equal(nextOnClock(session, teams, "snake").id, "t3");
});

test("teamRosterLine omits budget", () => {
  const line = teamRosterLine({ occupying: 4, roster_size_max: 16 });
  assert.equal(line.text, "4/16 rostered");
});

test("teamBudgetLine spells out budget, roster, and max bid", () => {
  const line = teamBudgetLine({
    budget_remaining: 194,
    occupying: 13,
    roster_size_max: 14,
    max_bid: 194,
  });
  assert.equal(line.text, "Budget $194 · 13/14 rostered · Max bid $194");
});

test("recapScopes keep mock wins separate from rostered counts", () => {
  const scopes = recapScopes({
    auctionWins: 3,
    auctionSpent: 50,
    budgetRemaining: 150,
    rosteredCount: 173,
    limitsRelaxed: true,
  });
  assert.equal(scopes.thisMock.auctionWins, 3);
  assert.equal(scopes.leagueWide.rosteredCount, 173);
  assert.match(scopes.fullKeeperRoster.note, /Hypothetical|limits are off/i);
});

test("shortContractLabel collapses award copy", () => {
  assert.equal(
    shortContractLabel({
      contract_years: 2,
      salary: 4,
      salary_schedule: [4, 9],
    }),
    "2 yrs · $4 → $9",
  );
});

test("shouldApplyRoomState drops stale setup flashes during a live auction", () => {
  const live = {
    league: { id: "sandbox" },
    session: { status: "nominating" },
    viewer: { team_id: "t1" },
  };
  assert.equal(
    shouldApplyRoomState(live, { league: { id: "real" }, session: { status: "setup" } }, "sandbox"),
    false,
  );
  assert.equal(
    shouldApplyRoomState(live, { league: { id: "sandbox" }, session: {} }, "sandbox"),
    false,
  );
  assert.equal(
    shouldApplyRoomState(live, { league: { id: "sandbox" }, session: { status: "setup" } }, "sandbox"),
    true,
  );
  assert.equal(
    shouldApplyRoomState(live, { league: { id: "sandbox" }, session: { status: "bidding" } }, "sandbox"),
    true,
  );
});

test("mergeRoomState keeps viewer when a broadcast omits it", () => {
  const prev = {
    league: { id: "lg" },
    session: { status: "nominating" },
    viewer: { team_id: "t1", team_name: "Me" },
  };
  const next = {
    league: { id: "lg" },
    session: { status: "nominating" },
  };
  assert.equal(mergeRoomState(prev, next).viewer.team_id, "t1");
});

test("shouldScheduleWsReconnect ignores closes from a replaced socket", () => {
  assert.equal(
    shouldScheduleWsReconnect({ roomStillMounted: true, closedSocketIsCurrent: false }),
    false,
  );
  assert.equal(
    shouldScheduleWsReconnect({ roomStillMounted: false, closedSocketIsCurrent: true }),
    false,
  );
  assert.equal(
    shouldScheduleWsReconnect({ roomStillMounted: true, closedSocketIsCurrent: true }),
    true,
  );
});
