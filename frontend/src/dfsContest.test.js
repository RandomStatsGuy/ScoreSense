/**
 * Run with: node --test frontend/src/dfsContest.test.js
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  contestSummary,
  winnersComposition,
  lineupKey,
  parseLineupSlots,
  parsePrizeStructure,
  payoutsByRank,
  spacedLabels,
  prizeForPosition,
} from "./dfsContest.js";
import { inspectResultsCsv } from "./dfsResults.js";

const STANDINGS =
  "Rank,EntryId,EntryName,TimeRemaining,Points,Lineup,,Player,Roster Position,%Drafted,FPTS\n" +
  "1,0001,asmit25290,0,105.8,CPT Demarcus Robinson FLEX Christian McCaffrey FLEX Brock Purdy,,Christian McCaffrey,FLEX,51.95%,13.8\n" +
  "1,0002,SkipperRush (20/20),0,105.8,CPT Demarcus Robinson FLEX Christian McCaffrey FLEX Brock Purdy,,Christian McCaffrey,CPT,19.76%,20.7\n" +
  "3,0003,wdmasir (13/20),0,104.45,CPT Brock Purdy FLEX Christian McCaffrey FLEX Kyren Williams,,Brock Purdy,CPT,6.95%,33.15\n" +
  ",,,,,,,Deebo Samuel Sr.,FLEX,16.05%,18";

test("lineup strings split on slot words, keeping names that contain spaces and suffixes", () => {
  const slots = parseLineupSlots(
    "CPT Demarcus Robinson FLEX Christian McCaffrey FLEX Deebo Samuel Sr.",
  );
  assert.deepEqual(slots, [
    { slot: "CPT", player: "Demarcus Robinson" },
    { slot: "FLEX", player: "Christian McCaffrey" },
    { slot: "FLEX", player: "Deebo Samuel Sr." },
  ]);
  assert.deepEqual(parseLineupSlots(""), []);
});

test("lineup identity ignores flex order but not who captained", () => {
  const a = parseLineupSlots("CPT One FLEX Two FLEX Three");
  const b = parseLineupSlots("CPT One FLEX Three FLEX Two");
  const c = parseLineupSlots("CPT Two FLEX One FLEX Three");
  assert.equal(lineupKey(a), lineupKey(b));
  assert.notEqual(lineupKey(a), lineupKey(c));
});

test("prize tables paste in several shapes", () => {
  const tiers = parsePrizeStructure(
    "1st\t$1,000.00\n2nd  $500\n3rd - 5th\t$200.00\n6-10 | 100\nnonsense line\n",
  );
  assert.deepEqual(tiers, [
    { from: 1, to: 1, cents: 100000 },
    { from: 2, to: 2, cents: 50000 },
    { from: 3, to: 5, cents: 20000 },
    { from: 6, to: 10, cents: 10000 },
  ]);
  assert.equal(prizeForPosition(tiers, 4), 20000);
  assert.equal(prizeForPosition(tiers, 11), 0);
});

test("ties pool the positions they occupy and split evenly", () => {
  const tiers = parsePrizeStructure("1st\t$1000\n2nd\t$500\n3rd\t$300\n4th - 5th\t$200\n6th - 10th\t$100\n11th - 20th\t$50");
  // Six entries tied at rank 7 occupy positions 7-12: four at $100, two at $50.
  const pay = payoutsByRank([7, 7, 7, 7, 7, 7], tiers);
  assert.equal(pay.get(7), Math.round(50000 / 6));
  // Looking rank 7 up directly would pay $100 each — nearly double.
  assert.equal(prizeForPosition(tiers, 7), 10000);

  const two = payoutsByRank([1, 1, 3], tiers);
  assert.equal(two.get(1), 75000); // ($1000 + $500) / 2
  assert.equal(two.get(3), 30000);
});

test("the ownership table survives the import that drops it from entry rows", () => {
  const file = inspectResultsCsv(STANDINGS, { filename: "contest-standings-195390867.csv" });
  // Unchanged for the import path.
  assert.equal(file.headers.length, 6);
  assert.equal(file.headers.includes("FPTS"), false);
  assert.equal(file.rows.length, 3);
  // And now also carried alongside, with its own row count.
  assert.equal(file.players.length, 4);
  assert.deepEqual(file.players[0], {
    player: "Christian McCaffrey",
    roster_position: "FLEX",
    drafted_pct: 51.95,
    fpts: 13.8,
  });
  assert.equal(file.players[3].player, "Deebo Samuel Sr.");
});

test("summary separates captain from flex ownership and counts duplicate lineups", () => {
  const file = inspectResultsCsv(STANDINGS, { filename: "contest-standings-1.csv" });
  const entries = file.rows.map((r) => ({
    entry_id: r[1],
    entry_name: r[2],
    rank: r[0],
    points: r[4],
    lineup: r[5],
  }));
  const tiers = parsePrizeStructure("1st\t$1000\n2nd\t$500\n3rd\t$300");
  const summary = contestSummary({ entries, players: file.players, mine: ["0003"], tiers });

  assert.equal(summary.field.entries, 3);
  assert.equal(summary.field.unique_lineups, 2); // the two rank-1 entries match

  const purdyCpt = summary.ownership.find(
    (o) => o.player === "Brock Purdy" && o.roster_position === "CPT",
  );
  assert.equal(purdyCpt.mine_count, 1);
  assert.ok(purdyCpt.leverage > 90); // 100% mine against 6.95% field

  const mccaffreyCpt = summary.ownership.find(
    (o) => o.player === "Christian McCaffrey" && o.roster_position === "CPT",
  );
  assert.equal(mccaffreyCpt.mine_count, 0); // captained by someone else, not me
  assert.ok(mccaffreyCpt.leverage < 0);

  const entry = summary.mine[0];
  assert.equal(entry.rank, 3);
  assert.equal(entry.payout_cents, 30000);
  assert.equal(entry.duplicates, 0);
});

test("without a prize structure nothing invents money", () => {
  const summary = contestSummary({
    entries: [{ entry_id: "1", rank: 1, points: 100, lineup: "CPT A FLEX B" }],
    mine: ["1"],
  });
  assert.equal(summary.mine[0].payout_cents, null);
  assert.equal(summary.field.paid_entries, null);
});

test("the winners group keeps whole ties and reports the size it actually used", () => {
  // 200 entries, ranks 1..200, each rostering a captain and one flex.
  const rows = [];
  for (let i = 1; i <= 200; i += 1) {
    rows.push({
      rank: i,
      slots: [
        { slot: "CPT", player: i <= 2 ? "Rare Captain" : "Chalk Captain" },
        { slot: "FLEX", player: i % 2 ? "Even Flex" : "Odd Flex" },
      ],
    });
  }
  const top = winnersComposition(rows, { topPct: 1, minEntries: 0 });
  assert.equal(top.cutoff_rank, 2);
  assert.equal(top.entries, 2);
  const captain = top.players.find((p) => p.slot === "CPT");
  assert.equal(captain.player, "Rare Captain");
  assert.equal(captain.pct, 100);

  // A floor keeps one lucky lineup from defining "the winners".
  const floored = winnersComposition(rows, { topPct: 1, minEntries: 20 });
  assert.equal(floored.entries, 20);
  assert.equal(floored.cutoff_rank, 20);

  // Eight entries tied on the cutoff rank all stay in — a tie is never split.
  const tied = rows.map((r, i) => ({ ...r, rank: i < 10 ? 1 : r.rank }));
  const group = winnersComposition(tied, { topPct: 1, minEntries: 0 });
  assert.equal(group.cutoff_rank, 1);
  assert.equal(group.entries, 10);

  assert.deepEqual(winnersComposition([]), {
    top_pct: 1,
    cutoff_rank: null,
    entries: 0,
    players: [],
  });
});

test("a small field makes the winners group the whole field, and says so", () => {
  const file = inspectResultsCsv(STANDINGS, { filename: "contest-standings-1.csv" });
  const entries = file.rows.map((r) => ({
    entry_id: r[1],
    entry_name: r[2],
    rank: r[0],
    points: r[4],
    lineup: r[5],
  }));
  const summary = contestSummary({ entries, players: file.players, mine: ["0003"] });
  assert.equal(summary.winners.entries, 3);
  assert.equal(summary.winners.whole_field, true);
});

test("ownership carries what the winners played beside what the field played", () => {
  // Two ranks of entries: the leader captained Purdy, the rest captained Robinson.
  const entries = [];
  for (let i = 1; i <= 100; i += 1) {
    entries.push({
      entry_id: String(i),
      entry_name: `player${i}`,
      rank: i,
      points: 200 - i,
      lineup:
        i <= 5
          ? "CPT Brock Purdy FLEX Christian McCaffrey"
          : "CPT Demarcus Robinson FLEX Christian McCaffrey",
    });
  }
  const players = [
    { player: "Brock Purdy", roster_position: "CPT", drafted_pct: 5, fpts: 33.15 },
    { player: "Demarcus Robinson", roster_position: "CPT", drafted_pct: 95, fpts: 40.5 },
    { player: "Christian McCaffrey", roster_position: "FLEX", drafted_pct: 100, fpts: 13.8 },
    { player: "Never Rostered", roster_position: "FLEX", drafted_pct: 0, fpts: 2 },
  ];
  const summary = contestSummary({ entries, players, mine: [], topPct: 5 });

  assert.equal(summary.winners.entries, 20); // the 20-entry floor, not 5
  assert.equal(summary.winners.whole_field, false);

  const purdy = summary.ownership.find((o) => o.player === "Brock Purdy");
  assert.equal(purdy.winners_count, 5);
  assert.equal(purdy.winners_pct, 25); // 5 of the top 20
  assert.equal(purdy.winners_edge, 20); // 25% of winners against 5% of the field

  const robinson = summary.ownership.find((o) => o.player === "Demarcus Robinson");
  assert.equal(robinson.winners_pct, 75);

  // A player nobody rostered reads as zero, not as missing.
  const absent = summary.ownership.find((o) => o.player === "Never Rostered");
  assert.equal(absent.winners_count, 0);
  assert.equal(absent.winners_pct, 0);
});

test("scatter labels go to the heaviest points and skip anything crowding them", () => {
  const points = [
    { key: "star", x: 10, y: 100, weight: 100 },
    { key: "twin", x: 11, y: 99, weight: 99 }, // all but on top of star
    { key: "far", x: 90, y: 60, weight: 60 },
    { key: "low", x: 50, y: 10, weight: 10 },
  ];
  assert.deepEqual(spacedLabels(points, { limit: 4, minGap: 0.1 }), ["star", "far", "low"]);
  // The limit still binds once nothing is crowded.
  assert.deepEqual(spacedLabels(points, { limit: 2, minGap: 0.1 }), ["star", "far"]);
  // A gap of zero labels everything, in weight order.
  assert.deepEqual(spacedLabels(points, { limit: 4, minGap: 0 }), ["star", "twin", "far", "low"]);
  // Points with no usable coordinates never get a label.
  assert.deepEqual(spacedLabels([{ key: "a", x: null, y: 3 }]), []);
  assert.deepEqual(spacedLabels([]), []);
});
