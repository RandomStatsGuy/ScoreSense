import assert from "node:assert/strict";
import test from "node:test";
import { auditPortfolio, buildPortfolioEntryCsv, classicLineupKey, createPortfolioBatch, portfolioBuildPayload } from "./dfsPortfolio.js";
import { readEntryTemplate } from "./dfsEntryExport.js";
import { csvLines } from "./dfsCsv.js";
import { PORTFOLIO_BACKUP_MAX_BYTES, readPortfolioBackup, readPortfolioBackupFile, writePortfolioBackup } from "./dfsPortfolioBackup.js";

const timestamp = "2026-10-10T12:00:00.123456+00:00";
const slots = ["QB", "RB1", "RB2", "WR1", "WR2", "WR3", "TE", "FLEX", "DST"];
const positions = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "WR", "DST"];
function batch(offset = 0, count = 75) {
  const salaryCatalog = Array.from({ length: 170 }, (_, i) => ({ player_id: `p${i}`, dfs_id: String(i + 1),
    Player: `Player ${i}`, Team: i % 2 ? "KC" : "BUF", Position: positions[i] || "WR", salary: 4000,
    "Projected Points": 10, "Low (P10)": 5, "High (P90)": 15 }));
  const lineups = Array.from({ length: count }, (_, j) => ({ ok: true, objective: "median", total_points: 90,
    total_salary: 36000, salary_remaining: 14000, note: "Original optimizer note",
    lineup: slots.map((slot, i) => {
      const p = salaryCatalog[i === 5 ? 9 + offset + j : i];
      return { slot, player_id: p.player_id, dfs_id: p.dfs_id, player: p.Player, position: p.Position, team: p.Team,
        salary: p.salary, proj: 10, floor: 5, ceiling: 15, value: 2.5, injury_status: null, on_bye: false };
    }),
  }));
  return createPortfolioBatch({ context: { site: "draftkings", season: 2026, week: 5, slateId: "123", source: "live" },
    slateName: "Classic · 11 games", salaryCatalog, lineups,
    salarySnapshot: { id: "salary-original", captured_at: timestamp, site: "draftkings", slate_id: "123", scoring_verified: false, lock_state_verified: false },
    settings: { site: "draftkings", slate_id: "123", season: 2026, week: 5, salary_snapshot_id: "salary-original",
      locked_player_ids: ["p0"], projection_overrides: { p0: { proj: 10, floor: 5, ceiling: 15 } },
      ownership: { p0: 12 }, note: "Historical inputs", snapshot_at: timestamp,
      build_snapshot: { id: `snapshot-${offset}`, captured_at: timestamp, content: { schema_version: "dfs_build_inputs_v1",
        input_pool: salaryCatalog, parameters: { locked_player_ids: ["p0"] } } } },
  }, `Batch ${offset}`, `batch-${offset}`);
}
const original = () => [batch(), batch(75)];
const document = () => JSON.parse(writePortfolioBackup(original(), { p0: "150", p1: "", removed: null }, timestamp));
const restore = value => readPortfolioBackup(JSON.stringify(value));
function template() {
  return readEntryTemplate(csvLines([["Entry ID", "Contest ID", "Contest Name", "Entry Fee", "QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST", "Note"],
    ...Array.from({ length: 151 }, (_, i) => [String(i + 1), "900", "Reserved Classic", "$3.00", ...Array(9).fill("Keep"), "Metadata"])]).join("\n"), "draftkings");
}

test("150-lineup round trip preserves all historical JSON, timestamps, limits, identities, audit and CSV", () => {
  const batches = original(), limits = { p0: "150", p1: "", removed: null };
  const json = writePortfolioBackup(batches, limits, timestamp), backup = readPortfolioBackup(json);
  assert.deepEqual(backup.batches, batches); assert.deepEqual(backup.appearanceLimits, limits);
  assert.equal(backup.exportedAt, timestamp);
  assert.deepEqual(backup.batches.flatMap(b => b.lineups.map(classicLineupKey)), batches.flatMap(b => b.lineups.map(classicLineupKey)));
  assert.deepEqual(auditPortfolio(backup.batches, backup.appearanceLimits), auditPortfolio(batches, limits));
  assert.throws(() => { backup.batches[0].settings.build_snapshot.content.input_pool[0].salary = 1; }, TypeError);
  const t = template(), assignments = Object.fromEntries(t.entries.slice(0, 150).map((e, i) => [e.id, i]));
  assert.deepEqual(buildPortfolioEntryCsv(t, backup.batches, assignments, backup.appearanceLimits), buildPortfolioEntryCsv(t, batches, assignments, limits));
  assert.equal(portfolioBuildPayload(backup.batches[0]).settings.snapshot_at, timestamp);
});

test("restores duplicate lineups and exceeded limits without repair, and both export gates remain", () => {
  const d = document(); d.batches[1].lineups[0] = structuredClone(d.batches[0].lineups[0]);
  d.appearanceLimits.p0 = "149";
  const restored = restore(d), audit = auditPortfolio(restored.batches, restored.appearanceLimits);
  assert.equal(audit.total, 150); assert.equal(audit.unique, 149); assert.equal(audit.duplicates.length, 1);
  assert.match(audit.errors[0], /150 appearances exceeds/);
  const t = template(), assignments = Object.fromEntries(t.entries.slice(0, 150).map((e, i) => [e.id, i]));
  assert.throws(() => buildPortfolioEntryCsv(t, restored.batches, assignments, restored.appearanceLimits), /duplicate/);
  const limitsOnly = restore({ ...document(), appearanceLimits: { p0: 149 } });
  assert.throws(() => buildPortfolioEntryCsv(t, limitsOnly.batches, assignments, limitsOnly.appearanceLimits), /exceeds/);
});

