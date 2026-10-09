import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { measureScript, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright");
const { createServer } = await import(new URL("../../frontend/node_modules/vite/dist/node/index.js", import.meta.url));
const { default: react } = await import(pathToFileURL(require.resolve("@vitejs/plugin-react").replace(/\.cjs$/, ".js")).href);
const server = await createServer({ configFile: false, root: fileURLToPath(new URL("../../frontend", import.meta.url)), plugins: [react()], server: { host: "127.0.0.1", hmr: false }, logLevel: "error" });
await new Promise((resolve, reject) => { server.httpServer.once("error", reject); server.httpServer.listen(0, "127.0.0.1", resolve); });
const base = `http://127.0.0.1:${server.httpServer.address().port}`, folder = "outputs/release-fantasy-integrity-review";
await fs.mkdir(folder, { recursive: true });
const reports = []; let browser;
const scenarios = [
  { view: "rules", host: "native", format: "pick" }, { view: "rules", host: "native", format: "salary" }, { view: "rules", host: "sleeper", format: "pick" },
  { view: "week", host: "native", format: "pick" },
  { view: "agents", host: "native", format: "pick" }, { view: "agents", host: "native", format: "salary" },
  { view: "agents", host: "native", format: "pick", state: "instant" }, { view: "agents", host: "native", format: "salary", state: "instant" },
  { view: "agents", host: "native", format: "salary", state: "nocap" },
  ...["live", "pending", "error"].map(state => ({ view: "game", host: "native", format: "pick", state })), { view: "game", host: "sleeper", format: "pick", state: "live" },
];
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 390]) for (const scenario of scenarios) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, serviceWorkers: "block" });
    const errors = [], apiRequests = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("request", r => { if (r.url().includes("/api/")) apiRequests.push(r.url()); });
    await page.route("**/api/**", route => route.abort());
    const name = `${scenario.view}-${scenario.host}-${scenario.format}-${scenario.state || "ready"}-${width}`;
    try {
      await page.goto(`${base}/test-fixtures/fantasy-integrity.html?${new URLSearchParams(scenario)}`, { waitUntil: "networkidle" });
      if (scenario.view === "rules") {
        await page.getByRole("heading", { name: "League rules", exact: true }).waitFor();
        await page.getByRole("button", { name: "League format", exact: true }).click();
        assert.equal(await page.getByLabel("Regular-season weeks", { exact: true }).count(), scenario.host === "native" ? 1 : 0);
        assert.equal(await page.getByLabel("Season waiver budget (FAAB)", { exact: true }).count(), 0);
        assert.equal(await page.getByLabel("Playoff teams", { exact: true }).count(), scenario.host === "native" ? 1 : 0);
        if (scenario.host === "sleeper") { await page.getByRole("button", { name: "Scoring", exact: true }).click(); await page.getByRole("link", { name: "Open league in Sleeper", exact: true }).waitFor(); }
        else {
          const save = page.getByRole("button", { name: "Save league rules", exact: true }).first();
          assert.equal(await save.isDisabled(), true);
          const count = page.getByLabel("Playoff teams", { exact: true });
          await count.fill("4"); assert.equal(await save.isEnabled(), true);
          await count.fill("6"); assert.equal(await save.isDisabled(), true);
          const regular = page.getByLabel("Regular-season weeks", { exact: true });
          await regular.fill("13"); assert.equal(await save.isEnabled(), true);
          await regular.fill("14"); assert.equal(await save.isDisabled(), true);
          const playoffs = page.getByRole("switch", { name: /^Playoffs/ });
          await playoffs.click(); assert.equal(await save.isEnabled(), true);
          await playoffs.click(); assert.equal(await save.isDisabled(), true);
          await count.fill("4"); await regular.fill("13");
          await save.click(); await page.getByText("League rules saved.", { exact: true }).waitFor();
          const write = (await page.evaluate(() => window.fixtureWrites))[0].body;
          assert.equal(write.league_id, "integrity-fixture"); assert.equal(write.rules.regular_season_games, 13);
          assert.equal(write.rules.playoffs.teams, 4); assert.equal(write.rules.playoffs.enabled, true);
        }
      }
      if (scenario.view === "week") {
        const locked = page.locator(".hub-wcc-row").filter({ hasText: "Travis Kelce" });
        const future = page.locator(".hub-wcc-row").filter({ hasText: "Isaiah Likely" });
        await future.waitFor();
        assert.equal(await locked.locator(".hub-wcc-position-button").isDisabled(), true);
        assert.equal(await future.locator(".hub-wcc-position-button").isEnabled(), true);
        await future.locator(".hub-wcc-position-button").click();
        assert.deepEqual(await page.evaluate(() => window.fixtureActions), [{ kind: "slot", value: "flex" }]);
        assert.equal(await page.locator(".hub-wcc-row.is-empty").count(), 2);
        assert.equal(await page.locator(".hub-wcc-row").filter({ hasText: "Unknown kickoff" }).locator(".hub-wcc-position-button").isDisabled(), true);
      }
      if (scenario.view === "agents") {
        await page.locator('.fa-player').first().waitFor();
        await page.getByRole("button", { name: "How adds work", exact: true }).click();
        if (["instant", "nocap"].includes(scenario.state) && scenario.format === "salary") assert.match(await page.locator(".fa-info").innerText(), /cost \$1.*one-year FA contract/);
        const action = scenario.state === "instant" || scenario.state === "nocap" ? "Add" : scenario.format === "pick" ? "Claim" : "Bid";
        await page.getByRole("button", { name: `${action} Isaiah Likely`, exact: true }).click();
        const dialog = page.getByRole("dialog"); await dialog.waitFor();
        if (scenario.state === "nocap") {
          assert.equal(await dialog.getByRole("button", { name: "Add player", exact: true }).isDisabled(), true);
          assert.deepEqual(await page.evaluate(() => window.fixtureWrites), []);
        } else if (scenario.state === "instant") {
          await dialog.getByRole("button", { name: "Add player", exact: true }).click();
          await dialog.waitFor({ state: "hidden" });
          const write = (await page.evaluate(() => window.fixtureWrites))[0];
          assert.equal(write.path, "/api/hub/roster"); assert.equal(write.body.salary, scenario.format === "pick" ? 0 : 1); assert.equal(write.body.contract_years, 1);
        } else if (scenario.format === "pick") {
          assert.equal(await dialog.getByRole("spinbutton").count(), 0);
          assert.equal(await dialog.getByLabel("Walk-away", { exact: true }).count(), 0);
          await dialog.getByRole("button", { name: "Confirm claim", exact: true }).click(); await dialog.waitFor({ state: "hidden" });
          const write = (await page.evaluate(() => window.fixtureWrites))[0];
          assert.equal(write.path, "/api/hub/fa-market/claims"); assert.equal(write.body.claims[0].player_id, "fa-player");
        } else {
          const amount = dialog.getByLabel("Your bid", { exact: true }), ceiling = dialog.getByLabel("Walk-away", { exact: true });
          await ceiling.waitFor(); await ceiling.fill("200"); await amount.fill("99");
          assert.equal(await dialog.getByRole("button", { name: "Place bid", exact: true }).isDisabled(), true);
          await amount.fill("5"); await ceiling.fill("4"); assert.equal(await dialog.getByRole("button", { name: "Place bid", exact: true }).isDisabled(), true);
          await ceiling.fill("10"); assert.equal(await dialog.getByRole("button", { name: "Place bid", exact: true }).isEnabled(), true);
        }
      }
      if (scenario.view === "game") {
        await page.locator(".hub-week-forecast").waitFor();
        await page.getByRole("button", { name: "Lineup", exact: true }).click();
        assert.match(await page.locator("main").innerText(), /Brandon Aubrey/); assert.match(await page.locator("main").innerText(), /Baltimore Ravens/);
        assert.equal(await page.locator(".gc-room-lineup-player").count() >= 3, true);
        await page.getByRole("button", { name: "Matchup", exact: true }).click();
        assert.equal(await page.locator(".gc-room-position-strip button").count(), 3);
        assert.equal(await page.locator(".gc-room-duel").filter({ hasText: "Empty slot" }).count(), 2);
        await page.getByText("Scoring & weekly extras", { exact: true }).click();
        await page.locator(".league-scoring-control summary").click();
        assert.equal(await page.getByRole("button", { name: "Calculate week", exact: true }).count(), scenario.host === "native" ? 1 : 0);
        if (scenario.host === "native") assert.equal(await page.getByRole("button", { name: "Calculate week", exact: true }).isDisabled(), true);
        if (scenario.state === "pending") assert.match(await page.locator(".league-scoring-control").innerText(), /final|statistics/i);
        if (scenario.state === "error") assert.match(await page.locator("main").innerText(), /unavailable|complete statistics|Missing required/i);
      }
      const audit = await page.evaluate(measureScript(), { minTarget: width === 390 ? 44 : 32, numericRe: NUMERIC_RE.source, barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX, columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.deepEqual(errors, []); assert.deepEqual(apiRequests, []);
      const path = `${folder}/${name}.png`; await page.screenshot({ path, fullPage: true });
      if (scenario.view === "agents" && scenario.format === "salary" && !scenario.state) {
        await page.getByRole("dialog").getByRole("button", { name: "Place bid", exact: true }).click();
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        const write = (await page.evaluate(() => window.fixtureWrites))[0];
        assert.equal(write.path, "/api/hub/fa-market/bid"); assert.equal(write.body.bid_amount, 5);
      }
      reports.push({ ...scenario, width, path, functional: true, audit, errors }); console.log(name, JSON.stringify(audit.filter(r => !r.ok)));
    } catch (error) {
      const path = `${folder}/${name}-failure.png`; await page.screenshot({path, fullPage:true});
      reports.push({...scenario,width,path,functional:false,error:error.message,errors}); console.log(name,"FUNCTIONAL FAIL",error.message);
    } finally { await page.close(); }
  }
  assert.ok(reports.every(r => r.functional), "Every functional scenario must pass");
  assert.ok(reports.every(r => r.audit.every(row => row.ok)), "Every layout check must pass");
} finally { await browser?.close(); await server.close(); await fs.writeFile(`${folder}/report.json`, JSON.stringify(reports, null, 2)); }
