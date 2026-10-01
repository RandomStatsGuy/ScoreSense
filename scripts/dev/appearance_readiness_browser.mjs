// Exercise initial loading with the production bundle and held responses.
// Uses the existing local server; never writes real account or league data.
import { chromium } from "../../frontend/node_modules/playwright/index.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dist = path.join(root, "frontend/dist");
const out = path.join(root, "docs/mockups/appearance-loading-review");
const origin = "http://127.0.0.1:5173";
const prefs = { atmosphere: "cozy", atmosphere_enabled: true, atmosphere_motion: true, atmosphere_pile: true, atmosphere_wash: true, atmosphere_intensity: "standard" };
const browser = await chromium.launch({ headless: true });
const report = [];
await fs.mkdir(out, { recursive: true });
const cases = [
  { name: "lazy-account", route: "/account", hold: (url) => /\/assets\/AccountSettingsPage-.*\.js$/.test(url.pathname), loading: ".hub-loading-skeleton:visible" },
  { name: "preferences", route: "/account", hold: (url) => url.pathname === "/api/hub/prefs", loading: ".appearance-save-status:visible" },
  { name: "lazy-fantasy", route: "/hub/home", hold: (url) => /\/assets\/DraftHub-.*\.js$/.test(url.pathname), loading: "#main-content .chart-note:visible" },
  { name: "fantasy-data", route: "/hub/home", hold: (url) => url.pathname === "/api/hub/workspace", loading: ".table-skeleton:visible" },
  { name: "hidden-content", route: "/account", hold: (url) => url.pathname === "/api/hub/prefs", loading: ".appearance-save-status:visible", visibilityFixture: true },
  { name: "weekly-metadata", route: "/projections/weekly", hold: (url) => url.pathname === "/api/meta/projections/qb", loading: "#main-content[data-appearance-loading='true']:visible" },
  { name: "weekly-data", route: "/projections/weekly", hold: (url) => /^\/api\/predict\/qb$/.test(url.pathname), loading: ".table-skeleton-row:visible, .mobile-data-list[aria-busy='true']", loadingState: "attached", json: { projections: [], meta: {} } },
  { name: "empty-best-ball", route: "/tools/best-ball", hold: (url) => url.pathname === "/api/bestball/board", loading: ".hub-loading-skeleton:visible", json: { players: [], meta: null } },
  { name: "error-best-ball", route: "/tools/best-ball", hold: (url) => url.pathname === "/api/bestball/board", loading: ".hub-loading-skeleton:visible", status: 503, json: { detail: "Board unavailable for this loading check." } },
  { name: "route-transition", initialRoute: "/account", route: "/tools/best-ball", hold: (url) => url.pathname === "/api/bestball/board", loading: ".hub-loading-skeleton:visible", json: { players: [], meta: null } },
];

async function diagnostics(page) {
  return page.evaluate(() => ({
    content: document.querySelector("#main-content, .standalone-page")?.outerHTML.slice(0, 200),
    placeholders: [...document.querySelectorAll(".hub-loading-skeleton, .table-skeleton, .table-skeleton-row, .mobile-data-list--loading, .ui-skeleton, p.chart-note, p.hub-page-meta, .team-room-loading p")].filter(el => el.getClientRects().length && !el.closest("[hidden], .app-view-pane-hidden")).slice(0, 8).map(el => ({ classes: el.className, text: el.textContent.slice(0, 70), closed: Boolean(el.closest("details:not([open])")) })),
  }));
}

