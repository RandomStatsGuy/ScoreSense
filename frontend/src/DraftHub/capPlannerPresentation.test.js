import assert from "node:assert/strict";
import test from "node:test";
import { capHeroCopy, leftoverAfterMoveYears } from "./capPlannerPresentation.js";

test("Cap hero asks if you can afford the bid", () => {
  const live = capHeroCopy();
  assert.match(live.heading, /afford/i);
  assert.match(live.support, /leftover|bid/i);
  const empty = capHeroCopy({ empty: true });
  assert.match(empty.support, /guess/i);
  const pre = capHeroCopy({ preDraft: true });
  assert.match(pre.support, /dead cap/i);
  assert.doesNotMatch(JSON.stringify(live), /three seasons before you spend|Draft Hub|Submit/i);
});

test("leftoverAfterMoveYears applies the bid and cut refund to year one", () => {
  const next = leftoverAfterMoveYears({
    years: [
      { year: 2026, cap_remaining: 200 },
      { year: 2027, cap_remaining: 180 },
    ],
    cutHits: [40, 40],
    cutRefundPct: 0.5,
    bid: 10,
  });
  assert.equal(next[0].cap_remaining, 210);
  assert.equal(next[1].cap_remaining, 220);
});
