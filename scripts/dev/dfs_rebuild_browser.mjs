// Production UI task checks. API responses are explicitly synthetic; real
// candidate/selection correctness is covered by the separate Python tests.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachDfsFixture } from "./dfs_fixture_runtime.mjs";
import { readPortfolioBackup } from "../../frontend/src/dfsPortfolioBackup.js";
import { measureScript, minTargetForWidth, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX,
  COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "frontend/package.json"));
const { chromium } = require("playwright");
const output = path.join(root, "outputs/dfs-rebuild-review");
await mkdir(output, { recursive: true });
const report = [], browser = await chromium.launch({ headless: true });
const viewportFailures = [];
const fixtureUrl = "http://127.0.0.1:5173/test-fixtures/dfs-portfolio.html";
async function backup(page, name) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download portfolio backup", exact: true }).click();
  const filepath = path.join(output, `${name}.json`);
  await (await pending).saveAs(filepath);
  return readPortfolioBackup(await readFile(filepath, "utf8"));
}
try {
  for (const width of [390, 768, 1280, 1440]) for (const theme of ["dark", "light"]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, acceptDownloads: true, reducedMotion: "reduce" });
    await context.addInitScript(value => localStorage.setItem("scoresense-color-theme", value), theme);
    await attachDfsFixture(context);
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(fixtureUrl);
    await page.getByRole("button", { name: "Lock Example 1", exact: true }).waitFor();
    for (const [name, option, key] of [[/^Format:/, "DraftKings Classic", "Enter"], [/^Slate:/, "Classic fixture slate", "Escape"]]) {
      const trigger = page.getByRole("button", { name });
      await trigger.focus(); await page.keyboard.press("Enter");
      await page.getByRole("option", { name: option, exact: true }).focus(); await page.keyboard.press(key);
      assert.equal(await trigger.evaluate(element => element === document.activeElement), true, `${name} returns keyboard focus`);
      assert.equal(await trigger.getAttribute("aria-expanded"), "false");
    }
    await page.getByRole("button", { name: "Lock Example 1", exact: true }).waitFor();
    await page.getByRole("spinbutton", { name: "Lineups", exact: true }).fill("150");
    // This synthetic fixture changes one WR. Request that declared overlap limit.
    await page.getByRole("button", { name: /^Minimum differences:/ }).click();
    await page.getByRole("option", { name: "1", exact: true }).click();
    await page.getByRole("navigation", { name: "Player pool", exact: true }).getByRole("button", { name: "Exposure", exact: true }).click();
    const global = page.locator("[aria-labelledby='dfw-global-title']");
    const enable = page.getByRole("checkbox", { name: "Select the portfolio together", exact: true });
    assert.equal(await enable.isChecked(), false, "Legacy remains the default");
    await enable.focus(); await page.keyboard.press("Space");
    await page.getByLabel("Find an exposure player", { exact: true }).fill("Example 1");
    const target = page.getByRole("spinbutton", { name: "Target: Example 1", exact: true });
    await target.fill("40");
    assert.match(await target.locator("..").innerText(), /60 of 150/);
    const minimum = page.getByRole("spinbutton", { name: "Minimum: Example 1", exact: true });
    const maximum = page.getByRole("spinbutton", { name: "Maximum: Example 1", exact: true });
    await minimum.fill("60"); await maximum.fill("40");
    await page.locator(".dfw-build-button").click();
    await page.getByRole("alert").filter({ hasText: /minimum 90 exceeds maximum 60/ }).first().waitFor();
    assert.equal(await page.evaluate(() => window.__portfolioFixture.requests.length), 0);
    await minimum.fill("0"); await maximum.fill("100");
    // Unit conversion is a UI edit: retain the same requested appearances.
    const units = page.getByRole("button", { name: /^Exposure units:/ });
    await units.focus(); await page.keyboard.press("Enter");
    await page.getByRole("option", { name: "Appearances", exact: true }).focus(); await page.keyboard.press("Enter");
    assert.equal(await target.inputValue(), "60");
    assert.equal(await units.evaluate(element => element === document.activeElement), true, "Menu returns focus after a keyboard selection");
    await page.getByRole("button", { name: /^Exposure units:/ }).click();
    await page.getByRole("option", { name: "Percent", exact: true }).click();
    assert.equal(await target.inputValue(), "40");
    await page.locator(".dfw-build-button").click();
    await page.getByText("150 of 150 selected", { exact: false }).waitFor();
    const request = await page.evaluate(() => window.__portfolioFixture.requests.at(-1));
    assert.equal(request.portfolio_mode, "global");
    assert.equal(request.block_qb_opposing_dst, true);
    assert.deepEqual(request.player_exposure_limits.p1, { min: "0", target: "0.4", max: "1" });
    assert.deepEqual(request.projection_overrides, {}, "Exposure edits must not rewrite forecasts");
    assert.match(await global.locator(".dfw-exposure-identity").first().innerText(), /Actual: 150 of 150 generated/);
    await global.getByText("Pairs & FLEX structure", { exact: true }).click();
    await global.getByText("Example 2 + Example 3", { exact: true }).waitFor();
    await page.getByText("Local draft saved", { exact: true }).waitFor();
    await global.scrollIntoViewIfNeeded();
    const clippedControls = await global.evaluate(element => {
      const outer = element.getBoundingClientRect();
      return [...element.querySelectorAll("input, button, select")].filter(control => control.getClientRects().length)
        .filter(control => { const box = control.getBoundingClientRect(); return box.left < outer.left - 1 || box.right > outer.right + 1; })
        .map(control => control.getAttribute("aria-label") || control.textContent || control.type);
    });
    assert.deepEqual(clippedControls, [], `Global controls must fit their visible panel at ${width} ${theme}`);
    await global.screenshot({ path: path.join(output, `global-${theme}-${width}.png`) });
    await page.screenshot({ path: path.join(output, `workspace-${theme}-${width}.png`) });
    const measurements = await page.evaluate(measureScript(), { minTarget: minTargetForWidth(width), numericRe: NUMERIC_RE.source,
      barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX,
      columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(overflow, false, `No page overflow at ${width} ${theme}`);
    report.push({ width, theme, state: "global controls", measurements });
    const fails = measurements.filter(item => !item.ok);
    if (fails.length) viewportFailures.push({ width, theme, fails });
    // Recovery must work without requiring the user to have downloaded JSON.
    await page.reload();
    await page.getByText("A local draft is available to recover.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Restore local draft", exact: true }).click();
    await page.getByText("150 / 150 unique · 150 collected", { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => window.__portfolioFixture.requests.length), 0);
    const recovered = await backup(page, `local-draft-${theme}-${width}`);
    assert.equal(recovered.batches[0].lineups.length, 150);
    assert.equal(recovered.batches[0].settings.portfolio_mode, "global");
    assert.deepEqual(recovered.batches[0].settings.player_exposure_limits.p1, request.player_exposure_limits.p1);
    assert.equal(await page.getByRole("button", { name: "Assign lineups in order", exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width} ${theme}: native target/count controls, conflict blocks request, unchanged forecasts, actual/pair audit, reload local draft; layout ${fails.length ? `FAIL (${fails.length})` : "PASS"}`);
    await context.close();
  }
  // Fresh account access is required even after optional ledger sync failed.
  const context = await browser.newContext({ viewport: { width: 390, height: 960 }, acceptDownloads: true });
  await attachDfsFixture(context);
  const page = await context.newPage(), downloads = [];
  page.on("download", download => downloads.push(download));
  await page.goto(fixtureUrl);
  await page.getByRole("spinbutton", { name: "Lineups", exact: true }).fill("3");
  await page.locator(".dfw-build-button").click();
  await page.getByLabel("Batch label", { exact: true }).fill("Ledger outage");
  await page.getByRole("button", { name: "Add current build to portfolio", exact: true }).click();
  const rows = "Entry ID,Contest ID,Contest Name,Entry Fee,QB,RB,RB,WR,WR,WR,TE,FLEX,DST\n1,900,Fixture,$0.50,,,,,,,,,\n2,900,Fixture,$0.50,,,,,,,,,\n3,900,Fixture,$0.50,,,,,,,,,";
  await page.getByLabel("Import Edit Entries CSV", { exact: true }).setInputFiles({ name: "entries.csv", mimeType: "text/csv", buffer: Buffer.from(rows) });
  await page.getByRole("button", { name: "Assign lineups in order", exact: true }).click();
  await page.getByRole("checkbox", { name: "I checked the slate and start time; none of the assigned players have locked.", exact: true }).check();
  await page.evaluate(() => { window.__portfolioFixture.failLedger = true; });
  await page.getByRole("button", { name: "Download DraftKings entry-update CSV", exact: true }).click();
  await page.getByText("History sync pending.", { exact: false }).waitFor();
  assert.equal(downloads.length, 0, "Recovery must be an explicit action");
  await page.evaluate(() => { window.__portfolioFixture.accessStatus = 403; });
  await page.getByRole("button", { name: "Download local recovery CSV", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: /Fixture account access denied|Sign in again/ }).first().waitFor();
  assert.equal(downloads.length, 0, "Authorization failure cannot download a cached artifact");
  console.log("PASS authorization: pending ledger sync preserves work, explicit recovery rechecks account access and blocks 403");
  await context.close();
  const staleContext = await browser.newContext({ viewport: { width: 1280, height: 960 }, acceptDownloads: true });
  await attachDfsFixture(staleContext);
  const stalePage = await staleContext.newPage(), staleDownloads = [];
  stalePage.on("download", download => staleDownloads.push(download));
  await stalePage.goto(fixtureUrl);
  await stalePage.getByRole("spinbutton", { name: "Lineups", exact: true }).fill("1");
  for (const label of ["Before account change A", "Before account change B"]) {
    await stalePage.locator(".dfw-build-button").click();
    await stalePage.getByLabel("Batch label", { exact: true }).fill(label);
    await stalePage.getByRole("button", { name: "Add current build to portfolio", exact: true }).click();
  }
  await stalePage.getByRole("button", { name: /^Reserved-entry lineup source:/ }).click();
  await stalePage.getByRole("option", { name: "Reviewed portfolio", exact: true }).click();
  await stalePage.getByLabel("Import Edit Entries CSV", { exact: true }).setInputFiles({ name: "entries.csv", mimeType: "text/csv", buffer: Buffer.from(rows) });
  await stalePage.getByRole("button", { name: "Assign lineups in order", exact: true }).click();
  await stalePage.getByRole("checkbox", { name: "I checked the slate and start time; none of the assigned players have locked.", exact: true }).check();
  await stalePage.evaluate(() => { window.__portfolioFixture.delaySave = true; });
  await stalePage.getByRole("button", { name: "Download DraftKings entry-update CSV", exact: true }).click();
  await stalePage.waitForFunction(() => typeof window.__portfolioFixture.releaseSave === "function");
  await stalePage.evaluate(() => {
    dispatchEvent(new Event("scoresense-auth-changed"));
    window.__portfolioFixture.delaySave = false;
    window.__portfolioFixture.releaseSave();
  });
  await stalePage.getByRole("alert").filter({ hasText: /changed|review/i }).first().waitFor();
  const staleState = await stalePage.evaluate(() => ({ saves: window.__portfolioFixture.saveAttempts, imports: window.__portfolioFixture.imports.length }));
  assert.equal(staleState.saves, 1, "An account change prevents the second batch save");
  assert.equal(staleState.imports, 0, "An account change prevents ledger synchronization");
  assert.equal(staleDownloads.length, 0, "An account change prevents stale CSV download");
  console.log("PASS account change during save: no later batch save, ledger write or stale CSV download");
  await staleContext.close();
} finally {
  await writeFile(path.join(output, "report.json"), JSON.stringify({ report, viewportFailures }, null, 2));
  await browser.close();
}
if (viewportFailures.length) {
  console.error(JSON.stringify(viewportFailures, null, 2));
  process.exitCode = 1;
}
