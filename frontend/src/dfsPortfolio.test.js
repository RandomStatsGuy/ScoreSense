import assert from "node:assert/strict";
import test from "node:test";
import {
  appendPortfolioBatch, auditPortfolio, buildPortfolioEntryCsv, classicLineupKey,
  createPortfolioBatch, portfolioBuildPayload, portfolioEntryRecords, removePortfolioBatch,
} from "./dfsPortfolio.js";
import { readEntryTemplate } from "./dfsEntryExport.js";
import { csvLines, parseDfsCsv } from "./dfsCsv.js";
import { DFS_PORTFOLIO_COPY as C } from "./dfsToolPresentation.js";

const slots = ["QB", "RB1", "RB2", "WR1", "WR2", "WR3", "TE", "FLEX", "DST"];
const positions = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "WR", "DST"];
function source(count = 1, offset = 0) {
  const salaryCatalog = Array.from({ length: 170 }, (_, i) => ({ player_id: `p${i + 1}`, dfs_id: String(i + 1),
    Player: `Player ${i + 1}`, Team: i % 2 ? "BUF" : "KC", Position: positions[i] || "WR", salary: 4000 }));
  const lineups = Array.from({ length: count }, (_, n) => ({
    total_salary: 36000, total_points: 90,
    lineup: slots.map((slot, i) => {
      const p = salaryCatalog[i === 5 ? 9 + offset + n : i];
      return { slot, player_id: p.player_id, dfs_id: p.dfs_id, player: p.Player, team: p.Team,
        position: p.Position, salary: p.salary, proj: 10, floor: 5, ceiling: 15 };
    }),
  }));
  return { context: { site: "draftkings", season: 2026, week: 5, slateId: "main", source: "live" },
    slateName: "Main slate", salaryCatalog, salarySnapshot: { id: "catalog-1" }, lineups,
    settings: { locked_player_ids: ["p1"], projection_overrides: { p1: { proj: 10, floor: 5, ceiling: 15 } },
      build_snapshot: { id: "build-snapshot", players: [{ player_id: "p1", proj: 10 }] }, note: "Original note", snapshot_at: "2026-10-10T12:00:00Z" },
  };
}
const batch = (count = 1, offset = 0, label = "Batch A") => createPortfolioBatch(source(count, offset), label, `${label}-${offset}`);
function entryTemplate(count = 3, eligibleIds = null) {
  const headers = ["Entry ID", "Contest ID", "Contest Name", "Entry Fee", "QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST", "Notes", "ID"];
  const rows = [headers, ...Array.from({ length: count }, (_, i) => [String(101 + i), String(700 + i),
    'Reserved, "Classic"', "$3.00", ...slots.map((_, j) => `Keep ${j}`), "Keep this\nmetadata", ""])];
  if (eligibleIds) eligibleIds.forEach(id => rows.push([...Array(14).fill(""), String(id)]));
  return readEntryTemplate(csvLines(rows).join("\n"), "draftkings");
}

test("Classic duplicate identity ignores row order, WR slots and WR/FLEX permutations", () => {
  const original = source().lineups[0], permutation = structuredClone(original);
  [permutation.lineup[3].slot, permutation.lineup[7].slot] = [permutation.lineup[7].slot, permutation.lineup[3].slot];
  [permutation.lineup[4].slot, permutation.lineup[5].slot] = [permutation.lineup[5].slot, permutation.lineup[4].slot];
  permutation.lineup.reverse();
  assert.equal(classicLineupKey(original), classicLineupKey(permutation));
  const other = source(); other.lineups = [permutation];
  const batches = appendPortfolioBatch([batch()], createPortfolioBatch(other, "Permuted", "b"));
  const audit = auditPortfolio(batches);
  assert.equal(audit.total, 2); assert.equal(audit.unique, 1); assert.equal(audit.duplicates.length, 1);
  assert.equal(audit.shortfall, 149);
  assert.throws(() => buildPortfolioEntryCsv(entryTemplate(), batches, { 101: 0, 102: 1 }), /duplicate/);
});

test("removing a batch recomputes all counts, percentages, duplicates and shortfall", () => {
  const a = batch(2), b = batch(1, 1, "Batch B");
  const before = auditPortfolio([a, b]);
  assert.equal(before.unique, 2); assert.equal(before.duplicates.length, 1);
  const remaining = removePortfolioBatch([a, b], a.id), after = auditPortfolio(remaining);
  assert.equal(remaining.length, 1); assert.equal(after.total, 1); assert.equal(after.unique, 1);
  assert.equal(after.duplicates.length, 0); assert.equal(after.shortfall, 149);
  assert.equal(after.players.find(p => p.id === "p11").percent, 100);
  assert.equal(after.players.some(p => p.id === "p10"), false);
  assert.equal(before.players.find(p => p.id === "p11").batchCount, 2);
});

