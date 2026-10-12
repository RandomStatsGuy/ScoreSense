// Guided production components with intercepted, explicitly synthetic responses.
// No app server, account, provider, platform upload or live lineup is contacted.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachDfsFixture } from "./dfs_fixture_runtime.mjs";
import { readPortfolioBackup } from "../../frontend/src/dfsPortfolioBackup.js";
import { csvLines, parseDfsCsv } from "../../frontend/src/dfsCsv.js";
import { DFS_PORTFOLIO_COPY as PC, DFS_GLOBAL_COPY as GC, DFS_WORKFLOW_COPY as WC,
  DFS_SHARED_OUTCOMES_COPY as SC, DFS_WORKSPACE_COPY as W, DFS_EVIDENCE_COPY as EC,
  DFS_CAPTAIN_COMPARISON_COPY as CC, DFS_STEP_COPY as STEP } from "../../frontend/src/dfsToolPresentation.js";
import { DFS_REVIEW_COPY as RC } from "../../frontend/src/dfsPortfolioReviewPresentation.js";
import { measureScript, minTargetForWidth, NUMERIC_RE, BAR_CONTROL_SELECTOR,
  TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "outputs/dfs-flow-production");
const require = createRequire(path.join(root, "frontend/package.json"));
const { chromium } = require("playwright");
const sharedFixture = JSON.parse(await readFile(path.join(root, "frontend/test-fixtures/dfs-shared-data.json"), "utf8"));
const evidenceFixture = JSON.parse(await readFile(path.join(root, "frontend/test-fixtures/dfs-evidence-data.json"), "utf8"));
const fixtureUrl = "http://127.0.0.1:5173/test-fixtures/dfs-portfolio.html";
const report = { synthetic: true, productionComponents: true, main: [], supplements: [], shared: [] };

async function setup(browser, width, theme, mode = "workflow") {
  const context = await browser.newContext({ viewport: { width, height: 960 }, acceptDownloads: true,
    colorScheme: theme, reducedMotion: "reduce", serviceWorkers: "block" });
  const blocked = [];
  await context.route("**/*", route => {
    // This fallback blocks requests outside the exact intercepted fixture.
    blocked.push(route.request().url()); return route.abort("blockedbyclient");
  });
  await context.addInitScript(value => localStorage.setItem("scoresense-color-theme", value), theme);
  await attachDfsFixture(context);
  const page = await context.newPage(), errors = [], workers = [];
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("worker", worker => workers.push(worker.url()));
  await page.goto(`${fixtureUrl}?${mode}`);
  await page.getByTestId("dfs-generate").waitFor();
  await page.getByRole("spinbutton", { name: "Lineups", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
  assert.equal(await page.locator("main#main-content").count(), 1);
  return { context, page, errors, workers, blocked };
}
async function disclosure(page, id, open = true) {
  const section = page.getByTestId(id).filter({ visible: true });
  assert.equal(await section.count(), 1, `One visible ${id} disclosure`);
  if (await section.evaluate(element => element.open) !== open) await section.locator(":scope > summary").click();
  return section;
}
async function go(page, stage, keyboard = false) {
  const button = page.getByTestId(`dfs-flow-${stage}`);
  if (keyboard) { await button.focus(); await page.keyboard.press("Enter"); }
  else await button.click();
  await page.waitForFunction(stage => document.querySelector(`[data-testid="dfs-flow-${stage}"]`)?.getAttribute("aria-current") === "step", stage);
}
async function choose(scope, label, option) {
  await scope.getByRole("button", { name: new RegExp(`^${RegExp.escape(label)}:`) }).click();
  await scope.getByRole("option", { name: option, exact: true }).click();
}
async function openAncestorDetails(locator) {
  await locator.evaluate(element => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement)
      if (parent.tagName === "DETAILS") parent.open = true;
  });
}
async function namedDetails(scope, label) {
  const summary = scope.locator("summary").filter({ hasText: new RegExp(`^${RegExp.escape(label)}(?: · .*)?$`) }).first();
  await openAncestorDetails(summary);
  const section = summary.locator("..");
  if (!await section.evaluate(element => element.open)) await summary.click();
  return section;
}
async function download(page, label, filename) {
  const button = page.getByRole("button", { name: label, exact: true }).filter({ visible: true }).last();
  const pending = page.waitForEvent("download", { timeout: 20000 }); pending.catch(() => {});
  try {
    await button.click();
    const file = path.join(output, filename); await (await pending).saveAs(file);
    return readFile(file);
  } catch (error) {
    await writeFile(path.join(output, "download-failure.txt"), `${label}\n${error.stack}\n${await page.locator("body").innerText()}`);
    throw error;
  }
}
async function backup(page, filename) {
  const saveSet = page.getByRole("button", { name: "Save this set", exact: true }).filter({ visible: true });
  if (await saveSet.count()) await saveSet.click();
  await disclosure(page, "dfs-recovery");
  const button = page.getByRole("button", { name: PC.backup, exact: true }).filter({ visible: true }).last();
  await openAncestorDetails(button);
  return readPortfolioBackup((await download(page, PC.backup, filename)).toString("utf8"));
}
async function audit(page, width, theme, state) {
  const measures = await page.evaluate(measureScript(), { minTarget: minTargetForWidth(width),
    numericRe: NUMERIC_RE.source, barControlSelector: BAR_CONTROL_SELECTOR,
    tableDeadZonePx: TABLE_DEAD_ZONE_PX, columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  await writeFile(path.join(output, `layout-${width}-${theme}-${state}.json`), JSON.stringify(measures, null, 2));
  assert.equal(overflow, false, `${width}/${theme}/${state} page overflow`);
  assert.deepEqual(measures.filter(result => !result.ok), [], `${width}/${theme}/${state} layout`);
  return { state, measures, overflow };
}
async function shot(page, width, theme, state) {
  if ([390, 1280].includes(width)) {
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, `${state}-${width}-${theme}.png`), fullPage: true });
  }
}
async function importEntries(page, count) {
  const rows = [["Entry ID", "Contest ID", "Contest Name", "Entry Fee", "QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"],
    ...Array.from({ length: count }, (_, index) => [String(index + 1), "900", "Synthetic Classic", "$3.00", ...Array(9).fill("Keep")]),
    ["9999", "900", "Unrelated reservation", "$4.00", ...Array(9).fill("Leave alone")]];
  await page.getByLabel("Import Edit Entries CSV", { exact: true }).setInputFiles({ name: "synthetic-entries.csv", mimeType: "text/csv", buffer: Buffer.from(csvLines(rows).join("\n")) });
  await page.getByRole("button", { name: "Assign lineups in order", exact: true }).click();
  return rows;
}

