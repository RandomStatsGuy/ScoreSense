import { chromium } from "playwright";
import fs from "node:fs/promises";
import {
  measureScript,
  minTargetForWidth,
  NUMERIC_RE,
  BAR_CONTROL_SELECTOR,
  TABLE_DEAD_ZONE_PX,
  COLUMN_PACK_RATIO,
  GUTTER_EDGE_SELECTORS,
} from "./layout_audit.mjs";
const browser = await chromium.launch({
  headless: true,
  channel: process.platform === "win32" ? "msedge" : undefined,
});
const base =
  process.env.DFS_PREVIEW_URL ||
  "http://127.0.0.1:5176/test-fixtures/dfs-workspace.html";
await fs.mkdir("outputs/dfs-gpp-review", { recursive: true });
const report = [];
for (const width of [1280, 390]) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("page error", e.message);
  });
  page.on("requestfailed", (r) =>
    console.log("request failed", r.url(), r.failure()),
  );
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
  await page.goto(base, { waitUntil: "commit" });
  await page
    .getByRole("button", { name: "Build lineups", exact: true })
    .last()
    .click();
  await page.getByText("Built 20 lineups.", { exact: true }).waitFor();
  for (const view of ["build", "results"]) {
    if (view === "results")
      await page.getByRole("button", { name: "Results", exact: true }).click();
    if (view === "results")
      await page.getByText("$710.00", { exact: true }).first().waitFor();
    const results = await page.evaluate(measureScript(), {
      minTarget: minTargetForWidth(width),
      numericRe: NUMERIC_RE.source,
      barControlSelector: BAR_CONTROL_SELECTOR,
      tableDeadZonePx: TABLE_DEAD_ZONE_PX,
      columnPackRatio: COLUMN_PACK_RATIO,
      gutterSelectors: GUTTER_EDGE_SELECTORS,
    });
    await page.screenshot({
      path: `outputs/dfs-gpp-review/implemented-${view}-${width}.png`,
      fullPage: true,
    });
    report.push({ width, view, results, errors });
    console.log(
      width,
      view,
      results.filter((r) => !r.ok),
      errors,
    );
  }
  await page.close();
}
await fs.writeFile(
  "outputs/dfs-gpp-review/implemented-audit.json",
  JSON.stringify(report, null, 2),
);
await browser.close();
if (report.some((r) => r.errors.length || r.results.some((v) => !v.ok)))
  process.exitCode = 1;
