import assert from "node:assert/strict";
import test from "node:test";
import {
  capHeroCopy,
  capRailPrimary,
  leftoverAfterMoveYears,
  positionFromNeedError,
  formatNeedError,
  vsCostCell,
  CAP_NEED_COPY,
} from "./capPlannerPresentation.js";

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

test("rail primary is the pending cut or the draft spend", () => {
  const cut = capRailPrimary({
    pendingCut: { player_name: "Zamir White", player_id: "zw", dead_cap: 5, salary: 10 },
    remaining: 178,
  });
  assert.equal(cut.kind, "undo-cut");
  assert.equal(cut.label, "Undo cut · Zamir White (+$5 dead, −$10 room)");
  const room = capRailPrimary({ remaining: 178 });
  assert.equal(room.kind, "room");
  assert.equal(room.label, "Open draft room · $178 to spend.");
  assert.equal(positionFromNeedError("Need 4 more RB (min 4)"), "RB");
  assert.equal(formatNeedError("Need 3 more QB (min 3)"), "Need 3 more QB · min 3");
  assert.equal(formatNeedError("Need 3 more QB (min 3 / max 4)"), "Need 3 more QB · min 3, max 4");
  assert.equal(CAP_NEED_COPY.browseFreeAgents, "Browse free agents");
  assert.equal(vsCostCell({ preDraft: true, remaining: 178, bid: 35 }), "Room after: $143");
  assert.equal(vsCostCell({ preDraft: true, remaining: 178, bid: null }), "—");
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