async function mainCase(browser, width, theme) {
  const session = await setup(browser, width, theme), { page, context, errors, workers, blocked } = session;
  const audits = [];
  try {
    for (const id of ["dfs-choose-players", "dfs-advanced", "dfs-research", "dfs-recovery"])
      assert.equal(await page.getByTestId(id).filter({ visible: true }).evaluate(element => element.open), false, `${id} starts closed`);
    assert.equal(await page.getByText("0 saved batches", { exact: true }).count(), 0);
    audits.push(await audit(page, width, theme, "build")); await shot(page, width, theme, "build");
    await disclosure(page, "dfs-choose-players");
    const lock = page.getByRole("button", { name: "Lock Example 1", exact: true });
    const skip = page.getByRole("button", { name: "Skip Example 1", exact: true });
    await lock.click(); assert.equal(await lock.getAttribute("aria-pressed"), "true");
    await skip.click(); assert.equal(await lock.getAttribute("aria-pressed"), "false");
    assert.equal(await skip.getAttribute("aria-pressed"), "true"); await skip.click();
    const search = page.getByPlaceholder("Search players…", { exact: true });
    await search.fill("Example 2"); assert.match(await page.locator(".dfw-table tbody").innerText(), /Example 2/); await search.fill("");
    await page.getByRole("spinbutton", { name: "Lineups", exact: true }).fill("3");
    await disclosure(page, "dfs-advanced"); await choose(page, W.differences, "1");
    const together = page.getByRole("checkbox", { name: GC.enabled, exact: true });
    await together.focus(); await page.keyboard.press("Space"); assert.equal(await together.isChecked(), true);
    await page.getByLabel(GC.search, { exact: true }).filter({ visible: true }).fill("Example 1");
    const minimum = page.getByRole("spinbutton", { name: "Minimum: Example 1", exact: true });
    const maximum = page.getByRole("spinbutton", { name: "Maximum: Example 1", exact: true });
    await minimum.fill("80"); await maximum.fill("40"); await page.getByTestId("dfs-generate").click();
    await page.getByRole("alert").filter({ hasText: /minimum 3 exceeds maximum 1/ }).first().waitFor();
    assert.equal(await page.evaluate(() => window.__portfolioFixture.requests.length), 0);
    await minimum.fill("0"); await maximum.fill("100");
    const target = page.getByRole("spinbutton", { name: "Target: Example 1", exact: true }); await target.fill("40");
    audits.push(await audit(page, width, theme, "advanced"));
    await page.getByTestId("dfs-generate").click(); await page.getByText("Built 3 lineups.", { exact: true }).waitFor();
    const request = await page.evaluate(() => window.__portfolioFixture.requests.at(-1));
    assert.equal(request.lineup_count, 3); assert.equal(request.portfolio_mode, "global");
    assert.equal(request.block_qb_opposing_dst, true); assert.deepEqual(request.projection_overrides, {});
    await go(page, "review", true);
    const original = await backup(page, `original-${width}-${theme}.json`);
    assert.equal(original.batches.length, 1); assert.equal(original.batches[0].lineups.length, 3);
    assert.ok(workers.some(url => url.endsWith("dfsPortfolioBackup.worker.js")));
    await disclosure(page, "dfs-recovery", false);
    audits.push(await audit(page, width, theme, "review")); await shot(page, width, theme, "review");
    await go(page, "download", true);
    const source = page.getByRole("button", { name: /^Reserved-entry lineup source:/ });
    if (await source.count()) await choose(page, "Reserved-entry lineup source", PC.portfolio);
    const rows = await importEntries(page, 3);
    const check = page.getByRole("checkbox", { name: "I checked the slate and start time; none of the assigned players have locked.", exact: true });
    await check.check();
    const bytes = await download(page, WC.downloadReviewed, `entries-${width}-${theme}.csv`);
    const manifest = JSON.parse((await download(page, "Download export audit", `audit-${width}-${theme}.json`)).toString("utf8"));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.hashes.output_csv_sha256);
    assert.deepEqual(parseDfsCsv(bytes.toString("utf8"))[4], rows[4]);
    audits.push(await audit(page, width, theme, "download")); await shot(page, width, theme, "download");
    await disclosure(page, "dfs-recovery"); await page.getByText("Local draft saved", { exact: true }).waitFor(); await page.reload();
    await disclosure(page, "dfs-recovery");
    await page.getByRole("button", { name: "Restore local draft", exact: true }).click();
    await go(page, "review");
    assert.deepEqual((await backup(page, `restored-${width}-${theme}.json`)).batches, original.batches);
    assert.equal(await page.evaluate(() => window.__portfolioFixture.requests.length), 0);
    await go(page, "download");
    assert.equal(await page.getByRole("button", { name: "Assign lineups in order", exact: true }).count(), 0);
    assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
    report.main.push({ width, theme, passed: true, generated: 3, restoredWithoutRegeneration: true,
      sealedCsvMatches: true, unrelatedEntryPreserved: true, actualWorkerObserved: true, audits });
    console.log(`PASS guided ${width} ${theme}: closed disclosures, native exposure conflict, build/review/download, sealed CSV and exact worker recovery`);
  } catch (error) {
    await writeFile(path.join(output, `failure-${width}-${theme}.txt`), `${error.stack}\n\n${await page.locator("body").innerText()}\n\n${JSON.stringify({ errors, blocked })}`);
    await page.screenshot({ path: path.join(output, `failure-${width}-${theme}.png`), fullPage: true }); throw error;
  } finally { await context.close(); }
}

