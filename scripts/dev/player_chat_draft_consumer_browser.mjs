// Actual Draft Room consumer; all HTTP and WebSocket state is synthetic.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { attachDraftFixture, draftFixtureUrl } from "./draft_fixture_runtime.mjs";
import { measureScript, minTargetForWidth, NUMERIC_RE, BAR_CONTROL_SELECTOR,
  TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "frontend/package.json"));
const { chromium } = require("playwright");
const output = path.join(root, "outputs/player-chat-draft-consumer");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.platform === "win32" ? "msedge" : undefined });
const report = [];
try {
  for (const practice of [false, true]) for (const width of [1280, 390]) for (const theme of ["dark", "light"]) {
    const ctx = await browser.newContext({ viewport: { width, height: 960 }, serviceWorkers: "block", reducedMotion: "reduce" });
    const errors = [];
    await ctx.route("**/*", route => route.abort());
    await ctx.addInitScript(theme => {
      localStorage.setItem("scoresense-color-theme", theme);
      localStorage.setItem("scoresense:draft-sound", "0");
    }, theme);
    await attachDraftFixture(ctx);
    const page = await ctx.newPage();
    page.setDefaultTimeout(6000);
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto(draftFixtureUrl + "?state=bidding" + (practice ? "&practice=1" : ""));
      // The older draft fixture omits main.jsx's shared chat stylesheet.
      await page.addStyleTag({ content: await fs.readFile(path.join(root, "frontend/src/styles/fantasy-chat.css"), "utf8") });
      await page.getByRole("tab", { name: "Chat", exact: true }).click();
      const compose = page.getByRole("combobox", { name: "Chat message", exact: true });
      await compose.fill("Local draft message");
      await page.waitForFunction(() => {
        const send = document.querySelector(".chat-composer button[type=submit]");
        return send && !send.disabled;
      });
      assert.equal(await page.getByRole("button", { name: "Send", exact: true }).isEnabled(), true);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
      // Enrichment is an existing read encoded as POST; no chat/draft mutations are permitted.
      assert.deepEqual(await page.evaluate(() => window.__draftFixture.writes.filter(row => row.path !== "/api/hub/draft-room/enrichment")), []);
      const material = await page.locator(".hub-draft-activity-panel").evaluate(el => getComputedStyle(el).backgroundColor);
      assert.equal(material, theme === "light" ? "rgb(255, 255, 255)" : "rgb(10, 18, 30)");
      const layout = await page.evaluate(measureScript(), {
        minTarget: minTargetForWidth(width), numericRe: NUMERIC_RE.source,
        barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX,
        columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS,
      });
      await compose.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `${practice ? "mock" : "draft"}-chat-${width}-${theme}.png`) });
      assert.deepEqual(layout.filter(row => !row.ok), []);
      assert.deepEqual(errors, []);
      const tabs = [{ name: "Chat", layout }];
      for (const name of ["Teams", "Queue", "Activity"]) {
        await page.getByRole("tab", { name, exact: true }).click();
        const material = await page.locator(".hub-draft-activity-panel").evaluate(el => getComputedStyle(el).backgroundColor);
        assert.equal(material, theme === "light" ? "rgb(255, 255, 255)" : "rgb(10, 18, 30)");
        const panelLayout = await page.evaluate(measureScript(), {
          minTarget: minTargetForWidth(width), numericRe: NUMERIC_RE.source,
          barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX,
          columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS,
        });
        assert.deepEqual(panelLayout.filter(row => !row.ok), []);
        tabs.push({ name, layout: panelLayout });
      }
      assert.deepEqual(await page.evaluate(() => window.__draftFixture.writes.filter(row => row.path !== "/api/hub/draft-room/enrichment")), []);
      assert.deepEqual(errors, []);
      report.push({ practice, width, theme, passed: true, tabs });
      console.log("PASS", practice ? "mock chat" : "draft chat", width, theme);
    } catch (error) {
      report.push({ practice, width, theme, passed: false, error: error.message });
      console.log("FAIL", practice ? "mock chat" : "draft chat", width, theme, error.message);
    } finally { await ctx.close(); }
  }
} finally {
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
}
if (report.some(test => !test.passed)) process.exitCode = 1;
