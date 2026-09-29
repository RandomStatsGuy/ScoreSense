/** Run against test-fixtures/weekly-experience.html, or a bundled fixture URL. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright");
const base = process.env.WEEKLY_FIXTURE_URL || "http://127.0.0.1:5173/test-fixtures/weekly-experience.html";
const browser = await chromium.launch({ headless: true });
const checks = [];
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://**/*", route => route.abort());
    const open = async (query = "") => {
      await page.goto(`${base}${query}`);
      await page.getByRole("button", { name: "Next week", exact: true }).waitFor();
    };
    const text = () => page.locator("body").innerText();
    const changeFlex = () => page.getByRole("button", { name: "Change FLEX: Jaylen Waddle", exact: true });
    await open("?week=3");
    await changeFlex().waitFor();
    const nav = page.getByRole("navigation", { name: "Fantasy", exact: true });
    assert.deepEqual(await nav.getByRole("link").allTextContents(), ["This WeekWeek", "My teamMy team", "Free agentsFA"]);
    assert.ok((await text()).includes("Projected favored by 5.0"));
    await page.getByRole("button", { name: "Set lineup", exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.id === "hub-week-lineup-heading");
    await changeFlex().click();
    await page.getByRole("radio", { name: "DeVonta Smith", exact: true }).click();
    assert.equal(await page.evaluate(() => window.fixtureWrites.length), 0);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await page.evaluate(() => window.fixtureWrites.length), 0);
    await changeFlex().click();
    await page.getByRole("radio", { name: "DeVonta Smith", exact: true }).click();
    await page.getByRole("button", { name: "Start DeVonta Smith at FLEX", exact: true }).click();
    await page.waitForFunction(() => document.body.innerText.includes("Projected favored by 7.5"));
    const writes = await page.evaluate(() => window.fixtureWrites);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].body.week, 3);
    assert.equal(writes[0].body.bench_player_id, "smith");
    await page.getByRole("button", { name: "Correct a lineup", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => [window.fixtureDestination, window.fixtureNavigationExtra]), ["office-corrections", { week: 3 }]);
    await page.getByRole("button", { name: "Next week", exact: true }).click();
    await page.waitForFunction(() => document.body.innerText.includes("Week 4 board"));
    assert.ok((await page.evaluate(() => window.fixtureRequests)).some(path => path.includes("live-scoring") && path.includes("week=4")));
    assert.equal(await page.getByRole("button", { name: "Next week", exact: true }).count(), 1);
    checks.push(`${width}: confirmed swap refreshes forecast; cancel is inert; one week controls lineup, matchup and correction link`);

    await open("?state=missing");
    await changeFlex().waitFor();
    assert.ok((await text()).includes("Matchup projection incomplete"));
    assert.ok(!(await text()).includes("favored by"));
    await open("?state=score-error");
    await changeFlex().waitFor();
    assert.ok((await text()).includes("Matchup unavailable"));
    await open("?state=linked");
    await changeFlex().waitFor();
    await changeFlex().click();
    await page.getByRole("radio", { name: "DeVonta Smith", exact: true }).click();
    await page.getByRole("link", { name: "Set lineup in Sleeper", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.fixtureWrites.length), 0);
    await open("?state=write-error");
    await changeFlex().waitFor();
    await changeFlex().click();
    await page.getByRole("radio", { name: "DeVonta Smith", exact: true }).click();
    await page.getByRole("button", { name: "Start DeVonta Smith at FLEX", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Game started" }).waitFor();
    assert.ok((await text()).includes("Projected favored by 5.0"));
    checks.push(`${width}: incomplete forecast, matchup failure, Sleeper ownership and rejected swap handled`);

    await open("?state=live");
    await page.getByRole("button", { name: "Matchup", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Matchup", exact: true }).getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: "Set lineup", exact: true }).click();
    await changeFlex().waitFor();
    await page.getByRole("button", { name: "League", exact: true }).click();
    assert.ok((await text()).includes("Sam"));
    await open("?matchupTeam=other");
    await page.getByRole("button", { name: "Matchup", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Set lineup", exact: true }).count(), 0);
    assert.equal(await changeFlex().count(), 0);
    checks.push(`${width}: live matchup, league results and read-only team deep link`);

    await open("?state=readonly");
    await changeFlex().waitFor();
    assert.ok((await text()).includes("This lineup is read-only."));
    await changeFlex().click();
    assert.equal(await page.getByRole("radio", { name: "DeVonta Smith", exact: true }).isEnabled(), false);
    assert.equal(await page.evaluate(() => window.fixtureWrites.length), 0);
    await open("?state=empty");
    await page.getByText("1 empty starter slot", { exact: true }).waitFor();
    await open("?state=loading");
    await page.getByRole("heading", { name: "Your lineup", exact: true }).waitFor();
    assert.equal(await changeFlex().count(), 0);
    checks.push(`${width}: finalized lineup is read-only; empty and loading states are explicit`);

    for (const salary of [false, true]) {
      await open(salary ? "?salary=1&member=1" : "?member=1");
      await page.getByRole("button", { name: "League navigation", exact: true }).click();
      const cap = width === 1280 ? page.getByRole("link", { name: "Cap", exact: true }) : page.getByRole("button", { name: "Cap", exact: true });
      assert.equal(await cap.count(), salary ? 1 : 0);
      assert.equal(await page.getByRole("link", { name: "Roster management", exact: true }).count(), 0);
      assert.equal(await page.getByRole("button", { name: "Roster management", exact: true }).count(), 0);
    }
    assert.deepEqual(errors, []);
    checks.push(`${width}: salary-aware League menu and commissioner gating`);
    await page.close();
  }
  for (const check of checks) console.log(`PASS ${check}`);
} finally {
  await browser.close();
}
