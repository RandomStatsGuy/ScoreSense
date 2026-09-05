import assert from "node:assert/strict";
import test from "node:test";
import {
  againstCap,
  capEquationNote,
  displayCapPair,
  capHeroCopy,
  capRailPrimary,
  capSheetYearOffsets,
  leftoverAfterMoveYears,
  leftoverAfterMoveDisplay,
  leftoverMoveReadout,
  fmtCapMoney,
  parseNeedErrors,
  positionFromNeedError,
  formatNeedError,
  rosterNeedLine,
  vsCostCell,
  CAP_NEED_COPY,
  CAP_MOVE_COPY,
  CAP_FIGURE_COPY,
} from "./capPlannerPresentation.js";

test("Cap hero asks if you can afford the bid", () => {
  const live = capHeroCopy();
  assert.match(live.heading, /afford/i);
  assert.match(live.support, /leftover|bid|against this cap/i);
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

test("leftoverAfterMoveYears applies the bid and cut refund and keeps committed in sync", () => {
  const next = leftoverAfterMoveYears({
    years: [
      { year: 2026, cap_remaining: 200, total_committed: 0 },
      { year: 2027, cap_remaining: 180, total_committed: 20 },
    ],
    cutHits: [40, 40],
    cutRefundPct: 0.5,
    bid: 10,
  });
  assert.equal(next[0].cap_remaining, 210);
  assert.equal(next[0].total_committed, -10);
  assert.equal(next[1].cap_remaining, 220);
  assert.equal(next[1].total_committed, -20);
  const closed = leftoverAfterMoveYears({
    years: [
      { seasonLabel: 2026, cap_remaining: 114, total_committed: 86 },
      { seasonLabel: 2027, cap_remaining: 160, total_committed: 40 },
    ],
    cutHits: [10, 10],
    cutRefundPct: 0.5,
    bid: 20,
  });
  assert.equal(closed[0].cap_remaining, 99);
  assert.equal(closed[0].total_committed, 101);
  assert.equal(closed[0].cap_remaining + closed[0].total_committed, 200);
});

test("against cap plus leftover equals the cap", () => {
  const spent = 81;
  const dead = 5;
  const leftover = 114;
  const salaryCap = 200;
  const against = againstCap({ spent, deadCap: dead });
  assert.equal(against, 86);
  assert.equal(against + leftover, salaryCap);
  assert.equal(
    capEquationNote({ against, leftover, salaryCap }),
    "$86 of $200 against cap · $114 leftover",
  );
  assert.equal(
    capEquationNote({ leftover: 122.5, salaryCap: 200 }),
    "$77 of $200 against cap · $123 leftover",
  );
  assert.equal(
    capEquationNote({ against: 270, leftover: -70, salaryCap: 200 }),
    "$270 of $200 against cap · $70 over",
  );
  assert.equal(CAP_FIGURE_COPY.againstCap, "Against this cap");
  assert.doesNotMatch(CAP_FIGURE_COPY.againstCap, /^Committed$/);
  const pair = displayCapPair({ leftover: 122.5, salaryCap: 200 });
  assert.equal(pair.leftover, 123);
  assert.equal(pair.against, 77);
  assert.equal(pair.leftover + pair.against, 200);
});

test("roster needs collapse to one sentence", () => {
  const { needs, other } = parseNeedErrors([
    "Need 3 more QB (min 3)",
    "Need 6 more RB (min 6)",
    "Over cap by $12",
  ]);
  assert.deepEqual(needs, [
    { count: 3, position: "QB" },
    { count: 6, position: "RB" },
  ]);
  assert.deepEqual(other, ["Over cap by $12"]);
  assert.equal(rosterNeedLine(needs), "You need 9 more players (3 QB, 6 RB)");
  assert.equal(rosterNeedLine([{ count: 1, position: "TE" }]), "You need 1 more player (1 TE)");
});

test("leftoverAfterMoveDisplay applies the bid to the leftover already on screen", () => {
  const next = leftoverAfterMoveDisplay({
    years: [{ seasonLabel: 2026, cap_remaining: 122.5, total_committed: 77.5 }],
    salaryCap: 200,
    cutHits: [0],
    bid: 200,
  });
  assert.equal(next[0].cap_remaining, -77);
  assert.equal(next[0].total_committed, 277);
  assert.equal(next[0].cap_remaining + next[0].total_committed, 200);
  const cut = leftoverAfterMoveDisplay({
    years: [{ seasonLabel: 2026, cap_remaining: 122.5 }],
    salaryCap: 200,
    cutHits: [23],
    cutRefundPct: 0.5,
    bid: 0,
  });
  assert.equal(cut[0].cap_remaining, 135);
  assert.equal(fmtCapMoney(-77), "-$77");
  assert.equal(fmtCapMoney(123), "$123");
});

test("leftoverMoveReadout names over-cap and reset-worthy change", () => {
  const over = leftoverMoveReadout({ current: 114, after: -20 });
  assert.equal(over.over, true);
  assert.equal(over.overBy, 20);
  assert.equal(over.changed, true);
  assert.match(CAP_MOVE_COPY.over("$20"), /over/);
  const same = leftoverMoveReadout({ current: 114, after: 114 });
  assert.equal(same.changed, false);
  assert.equal(same.over, false);
});

test("capSheetYearOffsets hides years with no hits", () => {
  const roster = [
    { id: "a" },
    { id: "b" },
  ];
  const hits = { a: { 1: 13 }, b: { 1: 8 } };
  const offsets = capSheetYearOffsets({
    roster,
    yearCount: 3,
    hitFor: (row, offset) => hits[row.id]?.[offset] ?? null,
  });
  assert.deepEqual(offsets, [1]);
});
