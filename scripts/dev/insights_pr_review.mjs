import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { measureScript, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright");
const base = "http://127.0.0.1:5173";
const league = "09c9f8c3-14ae-44e3-9de0-ea7b68562f5d";
const overview = await (await fetch(`http://127.0.0.1:8000/api/hub/league/${league}/insights/overview`)).json();
assert.ok(overview.landing?.season_summaries?.length, "Saved season summaries required");
const browser = await chromium.launch({ headless: true });
const reports = [], timings = [], errors = [];
await fs.mkdir("outputs/insights-review", { recursive: true });
try {
  for (const width of [1280, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, serviceWorkers: "block" });
    const requests = [];
    page.on("request", (r) => { if (r.url().includes("/api/")) requests.push(r.url()); });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/hub/workspace*", async (route) => {
      const res = await route.fetch();
      const data = await res.json();
      await route.fulfill({ response: res, json: { ...data, hub_context: overview.hub_context,
        insights_overview: route.request().url().includes("insights_overview=1") ? overview : undefined } });
    });
    await page.goto(`${base}/hub/home`, { waitUntil: "domcontentloaded" });
    await page.locator('.hub-home-layout').waitFor({ timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('.hub-home-card[aria-busy="true"]'), null, { timeout: 30000 });
    if (width >= 769) await page.getByRole("button", { name: "League navigation", exact: true }).click();
    else {
      await page.getByRole("button", { name: "Home, choose destination", exact: true }).click();
      await page.getByRole("button", { name: "League", exact: true }).click();
    }
    const target = width >= 769 ? page.getByRole("link", { name: "Insights", exact: true }) : page.getByRole("button", { name: "Insights", exact: true });
    await target.waitFor();
    await page.evaluate(() => {
      document.addEventListener("click", () => {
        const start = performance.now();
        const observer = new MutationObserver(() => {
          if (document.querySelector(".hub-insights-record-book")) { window.insightsEntryMs = performance.now() - start; observer.disconnect(); }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }, { once: true, capture: true });
    });
    await target.click();
    await page.locator(".hub-insights-record-book").waitFor();
    const firstEntryMs = Math.round(await page.evaluate(() => window.insightsEntryMs));
    assert.ok(firstEntryMs < 1000, `Insights entry took ${firstEntryMs} ms`);
    timings.push({ width, firstEntryMs });
    assert.ok((await page.locator(".hub-insights-record-identity").allTextContents()).some((n) => n.includes("Andrew M")));
    const count = requests.length;
    await page.locator(".hub-insights-period summary").click();
    const started = Date.now();
    await page.getByRole("button", { name: "Last 3 years", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".hub-insights-period summary strong")?.textContent === "Last 3 years");
    timings.push({ width, periodMs: Date.now() - started });
    assert.equal(requests.length, count, "Overview period must remain local");
    await page.locator(".hub-insights-period summary").click();
    await page.getByRole("button", { name: "All time", exact: true }).click();
    await page.getByRole("button", { name: "Points", exact: true }).click();
    await page.getByRole("button", { name: "Record", exact: true }).click();
    for (const [id, name] of [["overview", "Overview"], ["contracts", "Contracts"], ["cap", "Spend"], ["scoring", "Scoring"], ["ownership", "History"]]) {
      await page.getByRole("navigation", { name: "Insights", exact: true }).getByRole("button", { name, exact: true }).click();
      await page.waitForFunction(() => !document.querySelector(".hub-insights-progress--active"), null, { timeout: 30000 });
      await page.waitForTimeout(150);
      assert.equal(await page.getByRole("navigation", { name: "Insights", exact: true }).getByRole("button", { name, exact: true }).getAttribute("aria-current"), "true", `${name} must be the selected destination`);
      if (id === "contracts") await page.locator(".hub-insights-contracts").waitFor();
      assert.equal(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth + 1), false, `${id} overflow at ${width}`);
      if (width !== 320) {
        const audit = await page.evaluate(measureScript(), { minTarget: width === 390 ? 44 : 32, numericRe: NUMERIC_RE.source,
          barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX, columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS });
        reports.push({ width, route: new URL(page.url()).pathname, failures: audit.filter((r) => !r.ok) });
        console.log(width, id, JSON.stringify(audit.filter((r) => !r.ok)));
        await page.screenshot({ path: `outputs/insights-review/${id}-${width}.png`, fullPage: true });
      }
      if (id === "contracts") {
        await page.locator(".hub-insights-period summary").click();
        await page.keyboard.press("Escape");
        assert.equal(await page.locator(".hub-insights-period").getAttribute("open"), null);
        const before = requests.length;
        await page.locator(".hub-insights-period summary").click();
        await page.getByRole("button", { name: "Last 3 years", exact: true }).click();
        assert.equal(requests.length, before, "Contracts period must remain local");
      }
    }
    const back = Date.now();
    await page.getByRole("navigation", { name: "Insights", exact: true }).getByRole("button", { name: "Overview", exact: true }).click();
    await page.locator(".hub-insights-record-book").waitFor();
    timings.push({ width, returnMs: Date.now() - back });
    await page.close();
  }
  assert.deepEqual(errors, []);
  assert.ok(reports.every((r) => !r.failures.length), "All Insights audits must pass");
} finally {
  await fs.writeFile("outputs/insights-review/pr-review.json", JSON.stringify({ reports, timings, errors }, null, 2));
  await browser.close();
}
