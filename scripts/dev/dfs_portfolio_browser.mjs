// Isolated production controls; intercepted assets and API responses are synthetic.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parseDfsCsv, csvLines } from "../../frontend/src/dfsCsv.js";
import { auditPortfolio, classicLineupKey } from "../../frontend/src/dfsPortfolio.js";
import { readPortfolioBackup, writePortfolioBackup } from "../../frontend/src/dfsPortfolioBackup.js";
import { attachDfsFixture } from "./dfs_fixture_runtime.mjs";
import { DFS_WORKFLOW_COPY } from "../../frontend/src/dfsToolPresentation.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "frontend/package.json"));
const { chromium } = require("playwright");
const output = path.join(root, "outputs/dfs-portfolio");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const stressReport = [];
const templateRows = [
  ["Entry ID", "Contest ID", "Contest Name", "Entry Fee", "QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST", "Note"],
  ...Array.from({ length: 7 }, (_, i) => [String(101 + i), "900", "Reserved Classic", "$3.00", ...Array(9).fill("Unchanged"), "Preserve me"]),
];
async function backupFile(page, name) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download portfolio backup", exact: true }).click();
  const file = await pending, saved = path.join(output, `${name}.json`);
  await file.saveAs(saved);
  return { text: await readFile(saved, "utf8"), path: saved };
}
async function restoreFile(page, text) {
  await page.getByLabel("Restore portfolio backup", { exact: true }).setInputFiles({
    name: "portfolio.json", mimeType: "application/json", buffer: Buffer.from(text),
  });
}
const replacement = page => page.getByRole("alertdialog", { name: "Replace Classic portfolio?", exact: true });
async function assignEntries(page, rows) {
  await page.getByLabel("Import Edit Entries CSV", { exact: true }).setInputFiles({ name: "entries.csv", mimeType: "text/csv", buffer: Buffer.from(csvLines(rows).join("\n")) });
  await page.getByRole("button", { name: "Assign lineups in order", exact: true }).click();
  await page.getByRole("checkbox", { name: "I checked the slate and start time; none of the assigned players have locked.", exact: true }).check();
}
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
    await attachDfsFixture(context);
    const page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto("http://127.0.0.1:5173/test-fixtures/dfs-portfolio.html");
    await page.locator("[aria-labelledby='dfw-portfolio-title']").screenshot({ path: path.join(output, `portfolio-empty-${width}.png`) });
    await page.getByRole("spinbutton", { name: "Lineups", exact: true }).fill("3");
    await page.getByRole("button", { name: "Lock Example 1", exact: true }).click();
    await page.locator(".dfw-build-button").click();
    const label = page.getByLabel("Batch label", { exact: true });
    const add = page.getByRole("button", { name: "Add current build to portfolio", exact: true });
    await label.fill("Original batch"); await add.click();
    await page.getByText("3 / 3 requested unique · 3 collected", { exact: false }).waitFor();
    // Adding the same build reports duplicates, then removal restores every total.
    await label.fill("Duplicate batch"); await add.click();
    await page.getByText("3 / 6 requested unique · 6 collected · 2 batches · 3 duplicates", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Remove batch: Duplicate batch", exact: true }).click();
    await page.getByText("3 / 3 requested unique · 3 collected · 1 batches · 0 duplicates", { exact: false }).waitFor();
    await page.getByLabel("Import projections & ownership", { exact: true }).setInputFiles({ name: "projections.csv", mimeType: "text/csv", buffer: Buffer.from("ID,Proj,Floor,Ceiling\n1,14,5,15") });
    await page.getByRole("button", { name: "Rebuild lineups", exact: true }).click();
    await label.fill("Imported projections"); await add.click();
    await page.getByText("6 / 6 requested unique · 6 collected · 2 batches · 0 duplicates", { exact: false }).waitFor();
    const portfolio = page.locator("[aria-labelledby='dfw-portfolio-title']");
    const openPlayerBounds = () => portfolio.getByText("Player bounds across collection", { exact: true }).first()
      .evaluate(summary => { if (!summary.parentElement.open) summary.click(); });
    await openPlayerBounds();
    const qbRow = portfolio.getByRole("row").filter({ has: page.getByRole("cell", { name: "Example 1", exact: true }) });
    assert.deepEqual((await qbRow.getByRole("cell").allTextContents()).slice(0, 4), ["Example 1", "6 / 6", "6", "2"]);
    await page.getByRole("button", { name: /^Reserved-entry lineup source:/ }).click();
    await page.getByRole("option", { name: "Reviewed portfolio", exact: true }).click();
    await page.getByLabel("Import Edit Entries CSV", { exact: true }).setInputFiles({ name: "entries.csv", mimeType: "text/csv", buffer: Buffer.from(csvLines(templateRows).join("\n")) });
    const download = page.getByRole("button", { name: "Download reviewed entry-update CSV", exact: true });
    assert.equal(await download.isDisabled(), true);
    await page.getByRole("button", { name: "Assign lineups in order", exact: true }).click();
    await page.getByRole("checkbox", { name: "I checked the slate and start time; none of the assigned players have locked.", exact: true }).check();
    const max = page.getByRole("spinbutton", { name: "Maximum collection appearances: Example 1", exact: true });
    await max.fill("5"); assert.equal(await download.isDisabled(), true);
    await max.fill("6"); assert.equal(await download.isEnabled(), true);
    // Optional history failure preserves the validated artifact; recovery is an
    // explicit user action and requires a successful account access check.
    await page.evaluate(() => { window.__portfolioFixture.failSave = true; });
    await download.click(); await page.getByText("History sync pending.", { exact: false }).waitFor();
    const clippedAssignments = await page.locator(".dfw-assignment-list").evaluate(list => {
      const outer = list.getBoundingClientRect();
      return [...list.querySelectorAll("button")].filter(button => {
        const box = button.getBoundingClientRect();
        return box.left < outer.left - 1 || box.right > outer.right + 1;
      }).map(button => button.getAttribute("aria-label"));
    });
    assert.deepEqual(clippedAssignments, [], `Assignment selectors fit their visible list at ${width}`);
    assert.match(await page.locator(".dfw-assignment-list button").first().getAttribute("aria-label"), /Original batch.*lineup 1/,
      "Full batch/lineup context stays accessible when the closed trigger is compact");
    await download.locator("..").screenshot({ path: path.join(output, `recovery-${width}.png`) });
    assert.equal(await page.evaluate(() => window.__portfolioFixture.imports.length), 0);
    assert.ok(await page.evaluate(() => window.__portfolioFixture.accessChecks) > 0);
    const recovery = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download local recovery CSV", exact: true }).click();
    const recoveryPath = path.join(output, `recovery-${width}.csv`);
    await (await recovery).saveAs(recoveryPath);
    await page.evaluate(() => { window.__portfolioFixture.failSave = false; });
    await page.getByRole("button", { name: "Retry history sync", exact: true }).click();
    await page.getByText("history synchronized", { exact: false }).waitFor();
    const downloaded = page.waitForEvent("download"); await download.click(); const file = await downloaded;
    const savedPath = path.join(output, `entries-${width}.csv`); await file.saveAs(savedPath);
    const csvBytes = await readFile(savedPath);
    assert.deepEqual(await readFile(recoveryPath), csvBytes, "Recovery and synchronized downloads retain the same sealed bytes");
    const auditDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download export audit", exact: true }).click();
    const auditPath = path.join(output, `export-audit-${width}.json`); await (await auditDownload).saveAs(auditPath);
    const audit = JSON.parse(await readFile(auditPath, "utf8"));
    assert.equal(createHash("sha256").update(csvBytes).digest("hex"), audit.hashes.output_csv_sha256,
      "Downloaded CSV bytes must match the audit seal");
    const exported = parseDfsCsv(csvBytes.toString("utf8"));
    assert.equal(exported.length, templateRows.length); assert.deepEqual(exported[7], templateRows[7]);
    for (let i = 1; i <= 6; i++) { assert.deepEqual(exported[i].slice(0, 4), templateRows[i].slice(0, 4)); assert.equal(exported[i][13], "Preserve me"); }
    const state = await page.evaluate(() => window.__portfolioFixture);
    assert.equal(state.builds.length, 2); assert.equal(state.imports.length, 1, "Repeated download must not duplicate synced ledger rows");
    assert.equal(state.builds[0].lineups[0].lineup[0].proj, 10);
    assert.equal(state.builds[1].lineups[0].lineup[0].proj, 14);
    assert.deepEqual(state.builds[0].settings.locked_player_ids, ["p1"]);
    assert.equal(state.builds[0].settings.build_snapshot.id, "snapshot-0");
    assert.equal(state.builds[1].settings.build_snapshot.id, "snapshot-1");
    assert.deepEqual(state.imports[0].entries.map(e => [e.build_id, e.lineup_index]), [["saved-1", 0], ["saved-1", 1], ["saved-1", 2], ["saved-2", 0], ["saved-2", 1], ["saved-2", 2]]);
    // Existing standalone download remains usable after collecting batches.
    const standaloneDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download lineup CSV", exact: true }).click();
    assert.match((await standaloneDownload).suggestedFilename(), /^draftkings-lineups/);
    const backup = await backupFile(page, `backup-${width}`), originalBackup = readPortfolioBackup(backup.text);
    // Bad data leaves both portfolio and existing entry review untouched.
    for (const invalid of ["{", JSON.stringify({ ...JSON.parse(backup.text), assignments: { 101: 0 } }), (() => {
      const mixed = { schema: originalBackup.schema, version: 1, exportedAt: originalBackup.exportedAt,
        batches: structuredClone(originalBackup.batches), appearanceLimits: originalBackup.appearanceLimits };
      mixed.batches[1].context.slateId = "other";
      mixed.batches[1].settings.slate_id = "other"; return JSON.stringify(mixed);
    })()]) {
      await restoreFile(page, invalid);
      await page.getByRole("alert").filter({ hasText: /malformed|different site, slate/ }).first().waitFor();
      assert.equal(await replacement(page).count(), 0);
      assert.equal(await download.isEnabled(), true);
      const unchanged = readPortfolioBackup((await backupFile(page, `unchanged-${width}`)).text);
      assert.deepEqual(unchanged.batches, originalBackup.batches);
      assert.deepEqual(unchanged.appearanceLimits, originalBackup.appearanceLimits);
      assert.deepEqual(unchanged.reviewRules, originalBackup.reviewRules);
    }
    await restoreFile(page, backup.text);
    await replacement(page).screenshot({ path: path.join(output, `portfolio-replace-${width}.png`) });
    await replacement(page).getByRole("button", { name: "Keep current portfolio", exact: true }).click();
    assert.equal(await download.isEnabled(), true);
    await restoreFile(page, backup.text);
    await replacement(page).getByRole("button", { name: "Replace portfolio", exact: true }).click();
    await page.getByText("Portfolio restored with its original inputs", { exact: false }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Assign lineups in order", exact: true }).count(), 0);
    assert.equal(await page.getByRole("checkbox", { name: "I checked the slate and start time; none of the assigned players have locked.", exact: true }).count(), 0);
    assert.equal(await max.inputValue(), "6");
    await assignEntries(page, templateRows);
    const restoredDownload = page.waitForEvent("download"); await download.click();
    const restoredCsv = path.join(output, `restored-${width}.csv`); await (await restoredDownload).saveAs(restoredCsv);
    assert.deepEqual(parseDfsCsv(await readFile(restoredCsv, "utf8")), exported);
    const afterRestore = await page.evaluate(() => window.__portfolioFixture);
    assert.equal(afterRestore.builds.length, 4, "Same batch IDs must be saved again after restore");
    assert.deepEqual(afterRestore.imports[1].entries.map(e => e.build_id), ["saved-3", "saved-3", "saved-3", "saved-4", "saved-4", "saved-4"]);
    assert.deepEqual(afterRestore.builds.slice(2).map(b => b.settings), state.builds.map(b => b.settings));
    // Replacing the current site's entire catalog must never rebind original batches.
    await page.evaluate(() => { window.__portfolioFixture.unrelatedCatalog = true; });
    await page.getByRole("button", { name: /^Format:/ }).click();
    await page.getByRole("option", { name: "FanDuel Classic", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".dfw-build-button")?.disabled === false);
    const preservedDownload = page.waitForEvent("download"); await download.click();
    const preservedFile = await preservedDownload, preservedPath = path.join(output, `original-catalog-${width}.csv`);
    await preservedFile.saveAs(preservedPath);
    assert.deepEqual(parseDfsCsv(await readFile(preservedPath, "utf8")), exported);
    assert.equal(await page.evaluate(() => window.__portfolioFixture.builds.length), 4);
    await portfolio.scrollIntoViewIfNeeded();
    assert.equal(await max.inputValue(), "6");
    const numberRoom = await max.evaluate(input => {
      const style = getComputedStyle(input);
      return input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    });
    assert.ok(numberRoom >= 30, "Maximum count must have space for digits and its stepper");
    const tableFits = await portfolio.locator("table").evaluate(table => table.scrollWidth <= table.parentElement.clientWidth + 1);
    assert.equal(tableFits, true, "Portfolio counts and names must fit together at the tested width");
    if (width === 1280) {
      const inputBox = await label.boundingBox(), addBox = await add.boundingBox();
      assert.ok(Math.abs(inputBox.y + inputBox.height - addBox.y - addBox.height) < 2, "Batch input and action align at the bottom");
    }
    await portfolio.screenshot({ path: path.join(output, `portfolio-${width}.png`) });
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}: collect/export, backup, malformed/mixed rejection, cancel/replace, fresh entry template, cache reset, immutable history, portfolio spacing`);
    if (width === 1280) {
      await page.reload();
      await page.getByRole("spinbutton", { name: "Lineups", exact: true }).fill("50");
      await page.getByRole("button", { name: "Lock Example 1", exact: true }).click();
      for (const labelText of ["First 50", "Second 50", "Third 50"]) {
        await page.locator(".dfw-build-button").click();
        await label.fill(labelText); await add.click();
      }
      await page.getByText("150 / 150 requested unique · 150 collected · 3 batches · 0 duplicates · 0 shortfall", { exact: true }).waitFor();
      await openPlayerBounds();
      await max.fill("150");
      await page.getByRole("button", { name: /^Reserved-entry lineup source:/ }).click();
      await page.getByRole("option", { name: "Reviewed portfolio", exact: true }).click();
      const largeRows = [templateRows[0], ...Array.from({ length: 151 }, (_, i) => [String(1000 + i), "901", "150 Reserved Classic", "$3.00", ...Array(9).fill("Keep"), "Keep metadata"])];
      await page.getByLabel("Import Edit Entries CSV", { exact: true }).setInputFiles({ name: "150-entries.csv", mimeType: "text/csv", buffer: Buffer.from(csvLines(largeRows).join("\n")) });
      await page.getByRole("button", { name: "Assign lineups in order", exact: true }).click();
      await page.getByRole("checkbox", { name: "I checked the slate and start time; none of the assigned players have locked.", exact: true }).check();
      const largeDownload = page.waitForEvent("download"); await download.click();
      const largeFile = await largeDownload, largePath = path.join(output, "150-entries.csv"); await largeFile.saveAs(largePath);
      const largeExport = parseDfsCsv(await readFile(largePath, "utf8"));
      assert.equal(largeExport.length, 152); assert.deepEqual(largeExport[151], largeRows[151]);
      const largeState = await page.evaluate(() => window.__portfolioFixture);
      assert.equal(largeState.builds.length, 3); assert.equal(largeState.imports[0].entries.length, 150);
      assert.equal(largeState.imports[0].entries[100].build_id, "saved-3");
      assert.equal(largeState.imports[0].entries[100].lineup_index, 0);
      console.log("PASS 150-lineup browser export: three batches, 150 selected entries, original batch links, unrelated entry preserved");
      const fullBackup = await backupFile(page, "150-lineup-backup"), beforeReload = readPortfolioBackup(fullBackup.text);
      await page.reload();
      await page.getByText("0 / 0 requested unique · 0 collected", { exact: false }).waitFor();
      await restoreFile(page, fullBackup.text);
      await page.getByText("150 / 150 requested unique · 150 collected · 3 batches · 0 duplicates · 0 shortfall", { exact: true }).waitFor();
      assert.equal(await replacement(page).count(), 0, "An empty portfolio restores without replacement confirmation");
      const afterReload = readPortfolioBackup((await backupFile(page, "150-lineup-restored")).text);
      assert.deepEqual(afterReload.batches, beforeReload.batches);
      assert.deepEqual(afterReload.appearanceLimits, beforeReload.appearanceLimits);
      assert.deepEqual(afterReload.reviewRules, beforeReload.reviewRules);
      assert.deepEqual(afterReload.batches.flatMap(b => b.lineups.map(classicLineupKey)), beforeReload.batches.flatMap(b => b.lineups.map(classicLineupKey)));
      assert.deepEqual(auditPortfolio(afterReload.batches, afterReload.appearanceLimits, afterReload.reviewRules), auditPortfolio(beforeReload.batches, beforeReload.appearanceLimits, beforeReload.reviewRules));
      assert.equal(await page.evaluate(() => window.__portfolioFixture.requests.length), 0, "Restore must never regenerate lineups");
      await assignEntries(page, largeRows);
      const recoveredDownload = page.waitForEvent("download"); await download.click();
      const recoveredPath = path.join(output, "150-entries-restored.csv"); await (await recoveredDownload).saveAs(recoveredPath);
      assert.deepEqual(parseDfsCsv(await readFile(recoveredPath, "utf8")), largeExport);
      assert.equal(await page.evaluate(() => window.__portfolioFixture.builds.length), 3);
      // Preserve violations visibly on restore, then prove each export gate.
      const bad = { schema: beforeReload.schema, version: 1, exportedAt: beforeReload.exportedAt,
        batches: structuredClone(beforeReload.batches), appearanceLimits: { ...beforeReload.appearanceLimits } };
      bad.batches[1].lineups[0] = structuredClone(bad.batches[0].lineups[0]);
      bad.appearanceLimits.p1 = "149";
      await restoreFile(page, JSON.stringify(bad));
      await replacement(page).getByRole("button", { name: "Replace portfolio", exact: true }).click();
      await page.getByText("149 / 150 requested unique · 150 collected · 3 batches · 1 duplicates · 1 shortfall", { exact: true }).waitFor();
      await portfolio.getByRole("alert").filter({ hasText: "150 appearances exceeds the maximum of 149" }).waitFor();
      await assignEntries(page, largeRows); assert.equal(await download.isDisabled(), true);
      const limitOnly = { schema: beforeReload.schema, version: 1, exportedAt: beforeReload.exportedAt,
        batches: structuredClone(beforeReload.batches), appearanceLimits: { ...beforeReload.appearanceLimits, p1: "149" } };
      await restoreFile(page, JSON.stringify(limitOnly));
      await replacement(page).getByRole("button", { name: "Replace portfolio", exact: true }).click();
      await assignEntries(page, largeRows); assert.equal(await download.isDisabled(), true);
      await openPlayerBounds();
      await max.fill("150"); assert.equal(await download.isEnabled(), true);
      console.log("PASS 150-lineup backup → reload → restore → identical export: identities, snapshots, timestamps, limits, audit, fresh account saves, duplicate/limit gates");
    }
    await context.close();
  }
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
    await attachDfsFixture(context);
    const page = await context.newPage(), errors = [], workerUrls = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("worker", worker => workerUrls.push(worker.url()));
    await page.goto("http://127.0.0.1:5173/test-fixtures/dfs-portfolio.html?large-pool");
    await page.getByRole("spinbutton", { name: "Lineups", exact: true }).fill("20");
    for (let i = 0; i < 7; i++) {
      await page.locator(".dfw-build-button").click();
      await page.getByLabel("Batch label", { exact: true }).fill(`Full-pool batch ${i + 1}`);
      await page.getByRole("button", { name: "Add current build to portfolio", exact: true }).click();
    }
    await page.getByText("140 / 140 requested unique · 140 collected · 7 batches · 0 duplicates · 0 shortfall", { exact: true }).waitFor();
    await page.evaluate(backupBusyLabel => {
      window.__backupAnimationFrames = 0;
      window.__backupBusyFrames = 0;
      window.__backupStartedAt = performance.now();
      const frame = () => {
        window.__backupAnimationFrames++;
        if ([...document.querySelectorAll("button")].some(button => button.textContent === backupBusyLabel)) window.__backupBusyFrames++;
        window.__backupFrame = requestAnimationFrame(frame);
      };
      window.__backupFrame = requestAnimationFrame(frame);
    }, DFS_WORKFLOW_COPY.backupWorking);
    const framesBefore = await page.evaluate(() => window.__backupAnimationFrames);
    const downloaded = await backupFile(page, `large-pool-${width}`);
    assert.ok(await page.evaluate(() => window.__backupAnimationFrames) > framesBefore,
      "Animation frames continue while the real worker encodes the large backup");
    const responsiveness = await page.evaluate(() => ({ animationFrames: window.__backupAnimationFrames,
      busyAnimationFrames: window.__backupBusyFrames, browserDownloadRoundTripMs: Math.round(performance.now() - window.__backupStartedAt) }));
    assert.ok(responsiveness.busyAnimationFrames > 0, "The main thread paints frames while the backup button shows its busy state");
    await page.evaluate(() => cancelAnimationFrame(window.__backupFrame));
    assert.ok(workerUrls.some(url => url.endsWith("/dfsPortfolioBackup.worker.js")), "The production backup worker was actually used");
    const original = readPortfolioBackup(downloaded.text);
    assert.equal(auditPortfolio(original.batches).total, 140);
    assert.equal(original.batches[0].salaryCatalog.length, 700);
    // Keep the expanded historical stress case while measuring the real
    // compact wire format against the same supported version-1 content.
    const legacyText = writePortfolioBackup(original.batches, original.appearanceLimits, original.exportedAt,
      { version: 1, reviewRules: original.reviewRules });
    let values = 0, compactValues = 0;
    JSON.parse(legacyText, (_key, value) => { values++; return value; });
    JSON.parse(downloaded.text, (_key, value) => { compactValues++; return value; });
    assert.ok(values > 500_000);
    assert.equal(JSON.parse(downloaded.text).version, 2);
    assert.ok(Buffer.byteLength(downloaded.text) < Buffer.byteLength(legacyText) * 0.8,
      "Shared references must materially reduce the repeated full-pool backup");
    assert.deepEqual(readPortfolioBackup(legacyText).batches, original.batches, "Version-1 backups remain readable");
    await page.locator("[aria-labelledby='dfw-portfolio-title']").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `large-pool-${width}.png`) });
    await page.reload();
    await restoreFile(page, downloaded.text);
    await page.getByText("140 / 140 requested unique · 140 collected · 7 batches · 0 duplicates · 0 shortfall", { exact: true }).waitFor();
    const restored = readPortfolioBackup((await backupFile(page, `large-pool-restored-${width}`)).text);
    assert.deepEqual(restored.batches, original.batches);
    assert.deepEqual(restored.appearanceLimits, original.appearanceLimits);
    assert.equal(await page.evaluate(() => window.__portfolioFixture.requests.length), 0);
    assert.deepEqual(errors, []);
    stressReport.push({ width, synthetic: true, lineups: 140, players: 700,
      version1Bytes: Buffer.byteLength(legacyText), version2Bytes: Buffer.byteLength(downloaded.text),
      legacyValues: values, compactValues, workerObserved: true, exactRestore: true, regenerated: false,
      browserErrors: 0, ...responsiveness });
    console.log(`PASS ${width}: 140-lineup/700-player compact backup restores exact history with no regeneration; v1 ${Buffer.byteLength(legacyText)} bytes/${values} values → v2 ${Buffer.byteLength(downloaded.text)} bytes/${compactValues} values.`);
    console.log(`Worker responsiveness ${width}: ${responsiveness.busyAnimationFrames} animation frames during visible busy state; download round trip ${responsiveness.browserDownloadRoundTripMs}ms (synthetic browser/file workflow, not a production timing benchmark).`);
    await context.close();
  }
} finally { await writeFile(path.join(output, "stress-report.json"), JSON.stringify({ synthetic: true, stressReport }, null, 2)); await browser.close(); }