async function normal150(browser, width, theme) {
  const { context, page, errors, blocked } = await setup(browser, width, theme);
  try {
    await page.getByRole("spinbutton", { name: "Lineups", exact: true }).fill("150");
    await disclosure(page, "dfs-advanced"); await choose(page, W.differences, "1");
    await page.getByTestId("dfs-generate").click(); await page.getByText("Built 150 lineups.", { exact: true }).waitFor();
    await go(page, "review"); const original = await backup(page, `normal150-${width}-${theme}.json`);
    assert.equal(original.batches.length, 1); assert.equal(original.batches[0].lineups.length, 150);
    await go(page, "download");
    const rows = await importEntries(page, 150);
    await page.getByRole("checkbox", { name: "I checked the slate and start time; none of the assigned players have locked.", exact: true }).check();
    const csv = await download(page, WC.downloadReviewed, `normal150-${width}-${theme}.csv`);
    const manifest = JSON.parse((await download(page, "Download export audit", `normal150-audit-${width}-${theme}.json`)).toString("utf8"));
    assert.equal(createHash("sha256").update(csv).digest("hex"), manifest.hashes.output_csv_sha256);
    const exported = parseDfsCsv(csv.toString("utf8")); assert.equal(exported.length, 152); assert.deepEqual(exported[151], rows[151]);
    await disclosure(page, "dfs-recovery"); await page.getByText("Local draft saved", { exact: true }).waitFor(); await page.reload();
    await disclosure(page, "dfs-recovery"); await page.getByRole("button", { name: "Restore local draft", exact: true }).click();
    await go(page, "review"); assert.deepEqual((await backup(page, `normal150-restored-${width}-${theme}.json`)).batches, original.batches);
    assert.equal(await page.evaluate(() => window.__portfolioFixture.requests.length), 0);
    assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
    report.supplements.push({ check: "normal150", width, theme, passed: true, generated: 150, assigned: 150,
      sealedCsvMatches: true, unrelatedEntryPreserved: true, exactRecovery: true });
    console.log(`PASS guided 150 ${width} ${theme}: build/review, 150 assignments, sealed CSV and exact recovery`);
  } finally { await context.close(); }
}