test("locked players contribute to total exposure and QB appearance counts across batches", () => {
  const audit = auditPortfolio([batch(2), batch(1, 2, "B")]);
  const qb = audit.players.find(p => p.id === "p1");
  assert.equal(qb.count, 3); assert.equal(qb.percent, 100); assert.equal(qb.quarterbacks, 3); assert.equal(qb.batchCount, 2);
  assert.ok(Math.abs(audit.players.find(p => p.id === "p10").percent - 100 / 3) < 1e-10);
  assert.equal(audit.players.reduce((sum, p) => sum + p.quarterbacks, 0), audit.total);
});

test("reject incompatible site, slate, week, season, salary identity and catalog", () => {
  for (const patch of [{ site: "fanduel" }, { site: "draftkings_showdown" }]) {
    const s = source(); Object.assign(s.context, patch);
    assert.throws(() => createPortfolioBatch(s, "Wrong site"), /Classic only/);
  }
  for (const patch of [{ slateId: "afternoon" }, { week: 6 }, { season: 2025 }, { source: "upload" }]) {
    const s = source(); Object.assign(s.context, patch);
    assert.throws(() => appendPortfolioBatch([batch()], createPortfolioBatch(s, "Different")), /different site, slate/);
  }
  for (const mutate of [s => { s.salarySnapshot.id = "catalog-2"; }, s => { s.salaryCatalog[169].salary++; },
    s => { s.salaryCatalog[169].dfs_id = "999"; }]) {
    const s = source(); mutate(s);
    assert.throws(() => appendPortfolioBatch([batch()], createPortfolioBatch(s, "Different")), /salary catalog/);
  }
  const reordered = source(); reordered.salaryCatalog.reverse();
  assert.equal(appendPortfolioBatch([batch()], createPortfolioBatch(reordered, "Reordered")).length, 2);
});

test("batch lineups, settings, projections, slate and salary inputs are detached immutable snapshots", () => {
  const s = source(), b = createPortfolioBatch(s, "Original");
  s.lineups[0].lineup[0].proj = 99; s.context.slateId = "other"; s.salaryCatalog[0].salary = 1;
  s.settings.projection_overrides.p1.proj = 55; s.settings.build_snapshot.players[0].proj = 66;
  s.settings.locked_player_ids.push("other"); s.salarySnapshot.id = "different";
  assert.equal(b.lineups[0].lineup[0].proj, 10); assert.equal(b.context.slateId, "main");
  assert.equal(b.salaryCatalog[0].salary, 4000); assert.equal(b.salarySnapshot.id, "catalog-1");
  assert.equal(b.settings.projection_overrides.p1.proj, 10); assert.equal(b.settings.build_snapshot.players[0].proj, 10);
  assert.deepEqual(b.settings.locked_player_ids, ["p1"]);
  assert.throws(() => { b.lineups[0].lineup[0].salary = 0; }, TypeError);
});

test("appearance limits are optional integer audit limits and include locked players", () => {
  const batches = [batch(2)];
  for (const max of ["", null, 2, 3]) assert.equal(auditPortfolio(batches, { p1: max }).errors.length, 0);
  for (const max of [0, 1]) assert.match(auditPortfolio(batches, { p1: max }).errors[0], /exceeds/);
  for (const max of [-1, "bad", 1.5, Infinity]) assert.match(auditPortfolio(batches, { p1: max }).errors[0], /whole number/);
  assert.throws(() => buildPortfolioEntryCsv(entryTemplate(), batches, { 101: 0, 102: 1 }, { p1: 1 }), /exceeds/);
  assert.equal(batches[0].lineups.length, 2);
  assert.equal(batches[0].settings.max_exposure, undefined);
});

test("portfolio export requires an exact one-to-one entry assignment without repeats or fill", () => {
  const batches = [batch(2)], t = entryTemplate();
  for (const a of [{ 101: 0 }, { 101: 0, 102: 1, 103: 0 }])
    assert.throws(() => buildPortfolioEntryCsv(t, batches, a), /Select exactly 2/);
  for (const a of [{ 101: 0, 102: 0 }, { 101: 0, 102: 5 }, { 101: 0, 102: "x" }])
    assert.throws(() => buildPortfolioEntryCsv(t, batches, a), /exactly once/);
  assert.throws(() => buildPortfolioEntryCsv(t, batches, { 101: 0, unknown: 1 }), /no longer valid/);
  assert.equal(auditPortfolio(batches).shortfall, 148);
  assert.equal(buildPortfolioEntryCsv(t, batches, { 101: 0, 102: 1 }).changed, 2);
});