test("malformed, unsupported and oversized files reject before returning a replacement", async () => {
  for (const value of ["", "{", "null", "[]", '{"schema":"other"}']) assert.throws(() => readPortfolioBackup(value));
  const d = document(); d.version = 2; assert.throws(() => restore(d), /supported version/);
  assert.throws(() => readPortfolioBackup(" ".repeat(PORTFOLIO_BACKUP_MAX_BYTES + 1)), /20 MiB/);
  let read = false;
  await assert.rejects(readPortfolioBackupFile({ size: PORTFOLIO_BACKUP_MAX_BYTES + 1, text: () => { read = true; } }), /20 MiB/);
  assert.equal(read, false);
});

test("strict schema rejects altered rosters, identities, catalogs, dates, limits and internal fields", () => {
  const mutations = [
    d => { d.batches[0].lineups[0].lineup.pop(); },
    d => { d.batches[0].lineups[0].lineup[1].slot = "QB"; },
    d => { d.batches[0].lineups[0].lineup[0].player_id = "unknown"; },
    d => { d.batches[0].lineups[0].lineup[0].dfs_id = "999"; },
    d => { d.batches[0].lineups[0].lineup[0].salary++; },
    d => { d.batches[0].lineups[0].lineup[0].proj = "10"; },
    d => { d.batches[0].salaryCatalog[1].player_id = "p0"; },
    d => { d.batches[0].salaryCatalog[1].dfs_id = "1"; },
    d => { d.batches[0].settings.snapshot_at = "yesterday"; },
    d => { d.batches[0].settings.snapshot_at = "2026-02-31T12:00:00Z"; },
    d => { d.batches[0].settings.build_snapshot = { id: "missing-historical-content" }; },
    d => { d.batches[0].settings.salary_snapshot_id = "different"; },
    d => { d.batches[1].id = d.batches[0].id; },
    d => { d.appearanceLimits.p0 = "bad"; },
    d => { d.appearanceLimits.p0 = -1; },
    d => { d.appearanceLimits.p0 = 1.5; },
    d => { d.appearanceLimits.p0 = false; },
    d => { d.batches[0].settings.build_snapshot.content.credentials = { token: "secret" }; },
    d => { d.batches[0].settings.build_snapshot.content["__proto__"] = null; Object.defineProperty(d.batches[0].settings, "constructor", { value: "unsafe", enumerable: true }); },
    d => { d.batches[0].salarySnapshot.scoring_verified = true; },
    d => { d.batches[0].extra = "unknown"; },
    d => { d.assignments = { 1: 0 }; },
    d => { d.portfolioBuildIds = { "batch-0": "foreign-build" }; },
  ];
  for (const mutate of mutations) { const d = document(); mutate(d); assert.throws(() => restore(d)); }
});

test("mixed slate, season, week, source and catalog imports are incompatible", () => {
  for (const mutate of [b => { b.context.slateId = "other"; }, b => { b.context.week = 6; },
    b => { b.context.season = 2025; }, b => { b.context.source = "upload"; },
    b => { b.salarySnapshot.id = "other"; }, b => { b.salaryCatalog[169].salary++; },
    b => { b.context.site = "draftkings_showdown"; }]) {
    const d = document(); mutate(d.batches[1]); assert.throws(() => restore(d));
  }
});

test("bounds cover batches, lineup totals, catalog rows, nested data and nonfinite numbers", () => {
  const d = document(); d.batches = Array(51).fill(d.batches[0]); assert.throws(() => restore(d));
  const oversized = document(); oversized.batches[0].salaryCatalog = Array(5001).fill(oversized.batches[0].salaryCatalog[0]); assert.throws(() => restore(oversized));
  const tooMany = document(); tooMany.batches[0].lineups = Array(151).fill(tooMany.batches[0].lineups[0]); assert.throws(() => restore(tooMany));
  const total = document(); total.batches = Array.from({ length: 7 }, (_, i) => ({ ...total.batches[0], id: `batch-${i}` })); assert.throws(() => restore(total));
  const nested = document(); let cursor = nested.batches[0].settings.build_snapshot;
  for (let i = 0; i < 25; i++) cursor = cursor.child = {};
  assert.throws(() => restore(nested));
  assert.throws(() => readPortfolioBackup(JSON.stringify(document()).replace('"total_points":90', '"total_points":1e999')));
  const changed = structuredClone(original()); changed[0].lineups[0].total_points = NaN;
  assert.throws(() => writePortfolioBackup(changed, {}));
});

test("uploaded salary history and explicit null snapshots round trip without live rebinding", () => {
  const changed = structuredClone(original());
  changed.forEach(b => {
    b.context.source = "upload"; b.context.slateId = ""; b.settings.slate_id = null;
    b.settings.build_snapshot = null; b.settings.salary_snapshot_id = null; b.salarySnapshot = null;
  });
  assert.deepEqual(readPortfolioBackup(writePortfolioBackup(changed, {})).batches, changed);
});

test("backup excludes extra runtime saved mappings and does not manufacture ownership", () => {
  const changed = structuredClone(original()); changed[0].savedBuild = { id: "foreign" };
  const json = writePortfolioBackup(changed, {}), backup = readPortfolioBackup(json);
  assert.equal(json.includes("foreign"), false); assert.equal(backup.batches[0].savedBuild, undefined);
  assert.equal(backup.batches[0].salarySnapshot.scoring_verified, false);
  const payload = portfolioBuildPayload(backup.batches[0]);
  assert.equal(payload.id, undefined); assert.equal(payload.owner, undefined);
  assert.equal(payload.settings.build_snapshot.id, "snapshot-0");
});
