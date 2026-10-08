import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { measureScript, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright");
let base = process.env.INSIGHTS_PREVIEW_URL, viteServer;
if (!base) {
  // An isolated verification server on an OS-assigned port, without an API proxy.
  const { createServer } = await import(new URL("../../frontend/node_modules/vite/dist/node/index.js", import.meta.url));
  const { default: react } = await import(pathToFileURL(require.resolve("@vitejs/plugin-react").replace(/\.cjs$/, ".js")).href);
  viteServer = await createServer({ configFile: false, root: fileURLToPath(new URL("../../frontend", import.meta.url)),
    plugins: [react()], server: { port: 0, host: "127.0.0.1", hmr: false, strictPort: true }, logLevel: "error" });
  await new Promise((resolve, reject) => {
    viteServer.httpServer.once("error", reject);
    viteServer.httpServer.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${viteServer.httpServer.address().port}`;
}
const folder = "outputs/release-insights-hosts-review";
await fs.mkdir(folder, { recursive: true });
let browser;
const reports = [];
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 390]) for (const host of ["native", "sleeper"]) for (const format of ["pick", "salary"]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, serviceWorkers: "block" });
    const errors = [], apiRequests = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.url().includes("/api/")) apiRequests.push(request.url()); });
    await page.route("**/api/**", route => route.abort());
    await page.goto(`${base}/test-fixtures/insights-hosts.html?host=${host}&format=${format}`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Season standings", exact: true }).waitFor();
    const nav = page.getByRole("navigation", { name: "Insights", exact: true });
    assert.equal(await nav.getByRole("button", { name: "Spend", exact: true }).count(), format === "salary" ? 1 : 0);
    assert.equal(await nav.getByRole("button", { name: "History", exact: true }).count(), format === "salary" ? 1 : 0);
    assert.ok((await page.locator("main").innerText()).includes("Maya Chen"));
    for (const tab of ["overview", "scoring"]) {
      if (tab === "scoring") {
        await nav.getByRole("button", { name: "Scoring", exact: true }).click();
        await page.locator(".hub-insights-scoring-boards").waitFor();
        await page.locator("summary").filter({ hasText: /^Standings table/ }).click();
        await page.locator("summary").filter({ hasText: /^Player scoring/ }).click();
        await page.getByText("Amon-Ra St. Brown", { exact: false }).first().waitFor();
        assert.ok((await page.locator("main").innerText()).includes("58.5"));
        if (format === "pick") assert.ok(!/Cap efficiency|Average salary|Highest cap hit|pts\/\$/.test(await page.locator("main").innerText()));
      }
      const audit = await page.evaluate(measureScript(), { minTarget: width === 390 ? 44 : 32,
        numericRe: NUMERIC_RE.source, barControlSelector: BAR_CONTROL_SELECTOR,
        tableDeadZonePx: TABLE_DEAD_ZONE_PX, columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      const path = `${folder}/${host}-${format}-${tab}-${width}.png`;
      await page.screenshot({ path, fullPage: true });
      reports.push({ width, host, format, tab, path, audit });
      console.log(`${width} ${host}/${format}/${tab}:`, JSON.stringify(audit.filter(row => !row.ok)));
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(apiRequests, [], "The fixture must never contact a league API");
    assert.deepEqual(await page.evaluate(() => window.fixtureWrites), []);
    await page.close();
  }
  for (const width of [1280, 390]) for (const state of ["empty", "loading", "error"]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, serviceWorkers: "block" });
    await page.goto(`${base}/test-fixtures/insights-hosts.html?state=${state}`, { waitUntil: "domcontentloaded" });
    const nav = page.getByRole("navigation", { name: "Insights", exact: true });
    await nav.waitFor();
    if (state === "error") { await page.locator(".hub-insights > .error").waitFor(); assert.ok((await page.locator(".hub-insights > .error").innerText()).length > 0); }
    if (state === "empty") await page.getByRole("heading", { name: "Season standings", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    const audit = await page.evaluate(measureScript(), { minTarget: width === 390 ? 44 : 32, numericRe: NUMERIC_RE.source, barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX, columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS });
    const path = `${folder}/${state}-${width}.png`;
    await page.screenshot({ path, fullPage: true });
    assert.deepEqual(await page.evaluate(() => window.fixtureWrites), []);
    reports.push({ width, state, path, audit });
    console.log(width, state, JSON.stringify(audit.filter(row => !row.ok)));
    await page.close();
  }
  assert.ok(reports.every(report => report.audit.every(row => row.ok)), "Every layout check must pass");
} finally {
  await browser?.close();
  await viteServer?.close();
  await fs.writeFile(`${folder}/report.json`, JSON.stringify(reports, null, 2));
}