async function failureGuards(browser) {
  const { context, page, errors, blocked } = await setup(browser, 390, "dark");
  try {
    await page.getByRole("spinbutton", { name: "Lineups", exact: true }).fill("3");
    await disclosure(page, "dfs-advanced"); await choose(page, W.differences, "1");
    await page.getByTestId("dfs-generate").click(); await page.getByText("Built 3 lineups.", { exact: true }).waitFor();
    await go(page, "review"); const original = await backup(page, "guards-original.json");
    await go(page, "build");
    await page.evaluate(() => Object.assign(window.__portfolioFixture, { delayOptimize: true, ignoreOptimizeAbort: true }));
    await page.getByTestId("dfs-generate").click(); await page.getByRole("button", { name: WC.cancelBuild, exact: true }).click();
    await page.getByText(WC.jobs.cancelled, { exact: true }).waitFor();
    await page.evaluate(() => window.__portfolioFixture.releaseOptimize());
    await go(page, "review"); assert.deepEqual((await backup(page, "guards-cancelled.json")).batches, original.batches);
    await go(page, "build"); await page.evaluate(() => Object.assign(window.__portfolioFixture, { delayOptimize: false, failOptimize: true }));
    await page.getByTestId("dfs-generate").click(); await page.getByRole("alert").filter({ hasText: "Synthetic build failure" }).first().waitFor();
    await go(page, "review"); assert.deepEqual((await backup(page, "guards-failed.json")).batches, original.batches);
    await go(page, "build"); await page.evaluate(() => Object.assign(window.__portfolioFixture, { failOptimize: false, failSalaryImport: true }));
    await page.getByLabel("Import salary CSV", { exact: true }).setInputFiles({ name: "invalid.csv", mimeType: "text/csv", buffer: Buffer.from("wrong,columns\n1,2") });
    await page.getByRole("alert").filter({ hasText: "Synthetic invalid salary file" }).first().waitFor();
    await disclosure(page, "dfs-choose-players");
    assert.equal(await page.getByRole("button", { name: "Lock Example 1", exact: true }).locator("xpath=ancestor::tr").getByRole("cell").nth(2).innerText(), "10.0");
    await go(page, "download"); await importEntries(page, 3);
    await page.getByRole("checkbox", { name: "I checked the slate and start time; none of the assigned players have locked.", exact: true }).check();
    const downloads = []; page.on("download", item => downloads.push(item));
    await page.evaluate(() => { window.__portfolioFixture.accessStatus = 403; });
    await page.getByRole("button", { name: WC.downloadReviewed, exact: true }).click();
    await page.getByRole("alert").filter({ hasText: /access|denied/i }).first().waitFor(); assert.equal(downloads.length, 0);
    await page.evaluate(() => Object.assign(window.__portfolioFixture, { accessStatus: 200, failLedger: true }));
    await page.getByRole("button", { name: WC.downloadReviewed, exact: true }).click();
    await page.getByText("History sync pending.", { exact: false }).waitFor();
    const bytes = await download(page, GC.recovery, "guards-ledger-outage.csv"); assert.ok(bytes.length > 100);
    assert.equal(await page.evaluate(() => window.__portfolioFixture.imports.length), 0);
    assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
    report.supplements.push({ check: "failure guards", passed: true,
      checks: ["cancel discards late result", "failed build retains collection", "invalid salary import preserves inputs", "fresh account access blocks CSV", "optional history outage permits CSV"] });
    console.log("PASS guided guards: cancel/late result, failed build/import preservation, fresh access and optional history outage");
  } finally { await context.close(); }
}

