import test from "node:test";
import assert from "node:assert/strict";
import { parseDfsCsv, moneyCents } from "./dfsCsv.js";
import {
  inspectResultsCsv,
  parseResultsRows,
  resultTotals,
  resultGroups,
} from "./dfsResults.js";
import { readEntryTemplate, buildEntryCsv } from "./dfsEntryExport.js";
import { importResultsBatches } from "./dfsResultsImport.js";

test("large results CSV preserves every entry and quoted lineup above 5 MB", () => {
  const lineup = 'CPT Player, "One"\nFLEX ' + "Other Player ".repeat(75);
  const cell = '"' + lineup.replaceAll('"', '""') + '"';
  const csv =
    "Entry ID,Contest ID,Points,Lineup\r\n" +
    Array.from({ length: 6001 }, (_, i) => `000${i},002,111.5,${cell}`).join(
      "\r\n",
    );
  assert.ok(csv.length > 5_000_000);
  assert.throws(() => parseDfsCsv(csv), /too large/); // Other upload paths keep their bound.
  const file = inspectResultsCsv(csv);
  const rows = parseResultsRows(file, file.mapping, { kind: "results" });
  assert.equal(rows.length, 6001);
  assert.equal(rows[6000].entry_id, "0006000");
  assert.equal(rows[6000].lineup_text, lineup.trim());
  assert.equal(rows[6000].fee_cents, undefined);
  assert.throws(() => parseDfsCsv("id\n1\n2", { maxRows: 2 }), /entries/);
});

test("large saves use bounded requests and report progress without duplicating rows", async () => {
  const rows = Array.from({ length: 6001 }, (_, i) => ({
    entry_id: String(i),
  }));
  const received = [],
    progress = [];
  await importResultsBatches(
    rows,
    async (url, options) => {
      assert.equal(url, "/api/lineup/results/import?compact=true");
      const batch = JSON.parse(options.body).entries;
      assert.ok(batch.length <= 1000);
      received.push(...batch);
    },
    (saved) => progress.push(saved),
  );
  assert.deepEqual(received, rows);
  assert.deepEqual(progress, [0, 1000, 2000, 3000, 4000, 5000, 6000, 6001]);
});

test("interrupted saves stop and explain partial completion and safe retry", async () => {
  let calls = 0;
  await assert.rejects(
    importResultsBatches(
      Array.from({ length: 2500 }, (_, i) => ({ entry_id: String(i) })),
      async () => {
        if (++calls === 2) throw new Error("Connection lost");
      },
    ),
    /1,000 of 2,500 entries confirmed saved.*without duplicates.*Connection lost/,
  );
  assert.equal(calls, 2);
});

test("CSV roundtrips quotes, commas, multiline cells and string IDs", () => {
  assert.deepEqual(
    parseDfsCsv('\uFEFFID,Name\r\n000123,"One, ""Two""\nThree"\r\n'),
    [
      ["ID", "Name"],
      ["000123", 'One, "Two"\nThree'],
    ],
  );
  assert.throws(() => parseDfsCsv('ID,Name\n1,"broken'), /quoted/);
  assert.equal(moneyCents("$1,234.56"), 123456);
  for (const value of ["", "$-1", "NaN", "1.001"])
    assert.throws(() => moneyCents(value));
});
test("history parsing keeps IDs, cash amounts and dates; rejects missing payouts and duplicate entries", () => {
  const file = inspectResultsCsv(
    "Entry ID,Contest ID,Date,Entry Fee,Winnings\n0001,002,09/10/2026,$5,$12.50",
  );
  const rows = parseResultsRows(file, file.mapping);
  assert.equal(rows[0].entry_id, "0001");
  assert.equal(rows[0].payout_cents, 1250);
  assert.equal(rows[0].date, "2026-09-10");
  assert.throws(
    () =>
      parseResultsRows(
        { ...file, rows: [...file.rows, ...file.rows] },
        file.mapping,
      ),
    /twice/,
  );
  const blank = inspectResultsCsv(
    "Entry ID,Contest ID,Entry Fee,Winnings\n1,2,5,",
  );
  assert.throws(() => parseResultsRows(blank, blank.mapping), /cash/);
  assert.equal(
    parseResultsRows(blank, blank.mapping, { settled: false })[0].status,
    "unsettled",
  );
});
test("score-only import never creates zero-dollar financial fields", () => {
  const file = inspectResultsCsv("EntryId,Points,Rank\n01,111.5,3");
  const row = parseResultsRows(file, file.mapping, {
    kind: "results",
    contestId: "123",
  })[0];
  assert.equal(row.points, 111.5);
  assert.equal(row.fee_cents, undefined);
  assert.equal(row.status, undefined);
});
test("ROI is fee-weighted, unsettled and void entries are excluded, incomplete finance is visible", () => {
  const rows = [
    {
      fee_cents: 100,
      payout_cents: 200,
      status: "settled",
      date: "2026-09-10",
    },
    { fee_cents: 900, payout_cents: 0, status: "settled", date: "2026-09-11" },
    { fee_cents: 100000, payout_cents: 0, status: "unsettled" },
  ];
  const t = resultTotals(rows);
  assert.equal(t.fees, 1000);
  assert.equal(t.net, -800);
  assert.equal(t.roi, -80);
  assert.equal(t.chart[1].fees, 10);
  assert.equal(
    resultTotals([...rows, { status: "settled", fee_cents: 200 }]).roi,
    null,
  );
  assert.equal(
    resultTotals([{ status: "settled", fee_cents: 0, payout_cents: 100 }]).roi,
    null,
  );
});
test("grouping uses saved Captain rather than inferring position from a name", () => {
  const entries = [
    {
      build_id: "b",
      lineup_index: 0,
      status: "settled",
      fee_cents: 500,
      payout_cents: 800,
    },
  ];
  const builds = [
    {
      id: "b",
      lineups: [{ lineup: [{ slot: "CPT", player: "One", position: "RB" }] }],
    },
  ];
  assert.equal(resultGroups(entries, builds)[0].label, "One");
  assert.equal(resultGroups(entries, builds)[0].net, 300);
});

