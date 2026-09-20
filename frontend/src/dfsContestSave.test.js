/**
 * Run with: node --test frontend/src/dfsContestSave.test.js
 */
import assert from "node:assert/strict";
import test from "node:test";
import { contestEntryRows, contestSnapshot, localDateString, myContestTotals } from "./dfsContestSave.js";
import { contestSummary, parseMoneyCents, parsePrizeStructure } from "./dfsContest.js";

const MINE = [
  {
    entry_id: "0001",
    entry_name: "asmit25290 (1/20)",
    rank: 3,
    points: 104.45,
    lineup_text: "CPT Brock Purdy FLEX Christian McCaffrey",
    payout_cents: 1250,
  },
  {
    entry_id: "0002",
    entry_name: "asmit25290 (2/20)",
    rank: 4021,
    points: 61.2,
    lineup_text: "CPT Deebo Samuel Sr. FLEX Brock Purdy",
    payout_cents: 0,
  },
];

test("entry rows carry the contest key and only what the file knows", () => {
  const rows = contestEntryRows({
    mine: MINE,
    contestId: "195390867",
    contestName: "NFL Showdown",
    feeCents: 300,
    date: "2026-09-18",
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    site: "draftkings",
    contest_id: "195390867",
    entry_id: "0001",
    contest_name: "NFL Showdown",
    date: "2026-09-18",
    entry_name: "asmit25290 (1/20)",
    rank: 3,
    points: 104.45,
    lineup_text: "CPT Brock Purdy FLEX Christian McCaffrey",
    fee_cents: 300,
    payout_cents: 1250,
    status: "settled",
  });
  // Out of the money is a real zero, not a missing value.
  assert.equal(rows[1].payout_cents, 0);
  assert.equal(rows[1].status, "settled");
});

test("without a payout table nothing claims the money is known", () => {
  const rows = contestEntryRows({
    mine: MINE.map((row) => ({ ...row, payout_cents: null })),
    contestId: "195390867",
  });
  for (const row of rows) {
    assert.equal("payout_cents" in row, false);
    assert.equal("status" in row, false);
    assert.equal("fee_cents" in row, false);
  }
  // Rank and score still save — those the file does know.
  assert.equal(rows[0].rank, 3);
});

test("nothing is written without a contest ID to hang it on", () => {
  assert.deepEqual(contestEntryRows({ mine: MINE }), []);
  assert.equal(contestSnapshot({ summary: { mine: MINE }, contestId: "" }), null);
  assert.equal(contestSnapshot({ summary: null, contestId: "1" }), null);
  // An entry with no ID cannot be keyed, so it is dropped rather than guessed.
  assert.deepEqual(contestEntryRows({ mine: [{ rank: 1 }], contestId: "1" }), []);
});

test("totals add the money up and leave unknown fees null", () => {
  assert.deepEqual(myContestTotals(MINE, 300), {
    my_entries: 2,
    my_payout_cents: 1250,
    my_fee_cents: 600,
  });
  assert.deepEqual(myContestTotals(MINE.map((r) => ({ ...r, payout_cents: null })), null), {
    my_entries: 2,
    my_payout_cents: null,
    my_fee_cents: null,
  });
});

test("the snapshot keeps the whole breakdown and denormalizes what the list reads", () => {
  const entries = [];
  for (let i = 1; i <= 60; i += 1) {
    entries.push({
      entry_id: String(i),
      entry_name: `player${i}`,
      rank: i,
      points: 200 - i,
      lineup: "CPT Brock Purdy FLEX Christian McCaffrey",
    });
  }
  const tiers = parsePrizeStructure("1st\t$1000\n2nd - 10th\t$50");
  const summary = contestSummary({
    entries,
    players: [{ player: "Brock Purdy", roster_position: "CPT", drafted_pct: 7, fpts: 33.2 }],
    mine: ["1", "2"],
    tiers,
  });
  const snapshot = contestSnapshot({
    summary,
    contestId: "195390867",
    contestName: "NFL Showdown",
    feeCents: 300,
    tiers,
  });

  assert.equal(snapshot.entries, 60);
  assert.equal(snapshot.unique_lineups, 1);
  assert.equal(snapshot.my_entries, 2);
  assert.equal(snapshot.my_payout_cents, 105000); // $1000 + $50
  assert.equal(snapshot.my_fee_cents, 600);
  assert.equal(snapshot.tiers.length, 2);
  // Reopening must restore what was on screen, charts included.
  assert.equal(snapshot.summary.ownership[0].player, "Brock Purdy");
  assert.equal(snapshot.summary.winners.entries, 20);
  assert.equal(snapshot.summary.mine.length, 2);
  assert.equal(snapshot.summary.field.entries, 60);
});

test("an entry fee typed by hand reads in the shapes people type", () => {
  assert.equal(parseMoneyCents("$3"), 300);
  assert.equal(parseMoneyCents("3.50"), 350);
  assert.equal(parseMoneyCents("$1,111.11"), 111111);
  assert.equal(parseMoneyCents("  $0.25 "), 25);
  assert.equal(parseMoneyCents("free"), null);
  assert.equal(parseMoneyCents(""), null);
  assert.equal(parseMoneyCents(null), null);
});

test("the lineup a saved entry carries is the one the file gave", () => {
  const summary = contestSummary({
    entries: [{ entry_id: "1", rank: 1, points: 100, lineup: "CPT A One FLEX B Two" }],
    mine: ["1"],
  });
  assert.equal(summary.mine[0].lineup_text, "CPT A One FLEX B Two");
  const [row] = contestEntryRows({ mine: summary.mine, contestId: "9" });
  assert.equal(row.lineup_text, "CPT A One FLEX B Two");
});

test("a contest date is written only when there is one, and never from UTC", () => {
  const [undated] = contestEntryRows({ mine: MINE, contestId: "9" });
  assert.equal("date" in undated, false);
  const [dated] = contestEntryRows({ mine: MINE, contestId: "9", date: "2026-01-02" });
  assert.equal(dated.date, "2026-01-02");

  // 9pm on the 18th in UTC-07:00 is the 19th in UTC. The ledger must say the 18th.
  const evening = new Date(2026, 8, 18, 21, 30);
  assert.equal(localDateString(evening), "2026-09-18");
  assert.equal(localDateString(new Date(2026, 0, 5, 0, 5)), "2026-01-05");
  assert.equal(localDateString(new Date("nonsense")), "");
});

test("the snapshot keeps the contest date so a reopened breakdown still knows when it was", () => {
  const summary = contestSummary({
    entries: [{ entry_id: "1", rank: 1, points: 100, lineup: "CPT A FLEX B" }],
    mine: ["1"],
  });
  assert.equal(
    contestSnapshot({ summary, contestId: "9", date: "2026-09-18" }).contest_date,
    "2026-09-18",
  );
  assert.equal(contestSnapshot({ summary, contestId: "9" }).contest_date, null);
});