async function sharedPanel(page) {
  await disclosure(page, "dfs-research");
  const panel = page.getByTestId("dfs-shared-review");
  await openAncestorDetails(panel);
  if (await panel.evaluate(element => element.tagName === "DETAILS" && !element.open))
    await panel.locator(":scope > summary").click();
  return panel;
}
async function sharedFile(panel, bank = sharedFixture.engine_inputs.bank, name = "synthetic-scenarios.json") {
  await panel.getByLabel("Scenario JSON", { exact: true }).setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(typeof bank === "string" ? bank : JSON.stringify(bank)) });
}
async function previewAndSelect(panel) {
  await panel.getByRole("button", { name: "Preview scenarios", exact: true }).click();
  const select = panel.getByRole("button", { name: "Use this scenario bank", exact: true });
  await select.waitFor(); await select.click();
}
const byId = rows => [...rows].sort((a, b) => a.player_id.localeCompare(b.player_id));
function exactSharedRequest(request, scope = "current") {
  assert.deepEqual(request.context, sharedFixture.engine_inputs.context);
  assert.deepEqual(byId(request.pool), byId(sharedFixture.engine_inputs.pool));
  assert.deepEqual(request.bank, sharedFixture.engine_inputs.bank);
  if (request.lineups) {
    assert.equal(request.seed, 0); assert.equal(request.draw_count, 256);
    assert.equal(request.bank_id, sharedFixture.summary.content_id); assert.match(request.input_snapshot_id, /^scenario:/);
    assert.deepEqual(request.lineups.map(row => ({ lineup_id: row.lineup_id, player_ids: [...row.player_ids].sort() })),
      sharedFixture.engine_inputs.lineups.map((row, index) => ({ lineup_id: `${scope}:${index}`, player_ids: [...row.player_ids].sort() })));
  }
}
async function sharedCase(browser, width, theme) {
  const { context, page, errors, workers, blocked } = await setup(browser, width, theme, "shared");
  try {
    await page.getByRole("spinbutton", { name: "Lineups", exact: true }).fill("2");
    await page.getByTestId("dfs-generate").click(); await page.getByText("Built 2 lineups.", { exact: true }).waitFor();
    await go(page, "review"); const original = await backup(page, `shared-history-${width}-${theme}.json`);
    const panel = await sharedPanel(page);
    await sharedFile(panel); await previewAndSelect(panel);
    const preview = await page.evaluate(() => window.__portfolioFixture.sharedPreviewRequests.at(-1)); exactSharedRequest(preview);
    await panel.getByRole("button", { name: "Review lineups", exact: true }).click();
    await panel.getByTestId("dfs-shared-results").waitFor();
    const request = await page.evaluate(() => window.__portfolioFixture.sharedEvaluateRequests.at(-1)); exactSharedRequest(request);
    const portable = JSON.parse((await download(page, "Download scenario review", `shared-${width}-${theme}.json`)).toString("utf8"));
    assert.equal(portable.snapshot.input_snapshot_id, request.input_snapshot_id);
    assert.equal(portable.scenario_reference.content_id, request.bank_id);
    assert.deepEqual(portable.report, { ...sharedFixture.evaluation, input_snapshot_id: request.input_snapshot_id, bank_id: request.bank_id });
    assert.equal(Object.hasOwn(portable, "bank"), false); assert.equal(Object.hasOwn(portable.snapshot, "bank"), false);
    assert.equal(portable.report.capabilities.calibrated_joint_tail, false); assert.equal(portable.report.capabilities.expected_payout, false);
    assert.ok(portable.report.players.find(row => row.player_id === "buf-qb").negative_fraction > 0);
    assert.ok(portable.report.lineups[1].paired_delta_mean_vs_first < 0);
    assert.ok(workers.some(url => url.endsWith("dfsSharedOutcomes.worker.js")));
    const measurements = await audit(page, width, theme, "shared"); await shot(page, width, theme, "shared");
    assert.deepEqual((await backup(page, `shared-history-after-${width}-${theme}.json`)).batches, original.batches);
    assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
    report.shared.push({ width, theme, passed: true, exactRequestMatchesRealEngine: true, defaultDraws: 256,
      empiricalNegativeOutcomesRetained: true, nonzeroPairedDifference: true, originalHistoryUnchanged: true,
      actualWorkerObserved: true, measurements });
    console.log(`PASS shared ${width} ${theme}: exact real-engine request, explicit selection, actual worker, empirical results and unchanged history`);
  } catch (error) {
    await writeFile(path.join(output, `failure-shared-${width}-${theme}.txt`), `${error.stack}\n\n${await page.locator("body").innerText()}`);
    await page.screenshot({ path: path.join(output, `failure-shared-${width}-${theme}.png`), fullPage: true }); throw error;
  } finally { await context.close(); }
}

