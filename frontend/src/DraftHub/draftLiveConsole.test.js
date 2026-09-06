import test from "node:test";
import assert from "node:assert/strict";
import {
  viewerIsCommissioner,
  bidRelation,
  bidRelationLabel,
  bidAmountInputLocked,
  bidAmountSubmitLocked,
  bidAmountAriaInvalid,
  displayedBidAmount,
  sanitizeBidAmountInput,
  shouldSwallowBidDeleteKey,
  riskBand,
  suggestedBidSource,
  nextNominator,
  nextOnClock,
  formatPickTracker,
  teamRosterLine,
  teamBudgetLine,
  recapScopes,
  shortContractLabel,
  shouldApplyRoomState,
  mergeRoomState,
  shouldScheduleWsReconnect,
  isLiveAuctionStatus,
  draftInteractionState,
  rosterForTeam,
  simulationProgressLabel,
  simulationPostFailureAction,
  caughtErrorMessage,
  caughtErrorName,
  fetchTimeoutSignal,
  draftResultTransition,
  loadWatchIds,
  saveWatchIds,
  toggleWatchId,
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

test("bid amount field stays enabled when a rival bid makes the typed amount stale", () => {
  assert.equal(bidAmountInputLocked({ controlsLocked: false }), false);
  assert.equal(bidAmountInputLocked({ controlsLocked: true }), true);
  assert.equal(bidAmountInputLocked({ positionBlocked: true }), true);
  assert.equal(
    bidAmountSubmitLocked({ amount: "5", minBid: 6 }),
    true,
  );
  assert.equal(
    bidAmountSubmitLocked({ amount: "7", minBid: 6 }),
    false,
  );
});

test("displayedBidAmount keeps a focused edit and snaps invalid unfocused amounts", () => {
  assert.equal(
    displayedBidAmount({ currentAmount: "12", suggestedBid: 8, focused: true, touched: true }),
    "12",
  );
  assert.equal(
    displayedBidAmount({ currentAmount: "5", suggestedBid: 8, focused: true, touched: true }),
    "5",
  );
  assert.equal(
    displayedBidAmount({ currentAmount: "5", suggestedBid: 8, focused: false, touched: true }),
    "8",
  );
  assert.equal(
    displayedBidAmount({ currentAmount: "12", suggestedBid: 8, focused: false, touched: true }),
    "12",
  );
  assert.equal(
    displayedBidAmount({ currentAmount: "", suggestedBid: 8, focused: true, touched: true }),
    "",
  );
  assert.equal(
    displayedBidAmount({ currentAmount: "", suggestedBid: 8, focused: false, touched: true }),
    "8",
  );
  assert.equal(
    displayedBidAmount({ currentAmount: "12", suggestedBid: 8, focused: false, touched: false }),
    "8",
  );
});

test("empty bid amount is not aria-invalid; Delete on empty is swallowed", () => {
  assert.equal(
    bidAmountAriaInvalid({ amount: "", minBid: 6 }),
    false,
  );
  assert.equal(
    bidAmountAriaInvalid({ amount: "5", minBid: 6 }),
    true,
  );
  assert.equal(shouldSwallowBidDeleteKey({ key: "Backspace", amount: "" }), true);
  assert.equal(shouldSwallowBidDeleteKey({ key: "Delete", amount: "" }), true);
  assert.equal(shouldSwallowBidDeleteKey({ key: "Backspace", amount: "12" }), false);
  assert.equal(shouldSwallowBidDeleteKey({ key: "a", amount: "" }), false);
});

test("sanitizeBidAmountInput accepts integer dollars only", () => {
  assert.equal(sanitizeBidAmountInput(""), "");
  assert.equal(sanitizeBidAmountInput("42"), "42");
  assert.equal(sanitizeBidAmountInput("04"), "04");
  assert.equal(sanitizeBidAmountInput("12.5"), null);
  assert.equal(sanitizeBidAmountInput("e"), null);
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

test("formatPickTracker is compact and includes next seat", () => {
  assert.equal(formatPickTracker(null), "");
  assert.equal(
    formatPickTracker({ round: 2, overall: 14 }, { nextTeam: { name: "Bot 3" } }),
    "R2 · P14 · Next Bot 3",
  );
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

test("isLiveAuctionStatus includes pick-draft clocks", () => {
  assert.equal(isLiveAuctionStatus("nominating"), true);
  assert.equal(isLiveAuctionStatus("bidding"), true);
  assert.equal(isLiveAuctionStatus("picking"), true);
  assert.equal(isLiveAuctionStatus("setup"), false);
  assert.equal(isLiveAuctionStatus("completed"), false);
});

test("draftInteractionState locks mutations and freezes clocks during simulation", () => {
  assert.deepEqual(
    draftInteractionState({ simulationStatus: "running", simulationDone: 12, simulationTotal: 270 }),
    {
      locked: true,
      discardEnabled: true,
      simulationActive: true,
      simulating: true,
      clockPaused: true,
      clockLabel: "12 of 270",
    },
  );
  assert.equal(draftInteractionState({ simulationStatus: "confirming" }).locked, true);
  assert.equal(draftInteractionState({ simulationStatus: "confirming" }).discardEnabled, true);
  assert.equal(draftInteractionState({ simulationStatus: "failed" }).locked, false);
  assert.equal(draftInteractionState({ pendingAction: "bid" }).locked, true);
  assert.equal(draftInteractionState({ busy: true }).locked, true);
  assert.equal(draftInteractionState({ pendingAction: "delete" }).discardEnabled, false);
  assert.deepEqual(
    draftInteractionState({ paused: true }),
    {
      locked: true,
      discardEnabled: true,
      simulationActive: false,
      simulating: false,
      clockPaused: true,
      clockLabel: "Paused",
    },
  );
});

test("simulationProgressLabel names N of total", () => {
  assert.equal(simulationProgressLabel({ done: 4, total: 270 }), "4 of 270");
  assert.equal(simulationProgressLabel({}), "Sim…");
});

test("caughtErrorName and message tolerate non-Error rejects", () => {
  assert.equal(caughtErrorName(undefined), "");
  assert.equal(caughtErrorName("timeout"), "");
  assert.equal(caughtErrorName({ name: "AbortError" }), "AbortError");
  assert.equal(caughtErrorMessage(undefined, "fallback"), "fallback");
  assert.equal(caughtErrorMessage("timeout", "fallback"), "fallback");
  assert.equal(caughtErrorMessage({ message: "proxy 504" }, "fallback"), "proxy 504");
});

test("simulationPostFailureAction keeps a running room after proxy timeout", () => {
  assert.equal(
    simulationPostFailureAction({ roomSimulationStatus: "running", errorName: "Error" }),
    "continue",
  );
  assert.equal(
    simulationPostFailureAction({ errorName: "AbortError" }),
    "continue",
  );
  assert.equal(
    simulationPostFailureAction({ errorName: "TimeoutError" }),
    "continue",
  );
  assert.equal(
    simulationPostFailureAction({ roomSimulationStatus: "completed" }),
    "completed",
  );
  assert.equal(
    simulationPostFailureAction({ sessionStatus: "completed" }),
    "completed",
  );
  assert.equal(
    simulationPostFailureAction({ draftCompleted: true }),
    "completed",
  );
  assert.equal(
    simulationPostFailureAction({ errorName: "Error" }),
    "fail",
  );
});

test("fetchTimeoutSignal uses AbortSignal.timeout when present", () => {
  const signal = fetchTimeoutSignal(50);
  if (typeof AbortSignal.timeout === "function") {
    assert.ok(signal);
    assert.equal(typeof signal.aborted, "boolean");
  } else {
    assert.equal(signal, undefined);
  }
});

test("rosterForTeam matches string or raw team ids", () => {
  const rows = [{ player_id: "p1" }];
  assert.deepEqual(rosterForTeam({ abc: rows }, "abc"), rows);
  assert.deepEqual(rosterForTeam({ 12: rows }, 12), rows);
  assert.deepEqual(rosterForTeam({}, "missing"), []);
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

test("draftResultTransition primes room history and announces only new results", () => {
  const historical = { id: "pick-12", event_type: "pick", payload: { overall: 12 } };
  const next = { id: "pick-13", event_type: "pick", payload: { overall: 13 } };

  assert.deepEqual(
    draftResultTransition({ events: [historical], roomHydrated: false }),
    { initialized: false, lastEventId: null, event: null },
  );

  const primed = draftResultTransition({ events: [historical], roomHydrated: true });
  assert.deepEqual(primed, { initialized: true, lastEventId: "pick-12", event: null });

  assert.equal(
    draftResultTransition({
      events: [historical],
      roomHydrated: true,
      initialized: primed.initialized,
      lastEventId: primed.lastEventId,
    }).event,
    null,
  );

  const announced = draftResultTransition({
    events: [historical, next],
    roomHydrated: true,
    initialized: primed.initialized,
    lastEventId: primed.lastEventId,
  });
  assert.equal(announced.event, next);
  assert.equal(announced.lastEventId, "pick-13");
});

test("watch list persists to localStorage", () => {
  const store = new Map();
  const fake = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  const prevLocal = globalThis.localStorage;
  const prevSess = globalThis.sessionStorage;
  globalThis.localStorage = fake;
  globalThis.sessionStorage = fake;
  try {
    saveWatchIds("lg-watch", ["p1"]);
    assert.deepEqual(loadWatchIds("lg-watch"), ["p1"]);
    assert.deepEqual(toggleWatchId("lg-watch", "p2"), ["p1", "p2"]);
  } finally {
    globalThis.localStorage = prevLocal;
    globalThis.sessionStorage = prevSess;
  }
});
