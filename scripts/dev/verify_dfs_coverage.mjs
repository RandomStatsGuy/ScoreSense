import { createRequire } from "node:module";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { DFS_WORKSPACE_COPY as C } from "../../frontend/src/dfsToolPresentation.js";
import { measureScript, minTargetForWidth, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright");
const browser = await chromium.launch({ headless: true, timeout: 15000 });
const base = process.env.DFS_PREVIEW_URL || "http://127.0.0.1:5173/test-fixtures/dfs-workspace.html";
const output = "docs/reviews/dfs-coverage-ui";
await fs.mkdir(output, { recursive: true });
const reports = [];
async function audit(page, width, state) {
  const results = await page.evaluate(measureScript(), {
    minTarget: minTargetForWidth(width), numericRe: NUMERIC_RE.source,
    barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX,
    columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS,
  });
  reports.push({ width, state, results });
  console.log(JSON.stringify(reports.at(-1)));
}
async function format(page, label) {
  await page.getByRole("button", { name: /^Format/ }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await page.locator(".dfw-skeleton").waitFor({ state: "hidden" });
  assert.equal(await page.locator(".dfw-player-table").evaluate(el => el.parentElement.scrollLeft), 0);
}
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(() => {
      const original = window.setInterval;
      window.setInterval = (fn, ms, ...args) => {
        if (ms === 300000) window.__dfsRefreshTick = fn;
        return original(fn, ms, ...args);
      };
    });
    await page.goto(base + "?state=coverage", { waitUntil: "domcontentloaded" });
    await page.getByText("10 players available", { exact: true }).waitFor();
    assert.equal(await page.locator(".dfw-matchup-card").count(), 3);
    assert.equal(await page.getByRole("heading", { name: "Captain comparison", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "K", exact: true }).count(), 0);
    assert.equal(await page.locator(".dfw-freshness").getAttribute("class"), "dfw-freshness is-good");
    assert.deepEqual(await page.locator(".dfw-matchup-markets").allTextContents(), [
      "Total49.5Up from 47.5SpreadLAR -2.5From LAR -1.5",
      "Total48Down from 49SpreadBUF -1From KC -1",
      "Total41.5SpreadMIA -3.5",
    ]);
    await page.screenshot({ path: output + "/classic-" + width + ".png", fullPage: true });
    await page.locator(".dfw-matchups").screenshot({ path: output + "/games-" + width + ".png" });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: output + "/classic-top-" + width + ".png" });
    await audit(page, width, "Classic");
    await page.evaluate(() => document.documentElement.dataset.theme = "light");
    await page.locator(".dfw-matchups").screenshot({ path: output + "/games-light-" + width + ".png" });
    await audit(page, width, "Classic light");
    await page.evaluate(() => document.documentElement.dataset.theme = "dark");
    await page.getByRole("button", { name: "1 needs estimates", exact: true }).click();
    await page.getByRole("region", { name: C.missingTitle }).getByText("Missing Player", { exact: true }).waitFor();
    await page.getByText(C.missingReasons.position_conflict, { exact: true }).waitFor();
    await page.screenshot({ path: output + "/coverage-" + width + ".png", fullPage: true });
    await audit(page, width, "Missing estimates expanded");
    await page.getByRole("button", { name: "2 unavailable", exact: true }).click();
    assert.equal(await page.locator(".dfw-player-table tbody tr").count(), 2);
    assert.equal(await page.locator(".dfw-player-table").getByRole("button", { name: /^Lock / }).first().isDisabled(), true);
    await page.getByRole("button", { name: /^Player status/ }).click();
    await page.getByRole("option", { name: "Available", exact: true }).click();
    await page.locator(".dfw-player-table tbody tr").first().getByRole("button", { name: /^Lock / }).click();
    await page.locator(".dfw-matchup-card").first().getByRole("button", { name: /^Raise stack weight/ }).click();
    await page.getByRole("button", { name: C.build, exact: true }).last().click();
    await page.getByText("Built 20 lineups.", { exact: true }).waitFor();
    assert.equal(await page.locator(".dfw-lineup-row").count(), 9);
    const request = await page.evaluate(() => window.__lastDfsRequest);
    assert.equal(request.locked_player_ids.length, 1);
    assert.equal(request.stack_game_weights.length, 1);
    await page.evaluate(async () => { window.__dfsServerStale = true; await window.__dfsRefreshTick(); });
    await page.locator(".dfw-freshness").getByText(C.freshnessStale, { exact: true }).waitFor();
    await page.evaluate(async () => { window.__dfsRefreshFail = true; await window.__dfsRefreshTick(); });
    await page.locator(".dfw-freshness").getByText(C.freshnessFailed, { exact: true }).waitFor();
    await page.getByText("10 players available", { exact: true }).waitFor();
    await page.evaluate(async () => { window.__dfsRefreshFail = false; window.__dfsServerStale = false; await window.__dfsRefreshTick(); });
    await page.locator(".dfw-freshness.is-good").waitFor();
    await page.getByRole("region", { name: C.missingTitle }).locator('input[type="file"]').setInputFiles({
      name: "projections.csv", mimeType: "text/csv",
      buffer: Buffer.from("ID,Proj,Floor,Ceiling,Ownership\n300,7,2,15,5\n"),
    });
    await page.getByText("11 players available", { exact: true }).waitFor();
    await page.getByRole("button", { name: "0 need estimates", exact: true }).waitFor();
    await page.locator(".dfw-source-summary dt").filter({ hasText: /^Imported/ }).waitFor();
    await page.locator(".dfw-player-table th").getByText("Own.", { exact: true }).waitFor();
    await page.evaluate(async () => { await window.__dfsRefreshTick(); });
    await page.getByText("11 players available", { exact: true }).waitFor();
    await page.locator(".dfw-source-summary dt").filter({ hasText: /^Imported/ }).waitFor();
    await format(page, "FanDuel Classic");
    await page.getByText("10 players available", { exact: true }).waitFor();
    assert.equal(await page.locator(".dfw-matchup-card").count(), 3);
    await audit(page, width, "FanDuel Classic");
    await format(page, "DraftKings Showdown");
    await page.getByText("11 players available", { exact: true }).waitFor();
    assert.equal(await page.locator(".dfw-matchups").count(), 0);
    await page.getByRole("heading", { name: "Captain comparison", exact: true }).waitFor();
    await page.screenshot({ path: output + "/showdown-" + width + ".png", fullPage: true });
    await audit(page, width, "Showdown");
    await format(page, "FanDuel Single game");
    assert.equal(await page.locator(".dfw-matchups").count(), 0);
    await format(page, "Season-long PPR");
    await page.locator(".dfw-matchup-card").nth(2).waitFor();
    assert.equal(await page.locator(".dfw-matchup-card").count(), 3);
    assert.equal(await page.getByRole("heading", { name: "Captain comparison", exact: true }).count(), 0);
    await audit(page, width, "Season-long");
    for (const state of ["empty", "loading", "error", "readonly"]) {
      await page.goto(base + "?state=" + state, { waitUntil: "domcontentloaded" });
      if (state === "loading") {
        await page.locator(".dfw-freshness").getByText(C.freshnessLoading, { exact: true }).waitFor();
        await page.screenshot({ path: output + "/loading-" + width + ".png" });
        await audit(page, width, state);
        await page.getByText("7 players available", { exact: true }).waitFor();
      } else if (state === "empty") {
        await page.getByText("0 players available", { exact: true }).waitFor();
        await page.getByText(C.sourcesEmpty, { exact: true }).waitFor();
        await audit(page, width, state);
      } else if (state === "error") {
        await page.locator(".dfw-freshness").getByText(C.freshnessLoadFailed, { exact: true }).waitFor();
        await audit(page, width, state);
      } else {
        await page.getByRole("button", { name: "Results", exact: true }).click();
        await page.getByText("Sign in to save your DFS results.", { exact: true }).waitFor();
        await audit(page, width, state);
      }
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await fs.writeFile(output + "/report.json", JSON.stringify(reports, null, 2));
  await browser.close();
}
if (reports.some(row => row.results.some(rule => !rule.ok))) process.exitCode = 1;