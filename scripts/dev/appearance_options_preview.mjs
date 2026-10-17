// Browser layout audit and screenshot generator for appearance-options A / B / C.
import { chromium } from "../../frontend/node_modules/playwright/index.mjs";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  measureScript,
  NUMERIC_RE,
  BAR_CONTROL_SELECTOR,
  TABLE_DEAD_ZONE_PX,
  COLUMN_PACK_RATIO,
  GUTTER_EDGE_SELECTORS,
} from "./layout_audit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mockDir = path.join(root, "docs/mockups");
const outDir = path.join(root, "docs/mockups/appearance-options-review");
await fs.mkdir(outDir, { recursive: true });

const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (req, res) => {
  const clean = req.url.split("?")[0].replace(/^\/+/, "") || "index.html";
  const file = path.join(mockDir, clean);
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

try {
  for (const opt of ["a", "b", "c"]) {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto(`http://127.0.0.1:${port}/appearance-options-${opt}.html`);
      await page.locator("#scene-stage [data-buddy]").first().waitFor();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      const results = await page.evaluate(measureScript(), {
        minTarget: width === 390 ? 44 : 32,
        numericRe: NUMERIC_RE.source,
        barControlSelector: BAR_CONTROL_SELECTOR,
        tableDeadZonePx: TABLE_DEAD_ZONE_PX,
        columnPackRatio: COLUMN_PACK_RATIO,
        gutterSelectors: GUTTER_EDGE_SELECTORS,
      });
      const failed = results.filter((r) => !r.ok);
      console.log(
        `Option ${opt.toUpperCase()} @ ${width}px: overflow=${overflow}, failed=${failed.length}`,
        failed.map((f) => `${f.rule}: ${f.detail} (${f.selector})`)
      );
      assert.equal(overflow, false, `Option ${opt} @ ${width} horizontal overflow`);
      assert.deepEqual(failed, [], `Option ${opt} @ ${width} layout audit`);
      await page.screenshot({ path: path.join(outDir, `${opt}-${width}.png`), fullPage: true });
    }
  }
  assert.deepEqual(errors, [], "Browser errors");
  console.log("ALL MOCKUP AUDITS PASSED.");
} finally {
  await browser.close();
  server.close();
}
