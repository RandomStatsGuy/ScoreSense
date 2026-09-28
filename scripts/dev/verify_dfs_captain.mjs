import { createRequire } from "node:module";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { DFS_WORKSPACE_COPY } from "../../frontend/src/dfsToolPresentation.js";
import { measureScript, minTargetForWidth, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright");
const browser = await chromium.launch({ headless: true, timeout: 15000 });
const base = process.env.DFS_PREVIEW_URL || "http://127.0.0.1:5173/test-fixtures/dfs-workspace.html";
const output = "outputs/dfs-captain";
await fs.mkdir(output, { recursive: true });
const reports = [];
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.setDefaultTimeout(15000);
    console.log(`Checking ${width}`);
    const errors = [];
    page.on("pageerror", e => { errors.push(e.message); console.log("Page error", e.message); });
    await page.addInitScript(() => {
      const original = window.setInterval;
      window.setInterval = (fn, ms, ...args) => {
        if (ms === 300000) window.__dfsRefreshTick = fn;
        return original(fn, ms, ...args);
      };
    });
    await page.goto(base, { waitUntil: "domcontentloaded" });
    console.log("Fixture loaded");
    await page.getByRole("button", { name: /^Format/ }).click();
    await page.getByRole("option", { name: "DraftKings Showdown", exact: true }).click();
    await page.getByRole("button", { name: /^Minimum differences/ }).click();
    await page.getByRole("option", { name: "Captain change only", exact: true }).click();
    await page.getByText("Lineups may use the same six players with a different Captain.", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Build lineups", exact: true }).last().click();
    await page.getByText("Built 20 lineups.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__lastDfsRequest.max_overlap), 6);
    assert.equal(await page.evaluate(() => window.__lastDfsRequest.salary_snapshot_id), "a".repeat(64));
    await page.getByRole("button", { name: DFS_WORKSPACE_COPY.save, exact: true }).click();
    await page.getByText("Build saved with its original projections and settings.", { exact: true }).waitFor();
    const savedSettings = await page.evaluate(() => window.__lastDfsSavedBuild.settings);
    await page.evaluate(async () => { window.__dfsProjectionBump = 1; await window.__dfsRefreshTick(); });
    await page.getByText("Live player pool checked.", { exact: false }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__lastDfsSavedBuild.settings), savedSettings);
    await page.getByText("22.0", { exact: true }).first().waitFor();
    await page.evaluate(async () => { window.__dfsRefreshFail = true; await window.__dfsRefreshTick(); });
    await page.getByText("The live player pool could not refresh.", { exact: false }).waitFor();
    await page.getByText("22.0", { exact: true }).first().waitFor();
    await page.evaluate(async () => { window.__dfsRefreshFail = false; await window.__dfsRefreshTick(); });
    assert.equal(await page.getByRole("alert").count(), 0);
    assert.equal(savedSettings.build_snapshot.id, "fixture-snapshot");
    assert.equal(savedSettings.snapshot_at, "2026-09-28T12:00:00Z");
    await page.getByRole("button", { name: /^Minimum differences/ }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/captain-${width}.png`, fullPage: true });
    const results = await page.evaluate(measureScript(), {
      minTarget: minTargetForWidth(width), numericRe: NUMERIC_RE.source,
      barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX,
      columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS,
    });
    await page.getByRole("button", { name: /^Format/ }).click();
    await page.getByRole("option", { name: "DraftKings Classic", exact: true }).click();
    await page.getByRole("button", { name: /^Minimum differences/ }).click();
    assert.equal(await page.getByRole("option", { name: "Captain change only", exact: true }).count(), 0);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Build lineups", exact: true }).last().click();
    await page.getByText("Built 20 lineups.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__lastDfsRequest.max_overlap), 8);
    assert.equal(await page.evaluate(() => window.__lastDfsRequest.salary_snapshot_id), "b".repeat(64));
    reports.push({ width, results, errors, controls: "passed" });
    console.log(JSON.stringify(reports.at(-1)));
    await page.close();
  }
} finally {
  await fs.writeFile(`${output}/report.json`, JSON.stringify(reports, null, 2));
  await browser.close();
}
if (reports.some(row => row.errors.length || row.results.some(rule => !rule.ok))) process.exitCode = 1;
