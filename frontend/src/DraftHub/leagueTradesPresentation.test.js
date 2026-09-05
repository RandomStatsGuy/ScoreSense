import assert from "node:assert/strict";
import test from "node:test";
import { stepBlockedReason, TRADES_COPY, tradesFreeLabel } from "./leagueTradesPresentation.js";

test("trades copy names the cap-bust cost and skips banned verbs", () => {
  assert.match(TRADES_COPY.heading, /cap/i);
  assert.match(TRADES_COPY.support, /voided|accept/i);
  assert.doesNotMatch(TRADES_COPY.inviteManagers, /Submit|Draft Hub|permission/i);
  assert.doesNotMatch(TRADES_COPY.valid, /constraint/i);
  assert.doesNotMatch(TRADES_COPY.ideasEmptyHeading, /import salaries/i);
});

test("step blockers explain partner vs package", () => {
  assert.equal(
    stepBlockedReason("players", { hasPartner: false, hasPackage: false }),
    TRADES_COPY.stepNeedPartner,
  );
  assert.equal(
    stepBlockedReason("propose", { hasPartner: true, hasPackage: false }),
    TRADES_COPY.stepNeedPackage,
  );
  assert.equal(stepBlockedReason("review", { hasPartner: true, hasPackage: true }), "");
});

test("free label qualifies the cap", () => {
  assert.equal(tradesFreeLabel(200, (n) => `$${n}`), "free / $200");
  assert.equal(tradesFreeLabel(null, (n) => `$${n}`), "free");
});

test("send and get names include the player and destination", () => {
  assert.equal(
    TRADES_COPY.sendTo("Jayden Daniels", "Disappointment"),
    "Send Jayden Daniels to Disappointment",
  );
  assert.equal(
    TRADES_COPY.getFrom("Jayden Daniels", "Disappointment"),
    "Get Jayden Daniels from Disappointment",
  );
});
