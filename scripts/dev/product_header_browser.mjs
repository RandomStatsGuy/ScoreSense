import assert from "node:assert/strict";
import fs from "node:fs";
import { measureScript, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "msedge" });
fs.mkdirSync("outputs", { recursive: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const base = "http://127.0.0.1:5173/test-fixtures/product-header.html";
  const cases = [
    ["projections", "weekly", "Weekly", "preseason"],
    ["projections", "season", "Season", "preseason"],
    ["projections", "season", "Season", "live"],
    ["tools", "dfs", "DFS"], ["tools", "mock-draft", "Mock draft"], ["tools", "best-ball", "Best ball"],
  ];
  const reports = [];
  for (const width of [1440, 1280, 1024, 390]) for (const [view, tab, title, mode = "preseason"] of cases) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${base}?view=${view}&tab=${tab}&mode=${mode}`);
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (width > 768) {
      const nav = page.getByRole("navigation", { name: view === "projections" ? "Projection type" : "Tools", exact: true });
      assert.equal(await nav.getByRole("link", { name: title, exact: true }).getAttribute("aria-current"), "page");
      assert.equal(await page.locator(".app-header-shell").evaluate(e => getComputedStyle(e).borderRadius), "0px");
      if (view === "projections") assert.equal(await nav.getByRole("link", { name: "Season", exact: true }).getAttribute("href"), `/projections/season/${mode}`);
      await page.getByRole("button", { name: /Kheylub/ }).click();
      const item = page.getByRole("menuitem").first();
      await item.waitFor();
      assert.ok(await item.evaluate(e => { const r = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }));
      await page.keyboard.press("Escape");
    } else {
      assert.equal(await page.locator(".app-header-row-primary").isVisible(), false);
      await page.getByRole("button", { name: /choose destination/i }).click();
      await page.getByRole("dialog").getByRole("button", { name: title, exact: true }).click();
      assert.equal(await page.getByRole("dialog").count(), 0);
    }
    if ([1280, 390].includes(width)) {
      const report = await page.evaluate(measureScript(), { minTarget: width === 390 ? 44 : 32, numericRe: NUMERIC_RE.source, barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX, columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS });
      const failures = report.filter(r => !r.ok);
      reports.push({ view, tab, mode, width, failures });
      await page.screenshot({ path: `outputs/header-${view}-${tab}-${mode}-${width}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(base);
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Tools", exact: true }).click();
  await page.getByRole("navigation", { name: "Tools", exact: true }).getByRole("link", { name: "Best ball", exact: true }).click();
  await page.getByRole("heading", { name: "Best ball", exact: true }).waitFor();
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Projections", exact: true }).click();
  await page.getByRole("navigation", { name: "Projection type" }).getByRole("link", { name: "Season", exact: true }).click();
  await page.getByRole("heading", { name: "Season", exact: true }).waitFor();
  await page.evaluate(() => window.__setAuth({ ready: true, authenticated: false }));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__signIn), true);
  fs.writeFileSync("outputs/product-header-audit.json", JSON.stringify(reports, null, 2));
  assert.deepEqual(errors, []);
  assert.ok(reports.every(r => !r.failures.length), JSON.stringify(reports));
  console.log(JSON.stringify({ interactions: "passed", audits: reports.length, failures: 0 }));
} finally { await browser.close(); }