async function sharedGuards(browser) {
  const { context, page, errors, blocked } = await setup(browser, 390, "dark", "shared");
  try {
    await page.getByRole("spinbutton", { name: "Lineups", exact: true }).fill("2");
    await page.getByTestId("dfs-generate").click(); await page.getByText("Built 2 lineups.", { exact: true }).waitFor();
    await go(page, "review"); await backup(page, "shared-guards-history.json");
    const panel = await sharedPanel(page); await sharedFile(panel); await previewAndSelect(panel);
    await panel.getByRole("button", { name: "Review lineups", exact: true }).click(); await panel.getByTestId("dfs-shared-results").waitFor();
    const baseline = JSON.parse((await download(page, "Download scenario review", "shared-guards-baseline.json")).toString("utf8"));
    const before = await page.evaluate(() => window.__portfolioFixture.sharedPreviewRequests.length);
    const denied = structuredClone(sharedFixture.engine_inputs.bank); denied.sources[0].rights.hosted_ingestion = false;
    await sharedFile(panel, denied, "denied-rights.json"); await panel.getByRole("alert").filter({ hasText: /rights|permi|hosting|analysis/i }).waitFor();
    assert.equal(await page.evaluate(() => window.__portfolioFixture.sharedPreviewRequests.length), before);
    await sharedFile(panel, '{"schema_version":"one","schema_version":"two"}', "ambiguous.json");
    await panel.getByRole("alert").filter({ hasText: /repeated|duplicate/i }).waitFor();
    assert.equal(await page.evaluate(() => window.__portfolioFixture.sharedPreviewRequests.length), before);
    const wrongGame = structuredClone(sharedFixture.engine_inputs.bank); wrongGame.games[0].kickoff_at = "2099-09-21T17:00:00Z";
    await sharedFile(panel, wrongGame, "wrong-kickoff.json"); await panel.getByRole("alert").filter({ hasText: /game|kickoff|slate/i }).waitFor();
    assert.equal(await page.evaluate(() => window.__portfolioFixture.sharedPreviewRequests.length), before);
    await sharedFile(panel); await previewAndSelect(panel);
    await page.evaluate(() => { window.__portfolioFixture.failSharedEvaluate = true; });
    await panel.getByRole("button", { name: "Review lineups", exact: true }).click();
    await panel.getByRole("alert").filter({ hasText: "Synthetic scenario evaluation failure" }).waitFor();
    assert.deepEqual(JSON.parse((await download(page, "Download scenario review", "shared-guards-failed.json")).toString("utf8")).report, baseline.report);
    await page.evaluate(() => Object.assign(window.__portfolioFixture, { failSharedEvaluate: false, mismatchSharedEvaluate: true }));
    await panel.getByRole("button", { name: "Review lineups", exact: true }).click(); await panel.getByRole("alert").filter({ hasText: /response|different|match/i }).waitFor();
    assert.deepEqual(JSON.parse((await download(page, "Download scenario review", "shared-guards-mismatch.json")).toString("utf8")).report, baseline.report);
    await page.evaluate(() => Object.assign(window.__portfolioFixture, { mismatchSharedEvaluate: false, delaySharedEvaluate: true, ignoreSharedEvaluateAbort: true }));
    await panel.getByRole("button", { name: "Review lineups", exact: true }).click();
    await page.waitForFunction(() => typeof window.__portfolioFixture.releaseSharedEvaluate === "function");
    await panel.getByRole("button", { name: SC.cancel, exact: true }).click(); await page.evaluate(() => window.__portfolioFixture.releaseSharedEvaluate());
    assert.deepEqual(JSON.parse((await download(page, "Download scenario review", "shared-guards-cancelled.json")).toString("utf8")).report, baseline.report);
    await page.evaluate(() => { window.__portfolioFixture.delaySharedEvaluate = false; });
    await choose(panel, "Lineups to review", "Collection"); await previewAndSelect(panel);
    await panel.getByRole("button", { name: "Review lineups", exact: true }).click();
    await page.waitForFunction(() => window.__portfolioFixture.sharedEvaluateRequests.at(-1)?.lineups[0]?.lineup_id === "collection:0");
    exactSharedRequest(await page.evaluate(() => window.__portfolioFixture.sharedEvaluateRequests.at(-1)), "collection");
    const collection = JSON.parse((await download(page, "Download scenario review", "shared-guards-collection.json")).toString("utf8"));
    assert.deepEqual(collection.report.lineups, sharedFixture.collection_evaluation.lineups);
    await go(page, "build"); await page.getByRole("spinbutton", { name: "Lineups", exact: true }).fill("3");
    assert.equal(await panel.getByRole("button", { name: "Review lineups", exact: true }).isDisabled(), true, "Changed controls require explicit fresh selection");
    assert.deepEqual(JSON.parse((await download(page, "Download scenario review", "shared-guards-stale.json")).toString("utf8")).report, collection.report);
    await page.getByRole("spinbutton", { name: "Lineups", exact: true }).fill("2"); await previewAndSelect(panel);
    await page.evaluate(() => { window.__portfolioFixture.sharedAccessStatus = 403; });
    await panel.getByRole("button", { name: "Review lineups", exact: true }).click(); await panel.getByRole("alert").filter({ hasText: /access denied/ }).waitFor();
    await page.evaluate(() => { window.dispatchEvent(new Event("scoresense-auth-changed")); });
    await page.waitForFunction(() => !document.querySelector('[data-testid="dfs-shared-results"]'));
    assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
    report.supplements.push({ check: "shared guards", passed: true,
      checks: ["rights before upload", "duplicate JSON before upload", "exact kickoff before upload", "failed/mismatched responses retain prior review", "cancel discards late response", "actual collection request", "controls stale selection", "account authorization failure and account-change reset"] });
    console.log("PASS shared guards: local rights/schema/game admission, failure/mismatch/cancel, collection, stale controls and account reset");
  } finally { await context.close(); }
}

