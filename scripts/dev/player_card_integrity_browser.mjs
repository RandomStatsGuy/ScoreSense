import { createRequire } from "node:module";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import assert from "node:assert/strict";
import { measureScript, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";

const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright");
let base = process.env.PLAYER_CARD_TEST_BASE;
const output = "outputs/agent/player-card-integrity";
await mkdir(output, { recursive: true });
let server;
if (!base) {
  const { build } = require("esbuild");
  const bundle = path.resolve(output, "bundle");
  await build({ entryPoints: ["frontend/test-fixtures/player-card-integrity.jsx"], bundle: true, format: "esm", jsx: "automatic", outdir: bundle,
    resolveExtensions: [".js", ".jsx", ".mjs", ".json"], external: ["/art/*", "/fonts/*", "/assets/*"],
    loader: { ".js": "jsx", ".svg": "dataurl", ".png": "dataurl", ".webp": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": JSON.stringify({ DEV: false, PROD: true, MODE: "test", BASE_URL: "/" }) } });
  const publicRoot = path.resolve("frontend/public");
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    try {
      if (pathname === "/test-fixtures/player-card-integrity.html") {
        let html = await readFile("frontend/test-fixtures/player-card-integrity.html", "utf8");
        html = html.replace('src="./player-card-integrity.jsx"', 'src="/__bundle/player-card-integrity.js"').replace("</head>", '<link rel="stylesheet" href="/__bundle/player-card-integrity.css"></head>');
        response.writeHead(200, { "Content-Type": "text/html" }); response.end(html); return;
      }
      if (["/__bundle/player-card-integrity.js", "/__bundle/player-card-integrity.css"].includes(pathname)) {
        response.writeHead(200, { "Content-Type": pathname.endsWith(".js") ? "text/javascript" : "text/css" });
        response.end(await readFile(path.join(bundle, path.basename(pathname)))); return;
      }
      const file = path.resolve(publicRoot, "." + pathname);
      if (file.startsWith(publicRoot + path.sep) && /\.(woff2?|ttf|svg|png|webp)$/.test(file)) {
        const real = await realpath(file);
        if (!real.startsWith(publicRoot + path.sep)) throw new Error("Asset escapes public directory");
        response.writeHead(200); response.end(await readFile(real)); return;
      }
    } catch { /* Only fixture files and public assets can be served. */ }
    response.writeHead(404); response.end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}
const channel = process.env.PLAYWRIGHT_CHANNEL || (process.platform === "win32" ? "msedge" : "chromium");
const browser = await chromium.launch({ headless: true, args: ["--no-proxy-server"], ...(channel === "chromium" ? {} : { channel }) });
const reports = [];
try {
  for (const width of [1280, 390]) for (const state of ["recovery", "failed", "unsupported", "race", "period-race", "closing", "provider-context", "scope-context", "zero", "partial", "unavailable", "unresolved", "stale", "network-failure"]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
    page.setDefaultTimeout(12_000);
    const errors = [], escaped = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== base || url.pathname.startsWith("/api/")) { escaped.push(url.pathname); return route.abort(); }
      return route.continue();
    });
    const report = { width, state, context: "synthetic contract fixture / production provider and inspector", passed: false, errors, escaped, layout: [] };
    try {
      await page.goto(`${base}/test-fixtures/player-card-integrity.html?state=${state}&theme=${state === "partial" ? "light" : "dark"}`, { waitUntil: "domcontentloaded" });
      const opener = page.getByRole("button", { name: "Open George Pickens", exact: true });
      await opener.click();
      await page.getByRole("dialog", { name: "George Pickens", exact: true }).waitFor();
      if (["race", "period-race"].includes(state)) {
        await page.waitForFunction(() => window.__cardIntegrity.calls.length === 1);
        if (state === "race") {
          await page.locator("#player-inspector-search").fill("Second");
          await page.getByRole("button", { name: "Second Player", exact: true }).click();
          await page.getByRole("dialog", { name: "Second Player", exact: true }).waitFor();
        } else {
          await page.evaluate(() => window.__cardIntegrity.open({ playerId: "8137", name: "George Pickens", position: "wr", season: 2025, week: 3 }));
          await page.waitForFunction(() => document.querySelector(".player-profile-eyebrow")?.textContent === "Week 3 projection");
        }
        await page.waitForTimeout(1100);
        if (state === "race") {
          assert.equal(await page.getByRole("dialog").getAttribute("aria-label"), "Second Player");
          assert.equal(await page.locator(".player-profile-number").innerText(), "12.3");
        } else {
          assert.equal(await page.locator(".player-profile-eyebrow").innerText(), "Week 3 projection");
          assert.match(await page.locator(".player-profile-section-head").innerText(), /2025/);
        }
      } else {
        await page.locator(".player-profile-log").waitFor();
        if (state === "recovery") {
          await page.getByRole("status").filter({ hasText: "Updating projections…" }).waitFor();
          await page.waitForFunction(() => document.querySelector(".player-profile-number")?.textContent === "8.5");
          const calls = await page.evaluate(() => window.__cardIntegrity.calls);
          assert.equal(calls.length, 3);
          assert.equal(calls[0].params.season, undefined);
          for (const call of calls.slice(1)) { assert.equal(call.params.season, "2026"); assert.equal(call.params.week, "7"); }
          assert.equal(await page.getByRole("status").count(), 0);
        }
        if (state === "failed") {
          await page.getByRole("status").filter({ hasText: "Projection update failed." }).waitFor();
          await page.waitForTimeout(1200);
          assert.equal(await page.evaluate(() => window.__cardIntegrity.calls.length), 2);
        }
        if (state === "unsupported") {
          await page.getByRole("status").filter({ hasText: "Projections are unavailable for this position." }).waitFor();
          await page.waitForTimeout(1200);
          assert.equal(await page.evaluate(() => window.__cardIntegrity.calls.length), 1);
          await page.getByText("Recorded games are unavailable for this position.", { exact: true }).waitFor();
        }
        if (["provider-context", "scope-context"].includes(state)) {
          const calls = await page.evaluate(() => window.__cardIntegrity.calls);
          assert.equal(calls[0].params.season, state === "scope-context" ? "2024" : "2025"); assert.equal(calls[0].params.week, state === "scope-context" ? "9" : "18");
          await page.evaluate(() => window.__cardIntegrity.open({ playerId: "8137", name: "George Pickens", season: 2024, week: 6, position: "wr" }));
          await page.waitForFunction(() => document.querySelector(".player-profile-eyebrow")?.textContent === "Week 6 projection");
          const final = await page.evaluate(() => window.__cardIntegrity.calls.at(-1));
          assert.equal(final.params.season, "2024"); assert.equal(final.params.week, "6");
        }
        if (state === "network-failure") {
          await page.getByRole("alert").waitFor();
          assert.equal(await page.locator(".player-profile-number").innerText(), "8.5");
          assert.equal(await page.locator(".player-profile-table tbody tr").count(), 1);
          await page.waitForTimeout(1200);
          assert.equal(await page.evaluate(() => window.__cardIntegrity.calls.length), 2);
        }
        if (state === "zero") {
          assert.equal(await page.locator(".player-profile-number").innerText(), "0.0");
          await page.getByRole("tab", { name: "Season so far", exact: true }).click();
          assert.equal(await page.locator(".player-profile-number").innerText(), "0.0");
          assert.equal(await page.locator(".player-profile-table tbody tr td").last().innerText(), "0.0");
        }
        if (state === "partial") {
          await page.getByText("Some recorded games are unavailable.", { exact: true }).waitFor();
          await page.getByRole("tab", { name: "Season so far", exact: true }).click();
          assert.equal(await page.locator(".player-profile-number").innerText(), "—");
        }
        if (state === "unavailable") {
          await page.getByText("Recorded games are unavailable.", { exact: true }).waitFor();
          assert.equal(await page.getByText("No recorded games available yet.", { exact: true }).count(), 0);
        }
        if (state === "unresolved") await page.getByRole("status").filter({ hasText: "Player identity could not be matched." }).waitFor();
        if (state === "stale") {
          assert.equal(await page.getByRole("status").count(), 0);
          await page.getByRole("tab", { name: "Rest of season", exact: true }).click();
          await page.getByRole("status").filter({ hasText: "Projection is stale." }).waitFor();
        }
      }
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      report.layout = await page.evaluate(measureScript(), { minTarget: width <= 768 ? 44 : 32, numericRe: NUMERIC_RE.source, barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX, columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS });
      report.screenshot = `${output}/${state}-${width}.png`;
      await page.screenshot({ path: report.screenshot, fullPage: true });
      assert.deepEqual(report.layout.filter(row => !row.ok), []);
      await page.getByRole("button", { name: "Close player details", exact: true }).click();
      assert.equal(await page.getByRole("dialog").count(), 0);
      assert.equal(await opener.evaluate(element => document.activeElement === element), true);
      const callCount = await page.evaluate(() => window.__cardIntegrity.calls.length);
      await page.waitForTimeout(state === "closing" ? 1200 : 100);
      assert.equal(await page.evaluate(() => window.__cardIntegrity.calls.length), callCount);
      assert.deepEqual(errors, []); assert.deepEqual(escaped, []);
      report.passed = true;
    } catch (error) { report.failure = error.message; process.exitCode = 1; }
    reports.push(report);
    console.log(JSON.stringify({ width, state, passed: report.passed, failure: report.failure }));
    await writeFile(`${output}/report.json`, JSON.stringify(reports, null, 2));
    await page.close();
  }
} finally { await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); }