const lineup = {
  lineup: ["CPT", "FLEX1", "FLEX2", "FLEX3", "FLEX4", "FLEX5"].map(
    (slot, i) => ({
      slot,
      player: `Player ${i}`,
      dfs_id: String(100 + i),
      salary: 5000,
      team: i % 2 ? "SF" : "LAR",
    }),
  ),
};
const template =
  'Entry ID,Contest Name,Contest ID,Entry Fee,CPT,FLEX,FLEX,FLEX,FLEX,FLEX\r\n0001,"Contest, One",0010,$5,,,,,,\r\n0002,Second,0020,$10,old,old,old,old,old,old';
test("Edit Entries preserves IDs, contest metadata and unassigned entries", () => {
  const t = readEntryTemplate(template, "draftkings_showdown");
  const out = buildEntryCsv(t, [lineup], { "0001": 0 });
  const rows = parseDfsCsv(out.lines.join("\r\n"));
  assert.deepEqual(rows[1].slice(0, 4), ["0001", "Contest, One", "0010", "$5"]);
  assert.equal(rows[1][4], "Player 0 (100)");
  assert.equal(rows[2][4], "old");
  assert.throws(() => buildEntryCsv(t, [lineup], { unknown: 0 }), /assignment/);
  assert.throws(() => readEntryTemplate(template, "draftkings"), /format/);
  assert.throws(
    () => readEntryTemplate("CPT,FLEX\n1,2", "draftkings_showdown"),
    /reserved-entry/,
  );
});
test("template player catalog blocks IDs from another slate", () => {
  const t = readEntryTemplate(template, "draftkings_showdown");
  t.eligibleIds = new Set(["999"]);
  assert.throws(
    () => buildEntryCsv(t, [lineup], { "0001": 0 }),
    /eligible-player/,
  );
});

test("export compares roster-specific IDs and salaries with the loaded catalog", () => {
  const t = readEntryTemplate(template, "draftkings_showdown");
  const catalog = lineup.lineup.map((p) => ({
    dfs_id: p.dfs_id,
    cpt_dfs_id: p.dfs_id,
    salary: 5000,
    cpt_salary: 5000,
  }));
  assert.equal(buildEntryCsv(t, [lineup], { "0001": 0 }, catalog).changed, 1);
  catalog[0].cpt_dfs_id = "999";
  assert.throws(
    () => buildEntryCsv(t, [lineup], { "0001": 0 }, catalog),
    /loaded slate/,
  );
});
test("stack groups describe the saved QB and pass catchers", () => {
  const entries = [
    { build_id: "b", status: "settled", fee_cents: 500, payout_cents: 0 },
  ];
  const builds = [
    {
      id: "b",
      lineups: [
        {
          lineup: [
            { player: "One", position: "QB", team: "A" },
            { player: "Two", position: "WR", team: "A" },
            { player: "Three", position: "TE", team: "B" },
          ],
        },
      ],
    },
  ];
  assert.equal(resultGroups(entries, builds, "stack")[0].label, "One + 1");
});
