// Test the production build against the existing local API, without a second server.
// npm --prefix frontend run build && node scripts/dev/theme_browser.mjs
import { chromium } from "../../frontend/node_modules/playwright/index.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { measureScript, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS, livingSurfaceRoutes } from "./layout_audit.mjs";
import { LIVING_SURFACES } from "../../frontend/src/livingSurfaces.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dist = path.join(root, "frontend/dist");
const out = path.join(root, "docs/mockups/light-theme-review");
const origin = "http://127.0.0.1:5173";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
await context.route(`${origin}/**`, async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith("/api/")) return route.continue();
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const target = path.resolve(dist, relative);
  if (!target.startsWith(dist + path.sep) && target !== dist) return route.abort();
  const file = route.request().isNavigationRequest() ? path.join(dist, "index.html") : target;
  const types = { ".js": "application/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
  try { await route.fulfill({ body: await fs.readFile(file), contentType: types[path.extname(file)] || "application/octet-stream" }); }
  catch { await route.abort(); }
});
const report = [];
try {
  const page = await context.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/projections/weekly`);
  await page.getByRole("button", { name: "Switch to light mode", exact: true }).waitFor();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.getByRole("button", { name: "Switch to light mode", exact: true }).click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  await page.reload();
  await page.getByRole("button", { name: "Switch to dark mode", exact: true }).waitFor();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  const other = await context.newPage();
  await other.goto(`${origin}/projections/weekly`);
  await other.waitForFunction(() => window.scoreSenseTheme);
  await page.getByRole("button", { name: "Switch to dark mode", exact: true }).click();
  await other.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await other.close();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Switch to light mode", exact: true }).click();
  const phoneSurfaces = await page.locator(".weekly-sticky-bar, .app-bottom-nav").evaluateAll((elements) => elements.filter((el) => el.getBoundingClientRect().height > 0).map((el) => ({ name: el.className, color: getComputedStyle(el).backgroundColor })));
  for (const surface of phoneSurfaces) {
    const rgb = surface.color.match(/[\d.]+/g).slice(0, 3).map(Number);
    assert.ok(rgb.every((value) => value > 200), `${surface.name} must use the light surface: ${surface.color}`);
  }
  await page.screenshot({ path: path.join(out, "toggle-phone.png"), fullPage: false });
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  console.log("PASS desktop toggle, reload persistence, cross-tab sync, mobile More toggle");
  const routes = process.argv.includes("--toggle-only") ? [] : process.argv.includes("--all") ? livingSurfaceRoutes(LIVING_SURFACES).map((x) => x.route) : ["/projections/weekly", "/hub/home", "/hub/roster", "/hub/game", "/tools/dfs"];
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const route of routes) {
      await page.evaluate((route) => { history.pushState({}, "", route); dispatchEvent(new PopStateEvent("popstate")); }, route);
      await page.locator(".app-header, .standalone-page, .auth-session").first().waitFor({ timeout: 45000 });
      await page.waitForTimeout(2000);
      await page.waitForFunction(() => !document.querySelector("[aria-busy='true'], .hub-loading-skeleton, .hub-insights-skeleton, .table-skeleton-row"), null, { timeout: 20000 }).catch(() => {});
      const results = await page.evaluate(measureScript(), { minTarget: width === 390 ? 44 : 32, numericRe: NUMERIC_RE.source, barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX, columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS });
      const slug = route.replaceAll("/", "-").slice(1);
      await page.screenshot({ path: path.join(out, `${slug}-${width}.png`), fullPage: false });
      await page.evaluate(() => window.scoreSenseTheme.set("dark"));
      const darkResults = await page.evaluate(measureScript(), { minTarget: width === 390 ? 44 : 32, numericRe: NUMERIC_RE.source, barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX, columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS });
      await page.evaluate(() => window.scoreSenseTheme.set("light"));
      report.push({ route, width, url: page.url(), results, darkResults });
      console.log(route, width, results.filter((r) => !r.ok).map((r) => r.rule + ": " + r.detail).join("; ") || "PASS");
    }
  }
  assert.deepEqual(errors, [], "Browser runtime errors");
} finally {
  await fs.writeFile(path.join(out, process.argv.includes("--all") ? "layout-all-report.json" : process.argv.includes("--toggle-only") ? "toggle-report.json" : "layout-report.json"), "[\n" + report.map((row) => JSON.stringify(row)).join(",\n") + "\n]\n");
  await browser.close();
}
