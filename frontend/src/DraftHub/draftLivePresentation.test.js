import assert from "node:assert/strict";
import test from "node:test";
import {
  auctionViewerGradeCopy,
  draftLiveCopy,
  nominateDisabledReason,
  nominationJobLine,
  poolSearchPlaceholder,
  soldPriceLine,
  soldTone,
  watchLabel,
  activityDockTab,
  poolRowIsPrimary,
} from "./draftLivePresentation.js";

test("sold copy names the price against fair", () => {
  assert.equal(draftLiveCopy.soldStamp, "SOLD");
  assert.match(soldPriceLine({ amount: 18, fair: 24 }), /under fair/);
  assert.match(soldPriceLine({ amount: 30, fair: 24 }), /over fair/);
  assert.equal(soldTone({ amount: 18, fair: 24 }), "discount");
  assert.equal(soldTone({ amount: 30, fair: 24 }), "reach");
});

test("auction grade leads with a letter and a verdict", () => {
  const bought = auctionViewerGradeCopy({ steals: 1, reaches: 7, leftover: 4, spent: 196, cap: 200 });
  assert.equal(bought.grade, "B−");
  assert.match(bought.summary, /bought the room|ran out/i);
  assert.doesNotMatch(bought.summary, /Submit|Draft Hub|permission/i);
});

test("nomination job names the turn and pause without shouting Live", () => {
  assert.equal(
    nominationJobLine({ isMyTurn: true }),
    draftLiveCopy.yourTurnToNominate,
  );
  assert.match(nominationJobLine({ isMyTurn: true, paused: true }), /Paused/);
  assert.match(nominateDisabledReason({ paused: true }), /paused/i);
  assert.match(nominateDisabledReason({ canDraft: false, nominatorName: "The Auditor" }), /Auditor/);
  assert.equal(poolSearchPlaceholder({ canDraft: true }), draftLiveCopy.searchNominate);
  assert.equal(watchLabel(true), draftLiveCopy.watching);
  assert.doesNotMatch(draftLiveCopy.searchNominate, /Submit|Draft Hub|permission/i);
  assert.equal(draftLiveCopy.pause, "Pause");
  assert.equal(nominationJobLine({ offline: true }), draftLiveCopy.offlineJob);
  assert.match(nominationJobLine({ offline: true, paused: true }), /No clocks/);
  assert.equal(poolSearchPlaceholder({ canDraft: true, offline: true }), draftLiveCopy.searchPlayer);
  assert.equal(draftLiveCopy.record, "Record");
});

test("pool row primary matches string or numeric ids", () => {
  assert.equal(poolRowIsPrimary({ playerId: 12, primaryRowId: "12", canDraft: true }), true);
  assert.equal(poolRowIsPrimary({ playerId: "12", primaryRowId: 12, canDraft: true }), true);
  assert.equal(poolRowIsPrimary({ playerId: 12, primaryRowId: "12", canDraft: false }), false);
});

test("activity dock drops Queue when the pool stage owns it", () => {
  assert.equal(activityDockTab("queue", { poolStage: true }), "");
  assert.equal(activityDockTab("teams", { poolStage: true }), "teams");
  assert.equal(activityDockTab("queue", { poolStage: false }), "queue");
});