async function retainedTools(browser, width, theme) {
  const { context, page, errors, blocked } = await setup(browser, width, theme);
  try {
    await page.getByRole("spinbutton", { name: W.count, exact: true }).fill("3");
    await disclosure(page, "dfs-advanced"); await choose(page, W.differences, "1");
    await page.getByTestId("dfs-generate").click(); await page.getByText("Built 3 lineups.", { exact: true }).waitFor();
    await go(page, "review"); const original = await backup(page, `retained-original-${width}.json`);
    await go(page, "build"); await page.getByTestId("dfs-generate").click(); await page.getByText("Built 3 lineups.", { exact: true }).waitFor();
    await go(page, "review");
    const review = page.getByTestId("dfs-portfolio-review");
    const bounds = await namedDetails(review, RC.playerBounds);
    await bounds.getByRole("spinbutton", { name: RC.bound("max", "Example 1"), exact: true }).fill("2");
    await page.getByRole("alert").filter({ hasText: "3 appearances exceeds the maximum of 2" }).first().waitFor();
    await bounds.getByRole("spinbutton", { name: RC.bound("max", "Example 1"), exact: true }).fill("");
    const replacement = await namedDetails(review, RC.replacement);
    await choose(replacement, RC.mode, "Selected lineup");
    await choose(replacement, RC.originalLineup, "Reviewed build · lineup 2");
    await choose(replacement, RC.candidateLineup, "After · lineup 2");
    await replacement.getByRole("button", { name: RC.previewLineup, exact: true }).click();
    const preview = page.getByTestId("dfs-portfolio-replacement-preview");
    await preview.getByText(RC.identities(2, 1, 1), { exact: true }).waitFor();
    assert.deepEqual((await backup(page, `retained-preview-${width}.json`)).batches, original.batches);
    await preview.getByRole("button", { name: RC.cancel, exact: true }).focus(); await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => document.activeElement?.checkVisibility()), true);
    await replacement.getByRole("button", { name: RC.previewLineup, exact: true }).click();
    await preview.getByRole("button", { name: RC.apply, exact: true }).focus(); await page.keyboard.press("Enter");
    const changed = await backup(page, `retained-replaced-${width}.json`);
    assert.deepEqual(changed.batches[0].lineups[0], original.batches[0].lineups[0]);
    assert.notDeepEqual(changed.batches[0].lineups[1], original.batches[0].lineups[1]);
    assert.deepEqual(changed.batches[0].lineups[2], original.batches[0].lineups[2]);
    await review.getByRole("button", { name: RC.undo, exact: true }).click();
    assert.deepEqual((await backup(page, `retained-undo-${width}.json`)).batches, original.batches);
    await go(page, "build"); await disclosure(page, "dfs-choose-players");
    const player = page.getByRole("button", { name: "Lock Example 1", exact: true }).locator("xpath=ancestor::tr");
    const projection = () => player.getByRole("cell").nth(2).innerText();
    await page.evaluate(() => { window.__portfolioFixture.poolVersion = 1; window.__portfolioFixture.publishDataRevision(); });
    await page.getByRole("button", { name: W.updatePool, exact: true }).click();
    const update = page.getByTestId("dfs-pool-update-preview"); await update.getByText(WC.updateCount(1), { exact: true }).waitFor();
    assert.equal(await projection(), "10.0");
    await update.getByRole("button", { name: WC.keepInputs, exact: true }).click(); assert.equal(await projection(), "10.0");
    await page.evaluate(() => window.__portfolioFixture.publishDataRevision());
    await page.getByRole("button", { name: W.updatePool, exact: true }).click();
    await update.getByRole("button", { name: WC.applyUpdate, exact: true }).click(); assert.equal(await projection(), "12.0");
    await update.getByRole("button", { name: WC.undoUpdate, exact: true }).click(); assert.equal(await projection(), "10.0");
    await go(page, "review"); assert.deepEqual((await backup(page, `retained-input-history-${width}.json`)).batches, original.batches);
    await go(page, "build");
    await choose(page, W.format, "DraftKings Showdown");
    await page.getByRole("spinbutton", { name: W.count, exact: true }).fill("0");
    await disclosure(page, "dfs-research");
    await page.getByRole("button", { name: CC.action, exact: true }).click();
    await page.getByText(CC.none, { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__portfolioFixture.requests.at(-1).include_captain_comparison), true);
    await audit(page, width, theme, "captain");
    assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
    report.supplements.push({ check: "retained tools", width, theme, passed: true,
      checks: ["collected player bound", "selected replacement preview/cancel/accept/undo", "keyboard focus", "input preview/keep/apply/undo", "historical forecasts frozen", "Captain comparison independent of unused count"] });
    console.log(`PASS retained tools ${width} ${theme}: collection limits, replacement/undo, versioned inputs and Captain comparison`);
  } catch (error) {
    await writeFile(path.join(output, `failure-retained-${width}.txt`), `${error.stack}\n\n${await page.locator("body").innerText()}`); throw error;
  } finally { await context.close(); }
}

