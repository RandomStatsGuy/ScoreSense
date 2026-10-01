// Verify the production build with the existing local API. Preferences are
// intercepted so reviewing themes never changes the developer's account.
// npm --prefix frontend run build && node scripts/dev/appearance_browser.mjs --all
import { chromium } from "../../frontend/node_modules/playwright/index.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { measureScript, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS, livingSurfaceRoutes } from "./layout_audit.mjs";
import { LIVING_SURFACES } from "../../frontend/src/livingSurfaces.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dist = path.join(root, "frontend/dist");
const out = path.join(root, "docs/mockups/appearance-review");
const origin = "http://127.0.0.1:5173";
const defaults = { atmosphere: "none", atmosphere_enabled: true, atmosphere_motion: true, atmosphere_pile: true, atmosphere_wash: true, atmosphere_intensity: "standard" };
let prefs = { ...defaults };
let gets = 0;
let failPatch = false;
let failLoad = false;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
await fs.mkdir(out, { recursive: true });
await context.route(`${origin}/**`, async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === "/api/auth/me") return route.fulfill({ json: {
    authenticated: true, user: { id: "appearance-review", auth_type: "native", name: "Theme review", email: "themes@example.test", has_password: true, email_verified: true, terms_version: "2026-09" },
  } });
  if (url.pathname === "/api/hub/prefs") {
    let loadedPrefs;
    if (route.request().method() === "PATCH") {
      if (failPatch) { failPatch = false; return route.fulfill({ status: 503, json: { detail: "Could not save appearance. Please try again." } }); }
      prefs = { ...prefs, ...route.request().postDataJSON() };
    } else {
      gets++;
      if (failLoad) return route.fulfill({ status: 503, json: { detail: "Could not load appearance." } });
      loadedPrefs = { ...prefs };
      // Give the loading state a real interval to protect saved preferences.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return route.fulfill({ json: { prefs: loadedPrefs || prefs } });
  }
  if (url.pathname.startsWith("/api/")) return route.continue();
  const target = path.resolve(dist, decodeURIComponent(url.pathname).replace(/^\/+/, ""));
  if (!target.startsWith(dist + path.sep) && target !== dist) return route.abort();
  const file = route.request().isNavigationRequest() ? path.join(dist, "index.html") : target;
  const types = { ".js": "application/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };
  try { await route.fulfill({ body: await fs.readFile(file), contentType: types[path.extname(file)] || "application/octet-stream" }); }
  catch { await route.abort(); }
});
const report = [];
const errors = [];
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
const themeRadio = (id) => page.locator(`#appearance input[name="appearance-theme"][value="${id}"]`);
const modeRadio = (id) => page.locator(`#appearance input[name="appearance-mode"][value="${id}"]`);
async function selectTheme(id) {
  await themeRadio(id).check();
  await page.waitForFunction((id) => document.documentElement.dataset.experienceTheme === id, id);
  await themeRadio(id).waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector('#appearance input[name="appearance-theme"]:disabled'));
}
async function navigate(route) {
  await page.evaluate((route) => { history.pushState({}, "", route); dispatchEvent(new PopStateEvent("popstate")); }, route);
  await page.locator(".app-header:visible, .standalone-page:visible, .auth-session:visible").first().waitFor();
  await page.waitForTimeout(650);
  await page.waitForFunction(() => !document.querySelector(".hub-loading-skeleton, .hub-insights-skeleton, .table-skeleton-row"), null, { timeout: 15000 }).catch(() => {});
}
async function measure(route, width, theme, mode) {
  const results = await page.evaluate(measureScript(), { minTarget: width === 390 ? 44 : 32, numericRe: NUMERIC_RE.source, barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX, columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS });
  const failures = results.filter((result) => !result.ok && ["type", "selects", "collisions", "grids"].includes(result.rule));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  report.push({ route, actualPath: new URL(page.url()).pathname, width, theme, mode, ok: failures.length === 0 && !overflow, failures, overflow });
  assert.equal(overflow, false, `${route} ${width} ${theme} horizontal overflow`);
  assert.deepEqual(failures, [], `${route} ${width} ${theme} ${mode} layout gate`);
}
async function contrast() {
  const colors = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const probe = document.createElement("span");
    document.body.appendChild(probe);
    const resolved = (name) => { probe.style.color = style.getPropertyValue(name); return getComputedStyle(probe).color; };
    const result = ["--text-primary", "--text-muted", "--bg-elevated", "--accent", "--appearance-action-ink"].map(resolved);
    probe.remove();
    return result;
  });
  const luminance = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number).map((value) => {
    const s = value / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
  }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
  const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  for (const [a, b] of [[0, 2], [1, 2], [3, 2], [3, 4]]) assert.ok(ratio(colors[a], colors[b]) >= 4.5, `Contrast ${colors[a]} on ${colors[b]}`);
}
try {
  await page.goto(`${origin}/account#appearance`);
  await themeRadio("none").waitFor();
  await page.waitForFunction(() => !document.querySelector('#appearance input[name="appearance-theme"]:disabled'));
  await modeRadio("system").check();
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await modeRadio("light").check();
  await page.emulateMedia({ colorScheme: "dark" });
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  await selectTheme("cozy");
  assert.equal(await page.locator(".app-atmosphere-floor .hub-atmosphere-cat").count(), 2);
  assert.ok(await page.locator(".hub-atmosphere-particle").count() > 0);
  await page.getByRole("checkbox", { name: /^Motion/ }).uncheck();
  await page.waitForFunction(() => !document.querySelector('#appearance input:disabled'));
  assert.equal(await page.locator(".hub-atmosphere-particle").count(), 0);
  assert.equal(await page.locator(".hub-atmosphere").evaluateAll((els) => els.flatMap((el) => el.getAnimations({ subtree: true })).length), 0);
  await page.getByRole("checkbox", { name: /^Atmosphere/ }).uncheck();
  await page.waitForFunction(() => !document.querySelector('#appearance input:disabled'));
  assert.equal(await page.locator(".hub-atmosphere").count(), 0);
  assert.equal(await page.locator("html").getAttribute("data-experience-theme"), "cozy");
  await page.getByRole("checkbox", { name: /^Atmosphere/ }).check();
  await page.waitForFunction(() => !document.querySelector('#appearance input:disabled'));
  await page.getByRole("checkbox", { name: /^Motion/ }).check();
  await page.waitForFunction(() => !document.querySelector('#appearance input:disabled'));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => !document.querySelector(".hub-atmosphere-particle"));
  assert.equal(await page.locator(".hub-atmosphere-particle").count(), 0);
  assert.equal(await page.locator(".hub-atmosphere").evaluateAll((els) => els.flatMap((el) => el.getAnimations({ subtree: true })).length), 0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForFunction(() => Boolean(document.querySelector(".hub-atmosphere-particle")));
  failPatch = true;
  await themeRadio("snow").click();
  await page.getByRole("alert").filter({ hasText: "Could not save appearance" }).waitFor();
  assert.equal(await page.locator("html").getAttribute("data-experience-theme"), "cozy");
  assert.equal(await themeRadio("cozy").isChecked(), true);
  await themeRadio("cozy").focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => document.documentElement.dataset.experienceTheme === "snow");
  await page.waitForFunction(() => !document.querySelector('#appearance input:disabled'));
  const other = await context.newPage();
  await other.goto(`${origin}/projections/weekly`);
  await other.waitForFunction(() => document.documentElement.dataset.experienceTheme === "snow");
  await selectTheme("leaves");
  await other.waitForFunction(() => document.documentElement.dataset.experienceTheme === "leaves");
  await other.close();
  await page.reload();
  await themeRadio("leaves").waitFor();
  assert.equal(await themeRadio("leaves").isChecked(), true);
  failLoad = true;
  await page.reload();
  await page.getByRole("alert").filter({ hasText: "Could not load appearance" }).waitFor();
  assert.equal(await themeRadio("none").isDisabled(), true);
  failLoad = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await page.waitForFunction(() => !document.querySelector('#appearance input:disabled'));
  const getCount = gets;
  for (const route of ["/projections/weekly", "/hub/home", "/hub/cap", "/hub/roster", "/hub/rules", "/tools/dfs", "/hub/draft", "/tools/mock-draft"]) {
    await navigate(route);
    assert.equal(await page.locator("html").getAttribute("data-experience-theme"), "leaves");
    if (route === "/hub/draft" || route === "/tools/mock-draft") assert.equal(await page.locator(".app-atmosphere, .app-atmosphere-floor").count(), 0);
  }
  assert.equal(gets, getCount, "Navigating destinations must not refetch appearance");
  console.log("PASS System, explicit mode, native radio keyboard, persistence, cross-tab sync, independent effects, reduced motion, rollback, load/retry, shared state, clear drafts");
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await navigate("/account#appearance");
    for (const theme of ["cozy", "snow", "leaves", "footballs"]) {
      await selectTheme(theme);
      for (const mode of ["light", "dark"]) {
        await modeRadio(mode).check();
        await contrast();
        await measure("/account", width, theme, mode);
      }
      if (theme === "cozy") {
        await page.locator("#appearance").evaluate((el) => el.scrollIntoView({ block: "start" }));
        await page.screenshot({ path: path.join(out, `account-${width}.webp`), type: "webp", fullPage: false });
      }
    }
    for (const theme of ["cozy", "snow", "leaves"]) {
      await selectTheme(theme);
      await modeRadio(width === 390 ? "light" : "dark").check();
      await navigate("/hub/home");
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      if (theme === "cozy" && width === 1280) {
        const cat = page.locator(".app-atmosphere-floor .hub-atmosphere-cat--left");
        const box = await cat.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForFunction(() => document.querySelector(".app-atmosphere-floor .hub-atmosphere-cat--left.is-alert"));
        await page.mouse.move(600, 0);
      }
      await page.screenshot({ path: path.join(out, `${theme}-${width}.webp`), type: "webp", fullPage: false });
      await navigate("/account#appearance");
    }
    await selectTheme("snow");
    const routes = process.argv.includes("--settings-only") ? [] : process.argv.includes("--all") ? livingSurfaceRoutes(LIVING_SURFACES).map((s) => s.route) : ["/projections/weekly", "/hub/home", "/hub/roster", "/hub/game", "/tools/dfs"];
    for (const route of routes) {
      await navigate(route);
      await page.evaluate(() => scrollTo(0, 0));
      for (const mode of ["light", "dark"]) {
        await page.evaluate((mode) => window.scoreSenseTheme.set(mode), mode);
        await measure(route, width, "snow", mode);
      }
      console.log(`PASS ${route} @ ${width}, light + dark`);
    }
  }
  assert.deepEqual(errors, [], "Browser runtime errors");
} catch (error) {
  await page.screenshot({ path: path.join(out, "failure.webp"), type: "webp" }).catch(() => {});
  console.error(await page.locator("body").innerText());
  throw error;
} finally {
  await fs.writeFile(path.join(out, process.argv.includes("--settings-only") ? "settings-report.json" : "report.json"), JSON.stringify({ browserErrors: errors, checks: report }, null, 2) + "\n");
  await browser.close();
}
