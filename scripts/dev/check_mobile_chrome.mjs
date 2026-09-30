import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright");
const out = "outputs/mobile-chrome";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = [];
try {
  for (const width of [320, 390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    page.setDefaultTimeout(8000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (width === 390) await page.addInitScript(() => localStorage.setItem("scoresense-color-theme", "light"));
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    const check = async state => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, `${width} ${state}: horizontal overflow`);
      assert.deepEqual(errors, [], `${width} ${state}: browser errors`);
      report.push({ width, state, pass: true });
    };
    await page.goto("http://127.0.0.1:5173/test-fixtures/free-agents-mobile.html?long", { waitUntil: "networkidle" });
    if (width < 769) {
      const trigger = page.getByRole("button", { name: "Free agents, choose destination", exact: true });
      assert.equal(await page.getByRole("button", { name: "More", exact: true }).count(), 1);
      const bounds = await trigger.boundingBox();
      assert.ok(bounds.x >= 20 && bounds.width > 44, "Header has an internal inset and reachable title");
      await trigger.click();
      const dialog = page.getByRole("dialog");
      assert.deepEqual(await dialog.locator(".app-mobile-sheet-item--dest").allTextContents(), ["This Week", "My team", "Free agents", "League"]);
      await dialog.getByRole("button", { name: "League", exact: true }).click();
      assert.equal(await dialog.getByRole("button", { name: "Vibes", exact: true }).count(), 1);
      assert.equal(await dialog.getByRole("button", { name: "Roster management", exact: true }).count(), 0);
      await dialog.getByRole("button", { name: "Vibes", exact: true }).click();
      assert.equal(await page.evaluate(() => window.fixtureDestination), "vibes");
      assert.equal(await dialog.count(), 0);
      assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
      await trigger.click();
      await dialog.getByRole("button", { name: "Free agents", exact: true }).click();
      assert.equal(await dialog.count(), 0, "Selecting the current page dismisses the picker");
      await page.getByRole("button", { name: "More", exact: true }).click();
      await page.getByRole("dialog").evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
      await page.keyboard.press("Shift+Tab");
      assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
      await check("more-sheet");
      if (width === 390) await page.screenshot({ path: `${out}/more-390.png` });
      await page.keyboard.press("Escape");
      assert.equal(await page.evaluate(() => document.querySelector("#root").inert), false);
      assert.equal(await page.evaluate(() => document.activeElement.textContent.includes("More")), true);
    }
    await check("navigation");
    if (width === 390) await page.screenshot({ path: `${out}/header-390.png` });
    for (const kind of ["report", "admin", "terms", "privacy", "account", "sms"]) {
      await page.goto(`http://127.0.0.1:5173/test-fixtures/utility-mobile.html?page=${kind}`, { waitUntil: "networkidle" });
      await check(kind);
      if (kind === "report") {
        assert.equal(await page.getByRole("textbox", { name: "Short title", exact: true }).count(), 1);
        assert.ok(await page.getByRole("textbox", { name: "What happened", exact: true }).evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 16));
      }
      if (width === 390 && ["report", "terms", "admin"].includes(kind)) await page.screenshot({ path: `${out}/${kind}-390.png` });
      if (kind === "admin") {
        for (const tab of ["Users", "Leagues"]) {
          await page.getByRole("button", { name: tab, exact: true }).click();
          await check("admin-" + tab);
        }
        if (width < 769) {
          await page.locator(".mobile-player-card-header").click();
          await page.locator(".admin-mobile-league-detail").waitFor();
          assert.equal(await page.locator(".mobile-player-card-header").getAttribute("aria-expanded"), "true");
          await check("admin-expanded");
          if (width === 390) await page.screenshot({ path: `${out}/admin-leagues-390.png`, fullPage: true });
        }
      }
    }
    await page.close();
  }
  await fs.writeFile(`${out}/checks.json`, JSON.stringify(report, null, 2));
  console.log(`PASS: ${report.length} navigation / utility layout checks at 320, 390, and 1280px`);
} finally { await browser.close(); }
