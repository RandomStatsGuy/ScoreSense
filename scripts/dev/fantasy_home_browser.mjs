import { auditHighlightInsets } from "./layout_audit.mjs";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { attachHomeFixture } from "./fantasy_home_fixture.mjs";
import { measureScript, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";

const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await attachHomeFixture(context);
const out = "outputs/fantasy-home-pr";
await fs.mkdir(out, { recursive: true });
const reports = [];

try {
  for (const width of [1280, 390, 320]) {
    for (const state of ["pregame", "live", "zero", "final", "pre", "missing", "empty", "scoring-error", "error", "loading"]) {
      const page = await context.newPage();
      await page.setViewportSize({ width, height: width < 769 ? 844 : 900 });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      const query = new URLSearchParams({ state, ...(state === "zero" ? { format: "pick", role: "member", host: "native" } : {}), ...(state === "missing" ? { theme: "light", role: "member" } : {}) });
      await page.goto(`http://127.0.0.1:5173/test-fixtures/fantasy-home.html?${query}`);
      await page.locator(".hub-home--clubhouse").waitFor();
      if (state === "loading") await page.locator(".hub-loading-skeleton").waitFor();
      else if (state === "error") await page.locator(".hub-alert--danger").waitFor();
      else if (state === "pre") await page.locator(".hub-home-preparation").waitFor();
      else if (["empty", "scoring-error"].includes(state)) await page.locator(".hub-home-feature .hub-alert").waitFor();
      else await page.locator(".hub-home-matchup-value").first().waitFor();
      await page.locator(".chat-loading").waitFor({ state: "hidden" });
      const layout = await page.evaluate(measureScript(), { minTarget: width < 769 ? 44 : 32, numericRe: NUMERIC_RE.source, barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX, columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS });
      layout.push(...await auditHighlightInsets(page));
      reports.push({ state, width, route: "/hub/home", layout });
      if (width !== 320 && ["pregame", "pre", "missing", "zero"].includes(state)) await page.screenshot({ path: `${out}/${state}-${width}.png`, fullPage: true });

      if (state === "pregame") {
        assert.deepEqual(await page.locator(".hub-home-matchup-value strong").allTextContents(), ["122.6", "115.8"]);
        const chat = page.locator(".hub-home-conversation");
        await chat.locator("summary").first().click();
        assert.equal(await chat.evaluate(element => element.open), false);
        await chat.locator("summary").first().focus();
        await page.keyboard.press("Enter");
        assert.equal(await chat.evaluate(element => element.open), true);
        await page.getByRole("button", { name: /All standings/ }).click();
        assert.equal(await page.locator(".hub-home-standings-table tbody tr").count(), 6);
        await page.getByRole("button", { name: /Show fewer/ }).click();
        assert.equal(await page.locator(".hub-home-standings-table tbody tr").count(), 5);
        await page.locator(".chat-composer textarea").fill("Fixture-only reply");
        await page.getByRole("button", { name: "Send", exact: true }).click();
        await page.getByText("Fixture-only reply", { exact: true }).waitFor();
        await page.locator(".chat-reaction").first().click();
        await page.waitForFunction(() => document.querySelector(".chat-reaction").getAttribute("aria-pressed") === "true");
        await page.getByRole("button", { name: /^This Week/ }).click();
        await page.getByRole("button", { name: /^Game center/ }).click();
        assert.deepEqual(await page.evaluate(() => window.fixtureActions), [{ view: "week", extra: undefined }, { view: "game", extra: { matchupWeek: 6 } }]);
        assert.equal(await page.locator(".hub-home-attention").count(), 0);
        if (width < 769) {
          const chatY = await chat.evaluate(element => element.getBoundingClientRect().top);
          const standingsY = await page.locator(".hub-home-standings-card").evaluate(element => element.getBoundingClientRect().top);
          assert.ok(chatY < standingsY);
        }
      }
      if (state === "zero") {
        assert.deepEqual(await page.locator(".hub-home-matchup-value strong").allTextContents(), ["0.0", "0.0"]);
        assert.equal(await page.getByRole("tab", { name: "Staff", exact: true }).count(), 0);
        assert.equal((await page.locator(".hub-home--clubhouse").innerText()).includes("$"), false);
      }
      if (state === "missing") assert.equal(await page.locator(".hub-home-matchup-value strong").first().innerText(), "—");
      if (state === "final") assert.equal(await page.locator(".hub-home-matchup-status").innerText(), "Final");
      if (state === "pre") assert.equal(await page.locator(".hub-home-matchup,.hub-home-standings-card").count(), 0);
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.equal(await page.evaluate(() => window.fixtureRequests.some(path => path.includes("include_week=true"))), false);
      assert.equal(await page.evaluate(() => window.fixtureWrites.some(write => write.path.includes("focus"))), false);
      await page.close();
    }
    console.log(`Fantasy Home ${width}: checked 10 states and disclosure/chat/standings navigation`);
  }
} finally {
  await browser.close();
  await fs.writeFile(`${out}/interactions.json`, JSON.stringify(reports, null, 2));
}
const failed = reports.flatMap(report => report.layout.filter(row => !row.ok).map(row => ({ state: report.state, width: report.width, ...row })));
console.log(JSON.stringify({ states: reports.length, failed }, null, 2));
assert.deepEqual(failed, []);