test("reserved-entry export preserves IDs, contests, fees, extra metadata and unrelated entries", () => {
  const a = batch(), b = batch(1, 1, "B"), t = entryTemplate();
  const before = structuredClone(t.rows), result = buildPortfolioEntryCsv(t, [a, b], { 101: 1, 102: 0, 103: "" });
  const rows = parseDfsCsv(result.lines.join("\n"));
  assert.equal(result.changed, 2); assert.equal(rows.length, before.length); assert.deepEqual(rows[0], before[0]);
  assert.deepEqual(rows[3], before[3]);
  for (let i = 1; i <= 2; i++) { assert.deepEqual(rows[i].slice(0, 4), before[i].slice(0, 4)); assert.deepEqual(rows[i].slice(13), before[i].slice(13)); }
  assert.match(rows[1][9], /Player 11 \(11\)/); assert.match(rows[2][9], /Player 10 \(10\)/);
  assert.deepEqual(t.rows, before);
});

test("original batch payloads and local lineup indices provide per-entry provenance", () => {
  const a = batch(2), b = batch(1, 2, "Second"), assignments = { 101: 2, 102: 1, 103: 0 };
  const payload = portfolioBuildPayload(a);
  assert.equal(payload.slate_id, "main"); assert.equal(payload.settings.build_snapshot.id, "build-snapshot");
  assert.equal(payload.settings.portfolio_batch.label, "Batch A");
  assert.deepEqual(payload.settings.portfolio_batch.salary_catalog, a.salaryCatalog);
  const records = portfolioEntryRecords(entryTemplate(), [a, b], assignments, { [a.id]: "saved-a", [b.id]: "saved-b" });
  assert.deepEqual(records.map(e => [e.entry_id, e.build_id, e.lineup_index]), [["101", "saved-b", 0], ["102", "saved-a", 1], ["103", "saved-a", 0]]);
  assert.equal(records[0].contest_id, "700"); assert.equal(records[0].fee_cents, 300);
  assert.throws(() => portfolioEntryRecords(entryTemplate(), [a, b], assignments, {}), /could not be saved/);
});

test("each lineup still passes the existing slot, ID, position, salary and eligible-player checks", () => {
  for (const mutate of [s => { s.lineups[0].lineup[0].salary = 50001; }, s => { s.lineups[0].lineup.pop(); },
    s => { s.lineups[0].lineup[0].dfs_id = "999"; }, s => { s.lineups[0].lineup[0].position = "WR"; },
    s => { delete s.lineups[0].lineup[0].player_id; }]) {
    const s = source(); mutate(s);
    assert.throws(() => createPortfolioBatch(s, "Invalid"));
    assert.throws(() => buildPortfolioEntryCsv(entryTemplate(), [s], { 101: 0 }));
  }
  const b = batch();
  const t = entryTemplate(1, b.lineups[0].lineup.map(p => p.dfs_id).filter(id => id !== "1"));
  assert.throws(() => buildPortfolioEntryCsv(t, [b], { 101: 0 }), /eligible-player/);
});

test("150 unique collected lineups export to 150 selected entries, preserving other entries", () => {
  const a = batch(75), b = batch(75, 75, "B"), batches = [a, b], t = entryTemplate(151);
  const assignments = Object.fromEntries(t.entries.slice(0, 150).map((e, i) => [e.id, i]));
  const audit = auditPortfolio(batches, { p1: 150 });
  assert.equal(audit.unique, 150); assert.equal(audit.shortfall, 0); assert.equal(audit.players[0].count, 150);
  const result = buildPortfolioEntryCsv(t, batches, assignments, { p1: 150 });
  assert.equal(result.changed, 150); assert.equal(result.lines.length, t.rows.length);
  assert.deepEqual(parseDfsCsv(result.lines.join("\n")).at(-1), t.rows.at(-1));
  assert.throws(() => buildPortfolioEntryCsv(t, batches, assignments, { p1: 149 }), /exceeds/);
});

test("portfolio copy explains explicit recovery and export-only limits", () => {
  assert.match(C.help, /backup before leaving/); assert.match(C.auditHelp, /do not change builds/);
  assert.match(C.backupHelp, /fresh Edit Entries template/);
  assert.match(C.backupHelp, /not proof of ownership or authenticity/);
});
