// Isolated production Admin components: synthetic credentials, no external writes.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { measureScript, minTargetForWidth, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX,
  COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { build } = require("esbuild");
const { chromium } = require("playwright");
const output = path.join(root, "outputs/admin-connections");
await fs.mkdir(output, { recursive: true });
await build({ absWorkingDir: root, entryPoints: ["frontend/test-fixtures/admin-connections.jsx"], bundle: true,
  format: "esm", outfile: path.join(output, "fixture.js"), resolveExtensions: [".js", ".jsx", ".json"],
  loader: { ".js": "jsx", ".png": "dataurl", ".svg": "dataurl", ".woff2": "dataurl", ".webp": "dataurl" },
  external: ["/art/*", "/fonts/*", "/assets/*"], logLevel: "error",
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env": JSON.stringify({ DEV: false, PROD: true, BASE_URL: "/" }) } });
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/fixture.js" || pathname === "/fixture.css") {
    res.writeHead(200, { "Content-Type": pathname.endsWith("js") ? "text/javascript" : "text/css" });
    res.end(await fs.readFile(path.join(output, pathname.slice(1))));
  } else if (pathname === "/admin/connections") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>.admin-connections-fixture{padding:var(--space-4)}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  } else { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const reports = [];
try {
  browser = await chromium.launch({ headless: true, channel: process.platform === "win32" ? "msedge" : undefined });
  for (const width of [1280, 390]) for (const theme of ["dark", "light"]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
    const report = { width, theme, status: "failed", errors: [] };
    page.on("pageerror", error => report.errors.push(error.message));
    await page.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    try {
      await page.goto(`${base}/admin/connections?theme=${theme}`);
      const email = page.getByRole("textbox", { name: "Account email", exact: true });
      const token = page.getByLabel("API token", { exact: true });
      const save = page.getByRole("button", { name: "Save connection", exact: true });
      await email.waitFor();
      assert.equal(await save.isDisabled(), true);
      assert.equal(await token.getAttribute("type"), "password");
      await email.fill("jira@example.test"); await token.fill("synthetic-api-token");
      assert.equal(await page.getByRole("button", { name: "Check connection", exact: true }).isDisabled(), true);
      await page.getByRole("navigation", { name: "Admin sections" }).getByRole("button", { name: "Server", exact: true }).click();
      const leave = page.getByRole("alertdialog", { name: "Unsaved connection keys" });
      await leave.getByRole("button", { name: "Keep editing", exact: true }).click();
      assert.equal(await token.inputValue(), "synthetic-api-token", "cancelled navigation preserves keys");
      await page.evaluate(() => { window.fixtureState = "save-error"; });
      await save.click();
      await page.getByRole("alert").filter({ hasText: "Could not save the connection." }).waitFor();
      assert.equal(await token.inputValue(), "synthetic-api-token", "failed saves preserve entries");
      await page.evaluate(() => { window.fixtureState = "ready"; });
      await save.click();
      await page.getByRole("status").filter({ hasText: "Connection saved." }).waitFor();
      assert.equal(await token.inputValue(), "", "successful saves clear the typed token");
      assert.equal(await email.inputValue(), "jira@example.test");
      await page.getByRole("button", { name: "Check connection", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Jira connection checked." }).waitFor();
      assert.equal(await page.getByText(/synthetic-api-token/).count(), 0, "tokens never become visible text");
      await email.fill("updated@example.test");
      await save.click();
      await page.getByRole("status").filter({ hasText: "Connection saved." }).waitFor();
      const last = await page.evaluate(() => window.fixtureWrites.at(-1));
      assert.equal(last.body.values.api_token, undefined, "blank token is not replaced");
      report.layout = await page.evaluate(measureScript(), { minTarget: minTargetForWidth(width), numericRe: NUMERIC_RE.source,
        barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZone: TABLE_DEAD_ZONE_PX, columnPackRatio: COLUMN_PACK_RATIO,
        gutterEdgeSelectors: GUTTER_EDGE_SELECTORS });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(report.errors, []);
      report.status = report.layout.every(row => row.ok) ? "passed" : "layout_failed";
    } catch (error) { report.error = error.message; }
    report.screenshot = path.join(output, `connections-${width}-${theme}.png`);
    await page.screenshot({ path: report.screenshot, fullPage: true });
    await page.close(); reports.push(report);
    console.log(`${width} ${theme}: ${report.status}${report.error ? ` (${report.error})` : ""}`);
    await fs.writeFile(path.join(output, "report.json"), JSON.stringify(reports, null, 2));
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
if (reports.some(row => row.status !== "passed")) process.exitCode = 1;