async function evidenceResearch(browser, width, theme) {
  const { context, page, errors, blocked } = await setup(browser, width, theme, "evidence");
  try {
    await page.getByRole("spinbutton", { name: W.count, exact: true }).fill("3");
    await disclosure(page, "dfs-advanced"); await choose(page, W.differences, "1");
    await page.getByRole("button", { name: `${STEP.raiseWeight}: BUF @ KC`, exact: true }).click();
    await disclosure(page, "dfs-research");
    const evidence = page.getByTestId("dfs-evidence-review");
    await evidence.getByTestId("dfs-evidence-status").getByText(/3 games/).waitFor();
    const games = await namedDetails(evidence, EC.games);
    assert.equal(await games.getByTestId("dfs-evidence-game").count(), 3);
    await choose(games, EC.labels.gameScope, EC.primaryGames); assert.equal(await games.getByTestId("dfs-evidence-game").count(), 1);
    await choose(games, EC.labels.gameScope, EC.allGames);
    const players = await namedDetails(evidence, EC.players);
    await players.getByLabel(EC.search, { exact: true }).fill("Synthetic KC WR2");
    const measured = await namedDetails(players, "synthetic-receiving-report");
    assert.match(await measured.innerText(), /88\.2/); assert.match(await measured.innerText(), /66\.7%/);
    await evidence.getByRole("button", { name: EC.select, exact: true }).click();
    await evidence.getByRole("button", { name: EC.compare, exact: true }).click();
    await evidence.getByTestId("dfs-evidence-candidate").first().waitFor();
    const request = await page.evaluate(() => window.__portfolioFixture.comparisonRequests.at(-1));
    assert.deepEqual(byId(request.pool), byId(evidenceFixture.engine_inputs.pool));
    for (const [key, expected] of Object.entries(evidenceFixture.engine_inputs))
      if (!["pool", "site"].includes(key)) assert.deepEqual(request[key], expected);
    assert.equal(request.evidence_id, evidenceFixture.evidence.content_id);
    const portable = JSON.parse((await download(page, EC.download, `retained-evidence-${width}.json`)).toString("utf8"));
    assert.deepEqual(portable.report, { ...evidenceFixture.comparison, input_snapshot_id: request.input_snapshot_id, evidence_id: request.evidence_id });
    assert.equal(Object.hasOwn(portable.snapshot, "evidence"), false);
    await audit(page, width, theme, "evidence");
    await page.evaluate(() => { window.__portfolioFixture.failComparison = true; });
    await evidence.getByRole("button", { name: EC.compare, exact: true }).click();
    await evidence.getByRole("alert").filter({ hasText: /Synthetic comparison failure/ }).waitFor();
    assert.deepEqual(JSON.parse((await download(page, EC.download, `retained-evidence-failed-${width}.json`)).toString("utf8")).report, portable.report);
    await page.evaluate(() => { window.__portfolioFixture.failComparison = false; window.__portfolioFixture.delayComparison = true; window.__portfolioFixture.ignoreComparisonAbort = true; });
    await evidence.getByRole("button", { name: EC.compare, exact: true }).click();
    await page.waitForFunction(() => typeof window.__portfolioFixture.releaseComparison === "function");
    await evidence.getByRole("button", { name: EC.cancel, exact: true }).click(); await page.evaluate(() => window.__portfolioFixture.releaseComparison());
    assert.deepEqual(JSON.parse((await download(page, EC.download, `retained-evidence-cancelled-${width}.json`)).toString("utf8")).report, portable.report);
    await disclosure(page, "dfs-choose-players");
    await page.getByRole("button", { name: "Lock Synthetic BUF QB", exact: true }).click();
    assert.equal(await evidence.getByRole("button", { name: EC.compare, exact: true }).isDisabled(), true);
    assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
    report.supplements.push({ check: "opportunity evidence", width, theme, passed: true,
      checks: ["game focus", "receiving evidence", "exact prior real-engine comparison request", "portable source references", "failed/cancelled response retains review", "changed inputs stale selection"] });
    console.log(`PASS opportunity evidence ${width} ${theme}: advanced navigation, source observations, exact real-engine comparisons and failure/cancel/stale guards`);
  } catch (error) {
    await writeFile(path.join(output, `failure-evidence-${width}.txt`), `${error.stack}\n\n${await page.locator("body").innerText()}`); throw error;
  } finally { await context.close(); }
}

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, downloadsPath: path.join(output, "browser-downloads") });
try {
  const supplementsOnly = process.argv.includes("--supplements-only");
  const cases = supplementsOnly ? [] : process.argv.includes("--smoke") ? [[390, "dark"]] : [390, 768, 1280, 1440, 320].flatMap(width => ["dark", "light"].map(theme => [width, theme]));
  for (const [width, theme] of cases) await mainCase(browser, width, theme);
  if (!process.argv.includes("--smoke") && !supplementsOnly) {
    await normal150(browser, 390, "dark"); await normal150(browser, 1280, "light"); await failureGuards(browser);
  }
  if (process.argv.includes("--shared-smoke")) await sharedCase(browser, 390, "dark");
  else if (!process.argv.includes("--smoke") && !supplementsOnly) {
    for (const width of [390, 768, 1280, 1440, 320]) for (const theme of ["dark", "light"]) await sharedCase(browser, width, theme);
    await sharedGuards(browser);
  }
  if (!process.argv.includes("--smoke")) for (const [width, theme] of [[390, "dark"], [1280, "light"]]) {
    await retainedTools(browser, width, theme); await evidenceResearch(browser, width, theme);
  }
} finally {
  await browser.close(); await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
}
