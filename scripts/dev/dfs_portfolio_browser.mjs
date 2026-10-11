// Run with Vite on :5173. Uses production controls and the local-only fixture API.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDfsCsv, csvLines } from "../../frontend/src/dfsCsv.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "frontend/package.json"));
const { chromium } = require("playwright");
const output = path.join(root, "outputs/dfs-portfolio");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const templateRows = [
  ["Entry ID", "Contest ID", "Contest Name", "Entry Fee", "QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST", "Note"],
  ...Array.from({ length: 7 }, (_, i) => [String(101 + i), "900", "Reserved Classic", "$3.00", ...Array(9).fill("Unchanged"), "Preserve me"]),
];
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto("http://127.0.0.1:5173/test-fixtures/dfs-portfolio.html");
    await page.getByRole("button", { name: /^Lineups:/ }).click();
    await page.getByRole("option", { name: "3", exact: true }).click();
    await page.getByRole("button", { name: "Lock Example 1", exact: true }).click();
    await page.locator(".dfw-build-button").click();
    const label = page.getByLabel("Batch label", { exact: true });
    const add = page.getByRole("button", { name: "Add current build to portfolio", exact: true });
    await label.fill("Original batch"); await add.click();
    await page.getByText("3 / 150 unique · 3 collected", { exact: false }).waitFor();
    // Adding the same build reports duplicates, then removal restores every total.
    await label.fill("Duplicate batch"); await add.click();
    await page.getByText("3 / 150 unique · 6 collected · 2 batches · 3 duplicates", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Remove batch: Duplicate batch", exact: true }).click();
    await page.getByText("3 / 150 unique · 3 collected · 1 batch · 0 duplicates", { exact: false }).waitFor();
    await page.getByLabel("Import projections & ownership", { exact: true }).setInputFiles({ name: "projections.csv", mimeType: "text/csv", buffer: Buffer.from("ID,Proj,Floor,Ceiling\n1,14,5,15") });
    await page.getByRole("button", { name: "Rebuild lineups", exact: true }).click();
    await label.fill("Imported projections"); await add.click();
    await page.getByText("6 / 150 unique · 6 collected · 2 batches · 0 duplicates", { exact: false }).waitFor();
    const portfolio = page.locator("[aria-labelledby='dfw-portfolio-title']");
    const qbRow = portfolio.getByRole("row").filter({ has: page.getByRole("cell", { name: "Example 1", exact: true }) });
    assert.deepEqual(await qbRow.getByRole("cell").allTextContents(), ["Example 1", "6", "100.0%", "6", "2", ""]);
    await page.getByRole("button", { name: /^Reserved-entry lineup source:/ }).click();
    await page.getByRole("option", { name: "Reviewed portfolio", exact: true }).click();
    await page.getByLabel("Import Edit Entries CSV", { exact: true }).setInputFiles({ name: "entries.csv", mimeType: "text/csv", buffer: Buffer.from(csvLines(templateRows).join("\n")) });
    const download = page.getByRole("button", { name: "Download portfolio Edit Entries CSV", exact: true });
    assert.equal(await download.isDisabled(), true);
    await page.getByRole("button", { name: "Assign lineups in order", exact: true }).click();
    await page.getByRole("checkbox", { name: "I checked that this template is for the same slate and start time.", exact: true }).check();
    const max = page.getByRole("spinbutton", { name: "Maximum appearances (optional): Example 1", exact: true });
    await max.fill("5"); assert.equal(await download.isDisabled(), true);
    await max.fill("6"); assert.equal(await download.isEnabled(), true);
    // A failed snapshot save must not write the ledger or trigger a download.
    await page.evaluate(() => { window.__portfolioFixture.failSave = true; });
    await download.click(); await page.getByText("Fixture save failure", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__portfolioFixture.imports.length), 0);
    await page.evaluate(() => { window.__portfolioFixture.failSave = false; });
    const downloaded = page.waitForEvent("download"); await download.click();
    const file = await downloaded;
    const savedPath = path.join(output, `entries-${width}.csv`); await file.saveAs(savedPath);
    const exported = parseDfsCsv(await readFile(savedPath, "utf8"));
    assert.equal(exported.length, templateRows.length); assert.deepEqual(exported[7], templateRows[7]);
    for (let i = 1; i <= 6; i++) { assert.deepEqual(exported[i].slice(0, 4), templateRows[i].slice(0, 4)); assert.equal(exported[i][13], "Preserve me"); }
    const state = await page.evaluate(() => window.__portfolioFixture);
    assert.equal(state.builds.length, 2); assert.equal(state.imports.length, 1);
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
    // Replacing the current site's entire catalog must never rebind original batches.
    await page.evaluate(() => { window.__portfolioFixture.unrelatedCatalog = true; });
    await page.getByRole("button", { name: /^Format:/ }).click();
    await page.getByRole("option", { name: "FanDuel Classic", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".dfw-build-button")?.disabled === false);
    const preservedDownload = page.waitForEvent("download"); await download.click();
    const preservedFile = await preservedDownload, preservedPath = path.join(output, `original-catalog-${width}.csv`);
    await preservedFile.saveAs(preservedPath);
    assert.deepEqual(parseDfsCsv(await readFile(preservedPath, "utf8")), exported);
    assert.equal(await page.evaluate(() => window.__portfolioFixture.builds.length), 2);
    await portfolio.scrollIntoViewIfNeeded();
    assert.equal(await max.inputValue(), "6");
    const numberRoom = await max.evaluate(input => {
      const style = getComputedStyle(input);
      return input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    });
    assert.ok(numberRoom >= 30, "Maximum count must have space for digits and its stepper");
    const tableFits = await portfolio.locator("table").evaluate(table => table.scrollWidth <= table.parentElement.clientWidth + 1);
    assert.equal(tableFits, true, "Portfolio counts and names must fit together at the tested width");
    await portfolio.screenshot({ path: path.join(output, `portfolio-${width}.png`) });
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}: collect, duplicate/remove, locked exposure, imported snapshot, count/limit gate, failed save, entry metadata/provenance, unrelated current catalog, standalone download`);
    if (width === 1280) {
      await page.reload();
      await page.getByRole("button", { name: /^Lineups:/ }).click();
      await page.getByRole("option", { name: "50", exact: true }).click();
      for (const labelText of ["First 50", "Second 50", "Third 50"]) {
        await page.locator(".dfw-build-button").click();
        await label.fill(labelText); await add.click();
      }
      await page.getByText("150 / 150 unique · 150 collected · 3 batches · 0 duplicates · 0 shortfall", { exact: true }).waitFor();
      await page.getByRole("button", { name: /^Reserved-entry lineup source:/ }).click();
      await page.getByRole("option", { name: "Reviewed portfolio", exact: true }).click();
      const largeRows = [templateRows[0], ...Array.from({ length: 151 }, (_, i) => [String(1000 + i), "901", "150 Reserved Classic", "$3.00", ...Array(9).fill("Keep"), "Keep metadata"])];
      await page.getByLabel("Import Edit Entries CSV", { exact: true }).setInputFiles({ name: "150-entries.csv", mimeType: "text/csv", buffer: Buffer.from(csvLines(largeRows).join("\n")) });
      await page.getByRole("button", { name: "Assign lineups in order", exact: true }).click();
      await page.getByRole("checkbox", { name: "I checked that this template is for the same slate and start time.", exact: true }).check();
      const largeDownload = page.waitForEvent("download"); await download.click();
      const largeFile = await largeDownload, largePath = path.join(output, "150-entries.csv"); await largeFile.saveAs(largePath);
      const largeExport = parseDfsCsv(await readFile(largePath, "utf8"));
      assert.equal(largeExport.length, 152); assert.deepEqual(largeExport[151], largeRows[151]);
      const largeState = await page.evaluate(() => window.__portfolioFixture);
      assert.equal(largeState.builds.length, 3); assert.equal(largeState.imports[0].entries.length, 150);
      assert.equal(largeState.imports[0].entries[100].build_id, "saved-3");
      assert.equal(largeState.imports[0].entries[100].lineup_index, 0);
      console.log("PASS 150-lineup browser export: three batches, 150 selected entries, original batch links, unrelated entry preserved");
    }
    await context.close();
  }
} finally { await browser.close(); }
