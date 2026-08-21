/**
 * Roster cap remaining copy and team totals.
 * Run with: node --test frontend/src/DraftHub/rosterFormat.test.js
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  fmtSal,
  formatCapRemaining,
  teamCapStats,
} from "./rosterFormat.js";

test("fmtSal prefixes the minus before the dollar sign", () => {
  assert.equal(fmtSal(216), "$216");
  assert.equal(fmtSal(0), "$0");
  assert.equal(fmtSal(-16), "-$16");
  assert.equal(fmtSal(-0.4), "$0");
  assert.equal(fmtSal(null), "—");
});

test("formatCapRemaining never labels over-cap as free", () => {
  assert.deepEqual(formatCapRemaining(-16), { text: "$16 over", over: true });
  assert.deepEqual(formatCapRemaining(12), { text: "$12 free", over: false });
  assert.deepEqual(formatCapRemaining(0), { text: "$0 free", over: false });
  assert.deepEqual(formatCapRemaining(null), { text: "—", over: false });
});

test("teamCapStats remaining is negative when committed exceeds the cap", () => {
  const stats = teamCapStats(
    {
      roster: [
        { salary: 51, roster_status: "active" },
        { salary: 165, roster_status: "active" },
        { salary: 20, roster_status: "cut_before_draft" },
      ],
    },
    200,
    { contracts: { cut_refund_pct: 0.5 } },
  );
  assert.equal(stats.committed, 216);
  assert.equal(stats.deadCap, 10);
  assert.equal(stats.remaining, -26);
  assert.equal(stats.playerCount, 2);
  assert.equal(stats.cutCount, 1);
  assert.equal(formatCapRemaining(stats.remaining).over, true);
});
