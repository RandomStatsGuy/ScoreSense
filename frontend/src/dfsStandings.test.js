import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { readResultsFile } from "./dfsResultsFile.js";
import {
  inspectResultsCsv,
  parseResultsRows,
  contestIdFromFilename,
} from "./dfsResults.js";
const csv =
  "Rank,EntryId,EntryName,TimeRemaining,Points,Lineup,,Player,Roster Position,%Drafted,FPTS\n1,0001,Example (1/20),0,105.8,CPT One FLEX Two,,Player A,FLEX,50%,999\n2,0002,example (2/20),0,100,CPT Two FLEX One,,Player B,FLEX,40%,888\n3,0003,ExampleFan,0,90,CPT Three FLEX One,,,,,\n,,,,,,,Player C,FLEX,10%,777";
const inspect = () =>
  inspectResultsCsv(csv, { filename: "contest-standings-123.csv" });
test("DraftKings filenames supply the contest ID including download suffixes", () => {
  assert.equal(
    contestIdFromFilename("contest-standings-195390867.csv"),
    "195390867",
  );
  assert.equal(
    contestIdFromFilename("folder/contest-standings-123 (1).csv"),
    "123",
  );
  assert.equal(contestIdFromFilename("contest-standings-123.zip"), "123");
  assert.equal(contestIdFromFilename("anything-123.csv"), "");
});
test("standings omit the side-by-side ownership table and require a personal selection", () => {
  const file = inspect();
  assert.equal(file.isStandings, true);
  assert.equal(file.rows.length, 3);
  assert.equal(file.headers.length, 6);
  assert.equal(file.headers.includes("FPTS"), false);
  assert.throws(
    () => parseResultsRows(file, file.mapping, { kind: "results" }),
    /username/,
  );
  const entries = parseResultsRows(file, file.mapping, {
    kind: "results",
    username: "EXAMPLE",
  });
  assert.deepEqual(
    entries.map((e) => e.entry_id),
    ["0001", "0002"],
  );
  assert.equal(entries[0].contest_id, "123");
  assert.equal(entries[0].points, 105.8);
  assert.equal(entries[0].entry_name, "Example (1/20)");
  assert.equal(entries[0].fee_cents, undefined);
  assert.equal(entries[0].payout_cents, undefined);
  assert.equal(entries[0].status, undefined);
  assert.throws(
    () =>
      parseResultsRows(file, file.mapping, {
        kind: "history",
        username: "Example",
      }),
    /not fees/,
  );
  assert.throws(
    () =>
      parseResultsRows(file, file.mapping, {
        kind: "results",
        site: "fanduel",
        username: "Example",
      }),
    /DraftKings/,
  );
  assert.throws(
    () =>
      parseResultsRows(file, file.mapping, {
        kind: "results",
        username: "Missing",
      }),
    /No entries matched/,
  );
});
test("known entry IDs are scoped by site and contest; entered username takes precedence", () => {
  const file = inspect();
  const knownEntries = [
    { site: "draftkings", contest_id: "123", entry_id: "0003" },
    { site: "draftkings", contest_id: "999", entry_id: "0001" },
    { site: "fanduel", contest_id: "123", entry_id: "0002" },
  ];
  assert.deepEqual(
    parseResultsRows(file, file.mapping, { kind: "results", knownEntries }).map(
      (e) => e.entry_id,
    ),
    ["0003"],
  );
  assert.deepEqual(
    parseResultsRows(file, file.mapping, {
      kind: "results",
      knownEntries,
      username: "Example",
    }).map((e) => e.entry_id),
    ["0001", "0002"],
  );
  assert.equal(
    parseResultsRows(file, file.mapping, {
      kind: "results",
      username: "Example",
      contestId: "456",
    })[0].contest_id,
    "456",
  );
});
test("ZIP and CSV imports produce identical standings, including renamed archives", async () => {
  for (const name of ["contest-standings-123.zip", "download.zip"]) {
    const file = new File(
      [
        zipSync({
          "folder/contest-standings-123.csv": strToU8(csv),
          "README.txt": strToU8("ignore"),
        }),
      ],
      name,
    );
    const read = await readResultsFile(file);
    assert.equal(read.text, csv);
    assert.deepEqual(
      inspectResultsCsv(read.text, { filename: read.filename }),
      inspect(),
    );
  }
  assert.equal(
    (await readResultsFile(new File([csv], "contest-standings-123.csv"))).text,
    csv,
  );
});
test("ZIP selection rejects ambiguous, mismatched and invalid downloads", async () => {
  for (const files of [{}, { "a.csv": strToU8(csv), "b.csv": strToU8(csv) }])
    await assert.rejects(
      readResultsFile(new File([zipSync(files)], "download.zip")),
      /one results CSV/,
    );
  await assert.rejects(
    readResultsFile(
      new File(
        [zipSync({ "contest-standings-456.csv": strToU8(csv) })],
        "contest-standings-123.zip",
      ),
    ),
    /different contest IDs/,
  );
  await assert.rejects(
    readResultsFile(new File(["broken"], "download.zip")),
    /could not be read/,
  );
});
test("ZIP uncompressed size is bounded before inflating", async () => {
  const bytes = zipSync({ "a.csv": strToU8(csv) });
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < bytes.length - 28; i++)
    if (view.getUint32(i, true) === 0x02014b50) {
      view.setUint32(i + 24, 100_000_001, true);
      break;
    }
  await assert.rejects(
    readResultsFile(new File([bytes], "download.zip")),
    /100 MB/,
  );
});
