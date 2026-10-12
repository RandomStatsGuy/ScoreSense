import assert from "node:assert/strict";
import test from "node:test";
import { buildEntryCsv, readEntryTemplate } from "./dfsEntryExport.js";
import { buildSiteLineupCsv } from "./dfsExport.js";
import { csvLines, parseDfsCsv } from "./dfsCsv.js";

const slots = ["QB", "RB1", "RB2", "WR1", "WR2", "WR3", "TE", "FLEX", "DST"];
const positions = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "WR", "DST"];
function lineup(offset = 0) {
  return { lineup: slots.map((slot, i) => ({ slot, player_id: `synthetic-${offset + i}`,
    dfs_id: String(9007199254740991000n + BigInt(offset + i)), player: `Synthetic ${offset + i}`,
    position: positions[i], team: i % 2 ? "KC" : "BUF", salary: 4000 })) };
}
function templateRows(count = 2, { catalog = false } = {}) {
  const rows = [["Entry ID", "Contest Name", "Contest ID", "Entry Fee", "QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST", "Note", "", "ID"],
    ...Array.from({ length: count }, (_, i) => [String(9007199254740992000n + BigInt(i)), 'Synthetic, "Classic"', "000055", "$0.25",
      ...slots.map(() => "Original"), i ? "=Prescribed metadata" : "Keep\nthis note"])];
  if (catalog) lineup().lineup.forEach(p => rows.push([...Array(15).fill(""), p.dfs_id]));
  return rows;
}
const read = rows => readEntryTemplate(csvLines(rows).join("\r\n"), "draftkings");
const assignments = (t, indexes = [0]) => Object.fromEntries(indexes.map((n, i) => [t.entries[i].id, n]));

test("T25 selected entry mappings cannot silently repeat an output lineup", () => {
  const t = read(templateRows(2, { catalog: true }));
  assert.throws(() => buildEntryCsv(t, [lineup()], assignments(t, [0, 0])), /distinct|one-to-one|assigned more than once/i);
});

test("T06 provider IDs must arrive as exact strings, never pre-rounded numbers", () => {
  const l = lineup(); l.lineup[0].dfs_id = 9007199254740992000;
  assert.equal(buildSiteLineupCsv("draftkings", [l]).ok, false);
});

test("T26 preserves preamble instructions, blank rows, ordered duplicate columns and unrelated rows", () => {
  const rows = [["Download instructions: update selected entries only"], [""], ...templateRows(2, { catalog: true })];
  const t = read(rows), before = structuredClone(t.rows);
  const result = buildEntryCsv(t, [lineup()], assignments(t));
  const written = parseDfsCsv(result.lines.join("\r\n"), { preserveEmptyRows: true });
  assert.equal(result.changed, 1);
  assert.deepEqual(t.rows, before);
  assert.deepEqual(written[t.entries[1].rowIndex], before[t.entries[1].rowIndex]);
  assert.deepEqual(written[0], before[0]);
});

test("T26 entry-column instructions are not mistaken for a malformed reservation", () => {
  const rows = templateRows(1, { catalog: true });
  rows.push(["Instructions: leave unrelated entries unchanged"]);
  const t = read(rows);
  assert.equal(t.entries.length, 1);
});

test("T25 missing eligibility metadata blocks export without a verified loaded catalog", () => {
  const t = read(templateRows());
  assert.throws(() => buildEntryCsv(t, [lineup()], assignments(t)), /eligible|catalog|slate/i);
  assert.equal(buildEntryCsv(t, [lineup()], assignments(t), lineup().lineup).changed, 1);
});

test("T26 formula-like generated player cells are blocked without rewriting original template cells", () => {
  const t = read(templateRows(2, { catalog: true })), l = lineup();
  l.lineup[0].player = '=HYPERLINK("https://example.invalid")';
  assert.throws(() => buildEntryCsv(t, [l], assignments(t)), /formula|name/i);
  assert.equal(t.rows[t.entries[1].rowIndex][13], "=Prescribed metadata");
});

