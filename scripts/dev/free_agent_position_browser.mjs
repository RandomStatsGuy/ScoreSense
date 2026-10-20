import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { measureScript, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright");
const base = process.env.FIXTURE_ORIGIN || "http://127.0.0.1:5173";
const out = "docs/reviews/free-agent-position-filter";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
const report = [];
try {
  for (const width of [1280, 390]) for (const theme of ["dark", "light"]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
    await page.route("**/*", r => new URL(r.request().url()).origin === base ? r.continue() : r.abort());
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    const go = async () => {
      await page.goto(base + "/hub/free-agents?state=claim&needPos=DEF", { waitUntil: "networkidle" });
      await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
      await page.getByRole("button", { name: "Pos: DEF", exact: true }).waitFor();
    };
    const rosterPlayer = name => page.locator(width > 768 ? ".fa-roster-row" : ".fa-tile").filter({ hasText: name });
    await go();
    // Reproduce the live path: a DEF deep link followed by a bench WR click.
    await rosterPlayer(width > 768 ? "Darius Slayton" : "Slayton").click();
    await page.getByRole("button", { name: "Pos: ALL", exact: true }).waitFor();
    assert.equal(await page.locator(".fa-player").count(), 4);
    assert.match(await page.locator(".fa-board").innerText(), /Comparing Slayton/i);
    assert.equal(new URL(page.url()).searchParams.has("needPos"), false);
    // Selecting another player and clearing the target cannot restore DEF.
    await rosterPlayer(width > 768 ? "Bo Nix" : "Nix").click();
    assert.equal(await page.locator(".fa-player").count(), 1);
    await rosterPlayer(width > 768 ? "Bo Nix" : "Nix").click();
    assert.equal(await page.locator(".fa-player").count(), 8);
    // Reset means all positions even when the page originally opened at DEF.
    await go();
    await page.getByRole("button", { name: "Reset filters", exact: true }).click();
    assert.equal(await page.locator(".fa-player").count(), 8);
    assert.equal(new URL(page.url()).searchParams.has("needPos"), false);
    // A manual selection updates the link; clearing it survives reload.
    await page.getByRole("button", { name: "Pos: ALL", exact: true }).click();
    await page.getByRole("option", { name: "WR", exact: true }).click();
    assert.equal(new URL(page.url()).searchParams.get("needPos"), "WR");
    await page.getByRole("button", { name: "Pos: WR", exact: true }).click();
    await page.getByRole("option", { name: "ALL", exact: true }).click();
    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
    await page.getByRole("button", { name: "Pos: ALL", exact: true }).waitFor();
    assert.equal(await page.locator(".fa-player").count(), 8);
    await rosterPlayer(width > 768 ? "Darius Slayton" : "Slayton").click();
    assert.deepEqual(await page.evaluate(() => window.fixtureWrites), []);
    assert.deepEqual(errors, []);
    const results = await page.evaluate(measureScript(), { minTarget: width <= 768 ? 44 : 32, numericRe: NUMERIC_RE.source, barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX, columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    report.push({ width, theme, overflow, results });
    await page.screenshot({ path: out + "/comparison-" + theme + "-" + width + ".png", fullPage: true });
    await page.getByRole("button", { name: "Open Josh Downs details", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const dropMenu = dialog.getByRole("button", { name: "Drop if successful: Darius Slayton", exact: true });
    await dropMenu.waitFor();
    await dropMenu.scrollIntoViewIfNeeded();
    assert.match(await dialog.innerText(), /Darius Slayton leaves only if this claim succeeds/);
    assert.deepEqual(await page.evaluate(() => window.fixtureWrites), []);
    const sheetResults = await page.evaluate(measureScript(), { minTarget: width <= 768 ? 44 : 32, numericRe: NUMERIC_RE.source, barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX, columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS });
    report.push({ width, theme, state: "prefilled-drop", results: sheetResults });
    await page.screenshot({ path: out + "/drop-" + theme + "-" + width + ".png", fullPage: true });
    await dropMenu.click();
    await dialog.getByRole("option", { name: "No conditional drop", exact: true }).click();
    assert.match(await dialog.innerText(), /no drop needed/);
    await dialog.getByRole("button", { name: "Drop if successful: No conditional drop", exact: true }).click();
    await dialog.getByRole("option", { name: "Bo Nix", exact: true }).click();
    await dialog.getByRole("button", { name: "Confirm claim", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    const writes = await page.evaluate(() => window.fixtureWrites);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].body.claims[0].drop_player_id, "11563");
    // A starter preselects that exact player too; open space never infers a drop.
    await rosterPlayer(width > 768 ? "Jameson Williams" : "Williams").click();
    await page.getByRole("button", { name: "Open Rashid Shaheed details", exact: true }).click();
    await dialog.getByRole("button", { name: "Drop if successful: Jameson Williams", exact: true }).waitFor();
    await dialog.getByRole("button", { name: "Close player details", exact: true }).click();
    await page.locator(width > 768 ? ".fa-roster-row.is-open" : ".fa-tile.is-open").click();
    await page.getByRole("button", { name: "Open Michael Wilson details", exact: true }).click();
    await dialog.getByRole("button", { name: "Drop if successful: No conditional drop", exact: true }).waitFor();
    assert.equal((await page.evaluate(() => window.fixtureWrites)).length, 1);
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser.close();
  await fs.writeFile(out + "/audit.json", JSON.stringify(report, null, 2));
}
assert.deepEqual(report.flatMap(r => r.results.filter(c => !c.ok)), []);
assert.ok(report.every(r => !r.overflow));
console.log("PASS: DEF deep link, comparisons, reset/reload, starter/bench drop prefill, clear/override/confirmed payload, open spot without drop; isolated writes only; dark/light at 1280/390.");
