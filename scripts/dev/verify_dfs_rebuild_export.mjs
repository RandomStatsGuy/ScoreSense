/** Synthetic local conversion only; no browser, network or account writes. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { webcrypto } from "node:crypto";
import { readEntryTemplate, buildEntryCsv } from "../../frontend/src/dfsEntryExport.js";
import { sealEntryExportArtifact } from "../../frontend/src/dfsEntryExportSeal.js";
import { createPortfolioBatch, auditPortfolio } from "../../frontend/src/dfsPortfolio.js";
import { writePortfolioBackup, readPortfolioBackup } from "../../frontend/src/dfsPortfolioBackup.js";
import { csvLines, parseDfsCsv } from "../../frontend/src/dfsCsv.js";
import { buildSiteLineupCsv, siteExportConfig } from "../../frontend/src/dfsExport.js";

globalThis.crypto ??= webcrypto;
const path = process.argv[2];
if (!path) throw new Error("Pass the synthetic build.json created by verify_dfs_rebuild.py.");
const fixture = JSON.parse(await readFile(path, "utf8"));
assert.equal(fixture.synthetic, true);
const { result, request, catalog } = fixture;
const count = request.lineup_count, output = dirname(path), site = "draftkings";
assert.equal(result.lineups.length, count);
assert.equal(result.validation.ok, true);
const config = siteExportConfig(site);
const headers = ["Entry ID", "Contest ID", "Contest Name", "Entry Fee", ...config.headers,
  "Audit note", "Name + ID", "ID"];
const rows = [["Synthetic instructions: this file is not a platform reservation"], headers];
for (let i = 0; i < count; i++) rows.push([String(100000+i), "12345", 'Synthetic contest, "fixture"', "$0.50",
  ...Array(9).fill(""), `metadata ${i}`, ...(catalog[i] ? [`${catalog[i].Player} (${catalog[i].dfs_id})`, catalog[i].dfs_id] : ["", ""])]);
// Small-count runs still include the complete side-by-side salary catalog.
for (let i = count; i < catalog.length; i++) rows.push([...Array(14).fill(""), `${catalog[i].Player} (${catalog[i].dfs_id})`, catalog[i].dfs_id]);
const baseline = buildSiteLineupCsv(site, [result.lineups[0]], catalog);
assert.equal(baseline.ok, true);
const untouched = ["999999", "98765", "Unrelated synthetic contest", "$1.00", ...parseDfsCsv(baseline.lines[1])[0], 'untouched, "metadata"', "", ""];
rows.push(untouched);
const templateCsv = `\uFEFF${csvLines(rows).join("\n")}\n`;
const template = readEntryTemplate(templateCsv, site);
const assignments = Object.fromEntries(Array.from({ length: count }, (_, i) => [String(100000+i), i]));
const parameters = result.build_snapshot.content.parameters;
const settingKeys = ["objective", "salary_cap", "min_salary", "max_per_team", "block_bye_weeks",
  "locked_player_ids", "excluded_player_ids", "locked_captain_id", "captain_exposure_limits",
  "qb_stack_count", "stack_bring_back", "stack_game_weights", "lineup_count", "max_overlap",
  "max_exposure", "randomness", "portfolio_mode", "player_exposure_limits", "group_exposure_limits", "block_qb_opposing_dst"];
const snapshot = { context: { site, season: 2026, week: 1, slateId: "synthetic-classic", source: "upload" },
  slateName: "Synthetic fixture; no live slate", lineups: result.lineups, salaryCatalog: catalog, salarySnapshot: null,
  settings: { ...Object.fromEntries(settingKeys.map(key => [key, parameters[key]])),
    site, slate_id: "synthetic-classic", season: 2026, week: 1,
    build_snapshot: result.build_snapshot, snapshot_at: result.build_snapshot.captured_at,
    portfolio_selection: result.portfolio_selection } };
const artifact = await sealEntryExportArtifact(buildEntryCsv(template, result.lineups, assignments, catalog,
  { buildSource: snapshot, validation: { mode: "pre_lock", lockState: "not_started", synthetic: true } }), template);
assert.equal(artifact.changed, count);
assert.equal(artifact.manifest.untouchedEntryCount, 1);
assert.equal(artifact.manifest.acceptance, "unconfirmed");
const roundtrip = readEntryTemplate(artifact.csv, site);
for (const entry of template.entries) {
  const after = roundtrip.rows[entry.rowIndex], before = template.rows[entry.rowIndex];
  if (entry.id === "999999") assert.deepEqual(after, before);
  else {
    assert.deepEqual(after.slice(0, template.start), before.slice(0, template.start));
    assert.deepEqual(after.slice(template.start+9), before.slice(template.start+9));
    const expected = result.lineups[assignments[entry.id]].lineup.map(row => String(row.dfs_id)).sort();
    const actual = after.slice(template.start, template.start+9).map(config.cellId).sort();
    assert.deepEqual(actual, expected);
  }
}
const batch = createPortfolioBatch(snapshot, "Synthetic global portfolio", "synthetic-batch-v1");
const backup = writePortfolioBackup([batch], {}, result.build_snapshot.captured_at);
const restored = readPortfolioBackup(backup);
assert.deepEqual(restored.batches[0].lineups, batch.lineups);
assert.deepEqual(restored.batches[0].settings, batch.settings);
const audit = auditPortfolio(restored.batches);
assert.equal(audit.unique, count);
assert.equal(audit.duplicates.length, 0);
assert.equal(audit.errors.length, 0);
const preferred = audit.players.find(player => player.id === "QB0")?.count || 0;
if (count === 150) assert.equal(preferred, 60);
await Promise.all([
  writeFile(join(output, "entry-template.csv"), templateCsv),
  writeFile(join(output, "entry-update.csv"), artifact.csv),
  writeFile(join(output, "lineup-library.csv"), `${baseline.lines[0]}\r\n${buildSiteLineupCsv(site, result.lineups, catalog).lines.slice(1).join("\r\n")}\r\n`),
  writeFile(join(output, "entry-manifest.json"), JSON.stringify(artifact.manifest, null, 2)),
  writeFile(join(output, "portfolio-backup.json"), backup),
]);
process.stdout.write(JSON.stringify({ synthetic: true, selected: count, unique: audit.unique, preferred_count: preferred,
  entry_csv_roundtrip: "PASS", backup_roundtrip: "PASS", untouched_entries: 1,
  acceptance: "unconfirmed", export_version: artifact.manifest.exportVersion,
  output_csv_sha256: artifact.manifest.hashes.output_csv_sha256 }));
