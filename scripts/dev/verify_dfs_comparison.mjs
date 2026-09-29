import { createRequire } from "node:module";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { DFS_CAPTAIN_COMPARISON_COPY as C, DFS_WORKSPACE_COPY } from "../../frontend/src/dfsToolPresentation.js";
import { measureScript, minTargetForWidth, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright");
const browser = await chromium.launch({ headless: true, timeout: 15000 });
const output = "outputs/dfs-comparison";
await fs.mkdir(output, { recursive: true });
const reports = [];
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", error => { errors.push(error.message); console.log(error.message); });
    await page.goto("http://127.0.0.1:5173/test-fixtures/dfs-workspace.html");
    assert.equal(await page.getByRole("heading", { name: C.title, exact: true }).count(), 0);
    await page.getByRole("button", { name: /^Format/ }).click();
    await page.getByRole("option", { name: "DraftKings Showdown", exact: true }).click();
    await page.getByText(C.ready, { exact: true }).waitFor();
    await page.getByRole("button", { name: "Build lineups", exact: true }).last().click();
    await page.getByText("Built 20 lineups.", { exact: true }).waitFor();
    await page.getByRole("button", { name: DFS_WORKSPACE_COPY.save, exact: true }).click();
    await page.getByText("Build saved with its original projections and settings.", { exact: true }).waitFor();
    const compare = async mode => {
      await page.evaluate(mode => { window.__comparisonMode = mode; }, mode);
      await page.getByRole("button", { name: C.action, exact: true }).click();
    };
    await compare("complete");
    await page.getByText("1 lineup solved · 2 of 2 Captains evaluated", { exact: false }).waitFor();
    const request = await page.evaluate(() => window.__lastDfsRequest);
    assert.equal(request.include_captain_comparison, true);
    assert.equal(request.salary_snapshot_id, "a".repeat(64));
    assert.equal(request.lineup_count, 1);
    assert.equal(request.max_exposure, null);
    assert.equal(request.randomness, 0);
    assert.equal(await page.getByRole("button", { name: DFS_WORKSPACE_COPY.saved, exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("heading", { name: "20 lineups", exact: true }).count(), 1);
    await compare("none");
    await page.getByText(C.none, { exact: true }).waitFor();
    await compare("error");
    await page.getByText("Comparison service unavailable.", { exact: true }).waitFor();
    await compare("readonly");
    await page.getByText("Sign in to compare Captains.", { exact: true }).waitFor();
    await compare("mismatch");
    await page.getByText(C.mismatch, { exact: true }).waitFor();
    await compare("slow");
    await page.getByRole("button", { name: C.loading, exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: C.loading, exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: /^Minimum differences/ }).click();
    await page.getByRole("option", { name: "1", exact: true }).click();
    await page.getByText(C.ready, { exact: true }).waitFor();
    await page.evaluate(() => window.__releaseComparison());
    await page.waitForTimeout(100);
    assert.equal(await page.getByText(C.ready, { exact: true }).count(), 1);
    await compare("partial");
    await page.getByText(C.partial, { exact: true }).waitFor();
    await page.getByText(/^Blake Corum · 90.95/).click();
    await page.getByRole("heading", { name: C.title, exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/comparison-${width}.png`, fullPage: true });
    await page.getByRole("region", { name: C.title, exact: true }).screenshot({ path: `${output}/panel-${width}.png` });
    const results = await page.evaluate(measureScript(), {
      minTarget: minTargetForWidth(width), numericRe: NUMERIC_RE.source,
      barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX,
      columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS,
    });
    reports.push({ width, results, errors, states: "complete, partial, infeasible, error, mismatch, loading, readonly, empty pool, stale response, preserved portfolio" });
    console.log(JSON.stringify(reports.at(-1)));
    await page.getByRole("button", { name: /^Format/ }).click();
    await page.getByRole("option", { name: "DraftKings Classic", exact: true }).click();
    assert.equal(await page.getByRole("heading", { name: C.title, exact: true }).count(), 0);
    await page.goto("http://127.0.0.1:5173/test-fixtures/dfs-workspace.html?state=empty");
    await page.getByRole("button", { name: /^Format/ }).click();
    await page.getByRole("option", { name: "DraftKings Showdown", exact: true }).click();
    await page.getByText(C.empty, { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: C.action, exact: true }).isDisabled(), true);
    await page.close();
  }
} finally {
  await fs.writeFile(`${output}/report.json`, JSON.stringify(reports, null, 2));
  await browser.close();
}
if (reports.some(row => row.errors.length || row.results.some(rule => !rule.ok))) process.exitCode = 1;