test("T25/T30 output bytes and audit manifest are deterministic and preserve exact entry/contest IDs", () => {
  const t = read(templateRows(2, { catalog: true }));
  const first = buildEntryCsv(t, [lineup()], assignments(t));
  const second = buildEntryCsv(t, [lineup()], assignments(t));
  assert.equal(typeof first.csv, "string");
  assert.deepEqual(first, second);
  assert.equal(first.manifest.lifecycle, "csv_created");
  assert.equal(first.manifest.acceptance, "unconfirmed");
  assert.equal(first.manifest.assignments[0].entryId, t.entries[0].id);
  assert.equal(first.manifest.assignments[0].contestId, "000055");
  assert.equal(first.manifest.untouchedEntryCount, 1);
  assert.ok(first.manifest.preservedFormulaCells.length);
});

test("T31 explicit late-swap/unknown lock contracts stay gated", () => {
  const t = read(templateRows(1, { catalog: true }));
  for (const validation of [{ mode: "late_swap" }, { mode: "pre_lock", lockState: "unknown" }, { mode: "pre_lock", lockState: "started" }]) {
    assert.throws(() => buildEntryCsv(t, [lineup()], assignments(t), null, { validation }), /lock|late|started/i);
  }
});

test("T25/T26 150 approved lineups round-trip exactly while preserving two unrelated contests", () => {
  const approved = Array.from({ length: 150 }, (_, i) => lineup(i * 9));
  const rows = templateRows(152);
  rows[151][2] = "000066"; rows[152][2] = "000077";
  approved.flatMap(l => l.lineup).forEach(p => rows.push([...Array(15).fill(""), p.dfs_id]));
  const text = `\uFEFF${csvLines(rows).join("\r\n")}`;
  const t = readEntryTemplate(text, "draftkings");
  const mapping = assignments(t, approved.map((_, i) => i));
  const exported = buildEntryCsv(t, approved, mapping);
  const roundTrip = readEntryTemplate(exported.csv, "draftkings");
  assert.equal(exported.changed, 150); assert.equal(exported.manifest.selectedEntryCount, 150);
  assert.equal(exported.manifest.untouchedEntryCount, 2);
  assert.equal(roundTrip.entries.length, 152);
  for (let i = 0; i < 150; i++) {
    const entry = roundTrip.entries[i];
    assert.equal(entry.id, t.entries[i].id);
    assert.deepEqual(roundTrip.rows[entry.rowIndex].slice(t.start, t.start + 9),
      approved[i].lineup.map(p => `${p.player} (${p.dfs_id})`));
    assert.deepEqual(exported.manifest.assignments[i].playerIds, approved[i].lineup.map(p => p.dfs_id));
  }
  for (const entry of roundTrip.entries.slice(150)) {
    assert.deepEqual(roundTrip.rows[entry.rowIndex], t.rows[entry.rowIndex]);
  }
});

test("T27 a lineup-library file is never invented into a reserved-entry template", () => {
  const library = buildSiteLineupCsv("draftkings", [lineup()]);
  assert.throws(() => readEntryTemplate(library.lines.join("\n"), "draftkings"), /Edit Entries|reserved-entry IDs/);
});

test("T06 exact string IDs keep leading zeroes and assignments reject coercible non-index values", () => {
  const l = lineup(); l.lineup[0].dfs_id = "000001";
  const rows = templateRows(1);
  l.lineup.forEach(p => rows.push([...Array(15).fill(""), p.dfs_id]));
  const t = read(rows);
  assert.match(buildEntryCsv(t, [l], assignments(t)).csv, /Synthetic 0 \(000001\)/);
  for (const value of [false, true, [], " ", "00", "0.0", "0e0"]) {
    assert.throws(() => buildEntryCsv(t, [l], { [t.entries[0].id]: value }), /assignment/);
  }
});

test("T26 side catalog identity columns are resolved after the ordered roster section", () => {
  const rows = templateRows(1, { catalog: true });
  rows[0].unshift("ID");
  rows.slice(1).forEach(row => row.unshift("999999"));
  const t = read(rows);
  assert.equal(t.eligibleIds.has("999999"), false);
  assert.equal(buildEntryCsv(t, [lineup()], assignments(t)).changed, 1);
});
