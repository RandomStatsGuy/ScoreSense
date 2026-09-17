import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { measureScript, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX,
  COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright");
const base = process.env.LINEUP_PICKER_QA_URL || "http://127.0.0.1:5174/lineup-picker-qa/test-fixtures/lineup-picker.html";
const browser = await chromium.launch({ headless: true });
const output = "docs/reviews/lineup-slot-picker";
await fs.mkdir(output, { recursive: true });
const reports = [];
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const open = async (state = "ready", slot = "FLEX", name = "Jaylen Waddle") => {
      await page.goto(`${base}?state=${state}`);
      await page.getByRole("button", { name: `Change ${slot}: ${name}`, exact: true }).click();
      await page.getByRole("dialog").waitFor();
    };
    const measure = async (state) => {
      const audit = await page.evaluate(measureScript(), {
        minTarget: width === 390 ? 44 : 32, numericRe: NUMERIC_RE.source,
        barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX,
        columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS,
      });
      reports.push({ width, state, audit });
      console.log(width, state, audit.filter((row) => !row.ok));
    };
    await open();
    assert.equal(await page.getByRole("radio", { name: "Jayden Daniels" }).count(), 0);
    await page.getByRole("radio", { name: "DeVonta Smith", exact: true }).click();
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.getByRole("radio", { name: "Zach Charbonnet", exact: true }).getAttribute("aria-checked"), "true");
    await page.keyboard.press("ArrowUp");
    assert.match(await page.locator(".lineup-picker-delta").textContent(), /\+2.5/);
    assert.deepEqual(await page.evaluate(() => window.fixtureWrites), []);
    await page.getByRole("button", { name: "Close position picker", exact: true }).focus();
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.getByRole("button", { name: "Start DeVonta Smith at FLEX", exact: true }).evaluate((el) => el === document.activeElement), true);
    await measure("picker");
    await page.evaluate(async () => {
      await Promise.race([
        Promise.all([...document.querySelectorAll(".lineup-picker img")].map((img) => img.decode().catch(() => {}))),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    });
    await page.screenshot({ path: `${output}/picker-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Start DeVonta Smith at FLEX", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.getByRole("status").filter({ hasText: "Lineup updated" }).waitFor();
    const writes = await page.evaluate(() => window.fixtureWrites);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].body.starter_player_id, "waddle");
    assert.equal(writes[0].body.bench_player_id, "smith");
    assert.equal(writes[0].body.week, 2);
    await page.getByRole("button", { name: "Change FLEX: DeVonta Smith", exact: true }).waitFor();
    await measure("saved-board");
    await page.screenshot({ path: `${output}/saved-${width}.png`, fullPage: true });
    await open();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(await page.getByRole("button", { name: "Change FLEX: Jaylen Waddle" }).evaluate((el) => el === document.activeElement), true);
    assert.equal(await page.evaluate(() => window.fixtureWrites.length), 0);
    await open("empty", "FLEX", "Empty");
    await page.getByRole("radio", { name: "DeVonta Smith", exact: true }).click();
    await page.getByRole("button", { name: "Start DeVonta Smith at FLEX", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => window.fixtureWrites[0].method), "PUT");
    await open("write-error");
    await page.getByRole("radio", { name: "DeVonta Smith", exact: true }).click();
    await page.getByRole("button", { name: "Start DeVonta Smith at FLEX", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "locked" }).waitFor();
    assert.equal(await page.getByRole("radio", { name: "DeVonta Smith", exact: true }).getAttribute("aria-checked"), "true");
    await open("locked-player");
    assert.equal(await page.getByRole("radio", { name: /DeVonta Smith/ }).isEnabled(), false);
    await open("locked-starter");
    assert.equal(await page.getByRole("radio", { name: "DeVonta Smith", exact: true }).isEnabled(), false);
    await open("readonly");
    assert.equal(await page.getByRole("radio", { name: "DeVonta Smith", exact: true }).isEnabled(), false);
    await open("linked");
    assert.equal(await page.getByRole("link", { name: "Set lineup in Sleeper" }).getAttribute("href"), "https://sleeper.com/leagues/fixture");
    assert.equal(await page.evaluate(() => window.fixtureWrites.length), 0);
    await open("no-options");
    await page.getByRole("button", { name: "Find FLEX on Free agents" }).click();
    assert.equal(await page.evaluate(() => window.fixtureDestination), "available");
    await open("missing");
    await page.getByRole("radio", { name: "DeVonta Smith", exact: true }).click();
    assert.match(await page.locator(".lineup-picker-delta").textContent(), /Projection unavailable/);
    await page.goto(`${base}?state=loading`);
    await page.locator(".hub-wcc-board-overlay").waitFor();
    assert.equal(await page.locator(".hub-wcc-position-button").count(), 0);
    await page.goto(`${base}?state=load-error`);
    await page.getByRole("button", { name: "Retry", exact: true }).first().waitFor();
    assert.equal(await page.locator(".hub-wcc-position-button").count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
  }
  await fs.writeFile(`${output}/layout-report.json`, JSON.stringify(reports, null, 2));
  assert.deepEqual(reports.flatMap((r) => r.audit.filter((a) => !a.ok)), []);
  console.log("PASS: slot selection, confirm-only writes, swap, empty-slot fill, focus return, locks, read-only, linked, missing projections, loading and errors at 1280/390.");
} finally { await browser.close(); }