try {
  for (const width of [1280, 390]) for (const test of cases) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, serviceWorkers: "block" });
    await context.addInitScript((prefs) => localStorage.setItem("scoresense-appearance", JSON.stringify(prefs)), prefs);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let held = false;
    const errors = [];
    await context.route(`${origin}/**`, async route => {
      const url = new URL(route.request().url());
      const selected = test.hold(url);
      if (selected) { held = true; await gate; }
      if (url.pathname === "/api/auth/me") return route.fulfill({ json: { authenticated: true, user: { id: "appearance-loading-review", auth_type: "native", name: "Theme review", email: "themes@example.test", has_password: true, email_verified: true, terms_version: "2026-09" } } });
      if (url.pathname === "/api/hub/prefs") return route.fulfill({ json: { prefs } });
      if (selected && test.json) return route.fulfill({ status: test.status || 200, json: test.json });
      if (/^\/api\/predict\/qb(?:\/changes)?$/.test(url.pathname)) return route.fulfill({ json: { projections: [], meta: {}, changes: [] } });
      if (url.pathname.startsWith("/api/")) {
        assert.equal(route.request().method(), "GET", "This check never writes real data");
        return route.continue();
      }
      const target = path.resolve(dist, decodeURIComponent(url.pathname).replace(/^\/+/, ""));
      if (!target.startsWith(dist + path.sep) && target !== dist) return route.abort();
      const file = route.request().isNavigationRequest() ? path.join(dist, "index.html") : target;
      const types = { ".js": "application/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml" };
      try { return route.fulfill({ body: await fs.readFile(file), contentType: types[path.extname(file)] || "application/octet-stream" }); }
      catch { return route.abort(); }
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto(origin + (test.initialRoute || test.route), { waitUntil: "domcontentloaded" });
      if (test.initialRoute) {
        await page.locator(".app-atmosphere-floor").waitFor({ state: "visible" });
        await page.evaluate(route => { history.pushState({}, "", route); dispatchEvent(new PopStateEvent("popstate")); }, test.route);
      }
      await page.locator(test.loading).first().waitFor({ state: test.loadingState || "visible" });
      await page.waitForTimeout(450);
      assert.equal(held, true, `${test.name} held its initial request`);
      assert.equal(await page.locator(".app-atmosphere-floor").count(), 0, `${test.name}: no ground scene during loading`);
      assert.ok(await page.locator(".app-atmosphere .hub-atmosphere-particle").count() > 0, "Subtle falling field can continue during loading");
      if (["fantasy-data", "weekly-data"].includes(test.name)) await page.screenshot({ path: path.join(out, `${test.name}-loading-${width}.webp`), type: "webp" });
      release();
      await page.locator(".app-atmosphere-floor").waitFor({ state: "visible", timeout: 30000 });
      assert.equal(await page.locator(".app-atmosphere-floor .hub-atmosphere-cat").count(), 2);
      if (test.visibilityFixture) {
        // Exercise visibility in a real DOM: a hidden cached placeholder and a
        // closed disclosure are different from a visible, active page loader.
        await page.evaluate(() => {
          const fixture = document.createElement("section");
          fixture.id = "appearance-loading-fixture";
          fixture.innerHTML = '<div id="cached-loader" class="app-view-pane-hidden" hidden><div class="hub-loading-skeleton" style="height:64px">Loading</div></div><details id="deferred-loader"><summary>Deferred content</summary><div class="hub-loading-skeleton" style="height:64px">Loading</div></details>';
          document.querySelector(".standalone-page").append(fixture);
        });
        await page.waitForTimeout(100);
        assert.equal(await page.locator(".app-atmosphere-floor").count(), 1, "Hidden and closed loaders do not block a finished page");
        await page.evaluate(() => { const el = document.getElementById("cached-loader"); el.hidden = false; el.className = ""; });
        await page.locator(".app-atmosphere-floor").waitFor({ state: "detached" });
        await page.evaluate(() => { document.getElementById("cached-loader").hidden = true; });
        await page.locator(".app-atmosphere-floor").waitFor({ state: "visible" });
        await page.evaluate(() => { document.getElementById("deferred-loader").open = true; });
        await page.locator(".app-atmosphere-floor").waitFor({ state: "detached" });
        await page.evaluate(() => document.getElementById("appearance-loading-fixture").remove());
        await page.locator(".app-atmosphere-floor").waitFor({ state: "visible" });
      }
      const geometry = await page.locator(".app-atmosphere-floor").evaluate(el => ({ floor: el.getBoundingClientRect().top, content: document.querySelector(".app, .standalone-page").getBoundingClientRect().bottom }));
      assert.ok(geometry.floor >= geometry.content - 1, "Ground scene follows the finished page");
      if (test.status) assert.ok((await page.locator("body").innerText()).includes(test.json.detail), "Error content has finished rendering");
      if (["fantasy-data", "weekly-data"].includes(test.name)) {
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        await page.screenshot({ path: path.join(out, `${test.name}-ready-${width}.webp`), type: "webp" });
      }
      // Route transitions must hide the previous floor before a new lazy page.
      // Empty and failed responses are complete pages, rather than loaders.
      assert.deepEqual(errors, [], "Browser runtime errors");
      report.push({ name: test.name, route: test.route, width, ok: true });
      console.log(`PASS ${test.name} @ ${width}: held while loading, placed after ready content`);
    } catch (error) {
      console.error(test.name, width, JSON.stringify(await diagnostics(page), null, 2));
      await page.screenshot({ path: path.join(out, "failure.webp"), type: "webp" });
      throw error;
    } finally {
      release();
      await context.close();
    }
  }
} finally {
  await fs.writeFile(path.join(out, "report.json"), JSON.stringify({ checks: report }, null, 2) + "\n");
  await browser.close();
}
