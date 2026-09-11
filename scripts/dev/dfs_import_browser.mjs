import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const { chromium } = await import(
  pathToFileURL(
    process.env.PLAYWRIGHT_MODULE ||
      path.resolve("frontend/node_modules/playwright/index.mjs"),
  ).href
);
import {
  measureScript,
  NUMERIC_RE,
  BAR_CONTROL_SELECTOR,
  TABLE_DEAD_ZONE_PX,
  COLUMN_PACK_RATIO,
  GUTTER_EDGE_SELECTORS,
} from "./layout_audit.mjs";
const root = path.resolve(".");
const dist = path.join(root, "frontend/dist");
const out = path.join(root, ".perf-check/dfs-import");
fs.mkdirSync(out, { recursive: true });
const server = http.createServer((req, res) => {
  const requested = path.join(dist, new URL(req.url, "http://local").pathname);
  const f =
    fs.existsSync(requested) && fs.statSync(requested).isFile()
      ? requested
      : path.join(dist, "index.html");
  res.setHeader(
    "Content-Type",
    {
      ".js": "application/javascript",
      ".css": "text/css",
      ".html": "text/html",
      ".svg": "image/svg+xml",
    }[path.extname(f)] || "application/octet-stream",
  );
  res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      serviceWorkers: "block",
    });
    const ledger = new Map();
    let batches = 0,
      failed = false;
    const errors = [];
    await context.route("**/*", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (url.origin !== base) return route.abort();
      if (!url.pathname.startsWith("/api/")) return route.continue();
      let result = {};
      const p = url.pathname;
      if (p === "/api/auth/config")
        result = { auth_required: false, hub_auth_required: false };
      else if (p === "/api/auth/me")
        result = {
          authenticated: true,
          user: {
            id: "local",
            display_name: "Local Test",
            email: "test@local.test",
            email_verified: true,
            terms_accepted: true,
          },
        };
      else if (p.includes("/meta/"))
        result = {
          default_season: 2026,
          default_week: 1,
          seasons: [2026],
          weeks: [1],
          season: 2026,
          week: 1,
        };
      else if (p === "/api/lineup/results")
        result = { entries: [...ledger.values()], builds: [] };
      else if (p === "/api/lineup/results/import") {
        assert.equal(url.searchParams.get("compact"), "true");
        const rows = req.postDataJSON().entries;
        assert.ok(rows.length <= 1000);
        batches++;
        if (batches === 2 && !failed) {
          failed = true;
          return route.fulfill({
            status: 503,
            json: { detail: "Simulated interrupted connection" },
          });
        }
        for (const row of rows)
          ledger.set(row.entry_id, { ...ledger.get(row.entry_id), ...row });
        result = { imported: rows.length };
      } else if (p.includes("refresh/status"))
        result = {
          status: "error",
          error: "Refresh stopped before finishing. Start it again.",
        };
      else if (p.includes("/predict/")) result = { projections: [], meta: {} };
      else if (p.includes("/slates")) result = { slates: [] };
      return route.fulfill({ json: result });
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/tools/dfs");
    await page.getByRole("button", { name: "Results", exact: true }).click();
    const baselineAudit = await page.evaluate(measureScript(), {
      minTarget: width === 390 ? 44 : 32,
      numericRe: NUMERIC_RE.source,
      barControlSelector: BAR_CONTROL_SELECTOR,
      tableDeadZonePx: TABLE_DEAD_ZONE_PX,
      columnPackRatio: COLUMN_PACK_RATIO,
      gutterSelectors: GUTTER_EDGE_SELECTORS,
    });
    const csv =
      "Entry ID,Contest ID,Points,Lineup\r\n" +
      Array.from(
        { length: 6001 },
        (_, i) =>
          `000${i},002,111.5,"CPT One, Two FLEX ${"Player ".repeat(125)}"`,
      ).join("\r\n");
    assert.ok(Buffer.byteLength(csv) > 5_000_000);
    await page
      .locator("input[type=file]")
      .nth(1)
      .setInputFiles({
        name: "large-results.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csv),
      });
    await page.getByRole("heading", { name: "Review your import" }).waitFor();
    await page
      .getByRole("button", { name: "Preview entries", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Save imported entries", exact: true })
      .waitFor();
    assert.equal(batches, 0, "Preview must not save");
    await page
      .getByRole("button", { name: "Save imported entries", exact: true })
      .click();
    await page
      .getByRole("alert")
      .filter({ hasText: "1,000 of 6,001 entries confirmed saved" })
      .waitFor();
    assert.equal(ledger.size, 1000);
    await page
      .getByRole("button", { name: "Save imported entries", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "6,001 entries saved." })
      .waitFor();
    await page
      .getByRole("heading", { name: "Review your import" })
      .waitFor({ state: "hidden" });
    assert.equal(ledger.size, 6001);
    assert.equal(await page.locator(".dfw-entry-list button").count(), 50);
    await page
      .getByRole("button", { name: "Next entries", exact: true })
      .click();
    await page.getByText("Page 2 of 121", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Previous entries", exact: true })
      .click();
    const audit = await page.evaluate(measureScript(), {
      minTarget: width === 390 ? 44 : 32,
      numericRe: NUMERIC_RE.source,
      barControlSelector: BAR_CONTROL_SELECTOR,
      tableDeadZonePx: TABLE_DEAD_ZONE_PX,
      columnPackRatio: COLUMN_PACK_RATIO,
      gutterSelectors: GUTTER_EDGE_SELECTORS,
    });
    fs.writeFileSync(
      path.join(out, `audit-${width}.json`),
      JSON.stringify({ baselineAudit, audit, errors }, null, 2),
    );
    await page.screenshot({
      path: path.join(out, `results-${width}.png`),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        width,
        bytes: Buffer.byteLength(csv),
        saved: ledger.size,
        batches,
        worker: "real Vite worker",
        pagination: "50 per page",
        errors,
      }),
    );
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
