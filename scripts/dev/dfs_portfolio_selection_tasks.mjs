// Isolated production components and workers with actual-engine synthetic responses.
// No network account, running application, provider or live entry is contacted.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachDfsFixture } from "./dfs_fixture_runtime.mjs";
import { DFS_CONTEST_PORTFOLIO_COPY as C, DFS_CONTEST_COPY as F, DFS_SHARED_OUTCOMES_COPY as S } from "../../frontend/src/dfsToolPresentation.js";
import { measureScript, minTargetForWidth, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "outputs/dfs-contest-portfolio-production");
const require = createRequire(path.join(root, "frontend/package.json")), { chromium } = require("playwright");
const fixture = JSON.parse(await readFile(path.join(root, "frontend/test-fixtures/dfs-contest-portfolio-data.json"), "utf8"));
const shared = JSON.parse(await readFile(path.join(root, "frontend/test-fixtures/dfs-shared-data.json"), "utf8"));
const receipt = { synthetic: true, productionComponents: true, actualEngineResponses: true, liveAccountOrPlatformVerified: false, cases: [], guards: [], supplements: [] };
const clone = value => structuredClone(value);
async function setup(browser, width, theme) {
  const context = await browser.newContext({ viewport: { width, height: 960 }, acceptDownloads: true, colorScheme: theme, reducedMotion: "reduce", serviceWorkers: "block" });
  const blocked = [], errors = [], workers = [];
  await context.route("**/*", route => { blocked.push(route.request().url()); return route.abort("blockedbyclient"); });
  await context.addInitScript(value => localStorage.setItem("scoresense-color-theme", value), theme);
  await attachDfsFixture(context); const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message)); page.on("worker", worker => workers.push(worker.url()));
  await page.goto("http://127.0.0.1:5173/test-fixtures/dfs-portfolio.html?shared"); await page.getByTestId("dfs-generate").waitFor();
  return { page, context, blocked, errors, workers };
}
async function disclosure(page, id, open = true) {
  const panel = page.getByTestId(id);
  if (await panel.evaluate(element => element.open) !== open) await panel.locator(":scope > summary").click();
  return panel;
}
async function audit(page, width, theme, state) {
  const measures = await page.evaluate(measureScript(), { minTarget: minTargetForWidth(width), numericRe: NUMERIC_RE.source,
    barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX, columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  await writeFile(path.join(output, `layout-${width}-${theme}-${state}.json`), JSON.stringify(measures, null, 2));
  assert.equal(overflow, false, `${width}/${theme}/${state} overflow`);
  assert.deepEqual(measures.filter(row => !row.ok), [], `${width}/${theme}/${state} layout`);
  return { state, overflow, measures };
}
async function screenshot(page, width, theme, state) {
  if (![390, 1280].includes(width)) return;
  await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: path.join(output, `${state}-${width}-${theme}.png`), fullPage: true });
  if (state !== "build") await page.getByTestId("dfs-contest-portfolio").screenshot({ path: path.join(output, `panel-${state}-${width}-${theme}.png`) });
}
async function prepare(page) {
  await page.getByRole("spinbutton", { name: "Lineups", exact: true }).fill("2"); await page.getByTestId("dfs-generate").click();
  await page.getByText("Built 2 lineups.", { exact: true }).waitFor(); await page.getByTestId("dfs-flow-review").click();
  await disclosure(page, "dfs-research"); const games = await disclosure(page, "dfs-shared-review");
  await games.getByLabel(S.file, { exact: true }).setInputFiles({ name: "synthetic-games.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(shared.engine_inputs.bank)) });
  await games.getByRole("button", { name: S.preview, exact: true }).click(); await games.getByRole("button", { name: S.use, exact: true }).click();
  const contest = await disclosure(page, "dfs-contest-research");
  await contest.getByLabel(F.file, { exact: true }).setInputFiles({ name: "synthetic-contest.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture.contest_file)) });
  await contest.getByRole("button", { name: F.preview, exact: true }).click(); await contest.getByRole("button", { name: F.use, exact: true }).click();
  await contest.getByText(F.ready, { exact: true }).waitFor();
  assert.equal(await page.getByTestId("dfs-contest-portfolio").evaluate(element => element.open), false);
  const panel = await disclosure(page, "dfs-contest-portfolio");
  assert.equal(await panel.getByRole("button", { name: C.select, exact: true }).isDisabled(), true);
  const assumption = fixture.contest_file.contest_field.scenarios.find(row => row.scenario_id === fixture.settings.scenario_id);
  await pick(panel, C.assumption, `${assumption.provider} · ${assumption.scenario_id}`);
  return panel;
}
async function pick(panel, label, option) {
  await panel.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  await panel.getByRole("option", { name: option, exact: true }).click();
}
async function compare(panel) {
  const previous = await panel.page().evaluate(() => window.__portfolioFixture.contestSelectRequests.length);
  await panel.getByRole("button", { name: C.select, exact: true }).click();
  await panel.page().waitForFunction(([previous, running]) => window.__portfolioFixture.contestSelectRequests.length > previous &&
    !document.querySelector('[data-testid="dfs-contest-portfolio-status"]').textContent.includes(running), [previous, C.running]);
  await panel.getByTestId("dfs-contest-portfolio-results").waitFor();
  await panel.getByText(C.optimal, { exact: false }).waitFor();
}
async function history(page) {
  return page.evaluate(() => JSON.stringify({ builds: window.__portfolioFixture.builds, imports: window.__portfolioFixture.imports,
    saves: window.__portfolioFixture.saveAttempts, local: Object.entries(localStorage).filter(([key]) => key.includes("dfs")) }));
}
async function download(page, panel, filename) {
  const pending = page.waitForEvent("download"); await panel.getByRole("button", { name: C.download, exact: true }).click();
  const target = path.join(output, filename); await (await pending).saveAs(target); return JSON.parse(await readFile(target, "utf8"));
}
function exactDownload(value, request) {
  const expected = { ...clone(fixture.evaluations[request.objective]), input_snapshot_id: request.input_snapshot_id, selection_request_id: request.selection_request_id };
  assert.deepEqual(value.report, expected); assert.equal(value.snapshot.input_snapshot_id, request.input_snapshot_id);
  assert.equal(value.report.capabilities.expected_payout, false); assert.equal(value.report.selected_lineups.length, 1);
  const raw = JSON.stringify(value); for (const key of ["bank", "templates", "ownership", "events"]) assert.equal(raw.includes(`"${key}":`), false, `${key} omitted`);
}
async function failure(session, label, error) {
  await writeFile(path.join(output, `failure-${label}.txt`), `${error.stack}\n\n${await session.page.locator("body").innerText()}\n\n${JSON.stringify({ errors: session.errors, blocked: session.blocked })}`);
  await session.page.screenshot({ path: path.join(output, `failure-${label}.png`), fullPage: true });
}
await mkdir(output, { recursive: true }); const browser = await chromium.launch({ headless: true });
try {
  for (const width of [320, 390, 768, 1280, 1440]) for (const theme of ["dark", "light"]) {
    const session = await setup(browser, width, theme), { page } = session;
    try {
      const states = [await audit(page, width, theme, "build")]; await screenshot(page, width, theme, "build");
      const panel = await prepare(page), before = await history(page); await compare(panel);
      states.push(await audit(page, width, theme, "proposal")); await screenshot(page, width, theme, "proposal");
      const request = await page.evaluate(() => window.__portfolioFixture.contestSelectRequests.at(-1));
      exactDownload(await download(page, panel, `proposal-${width}-${theme}.json`), request);
      assert.equal(await history(page), before); assert.deepEqual(session.errors, []); assert.deepEqual(session.blocked, []);
      assert.ok(session.workers.some(url => url.includes("dfsContestPortfolio.worker.js")));
      if ([390, 1280].includes(width)) {
        await pick(panel, C.goal, C.goals[1].label);
        const risk = await disclosure(page, "dfs-contest-portfolio-risk"); await compare(panel);
        await disclosure(page, "dfs-contest-portfolio-rosters");
        await panel.getByText(C.roster, { exact: true }).click();
        await disclosure(page, "dfs-contest-portfolio-method");
        const detailState = await audit(page, width, theme, "details"); receipt.supplements.push({ width, theme, ...detailState });
        await screenshot(page, width, theme, "details"); assert.equal(await history(page), before);
        assert.equal(await risk.evaluate(element => element.open), true);
      }
      receipt.cases.push({ width, theme, states, defaultClosed: true, exactPersonalDownload: true, historyUnchanged: true, realWorker: true });
    } catch (error) { await failure(session, `${width}-${theme}`, error); throw error; }
    finally { await session.context.close(); }
  }
  const session = await setup(browser, 390, "dark"), { page } = session;
  try {
    const panel = await prepare(page); await compare(panel); const before = await history(page);
    const original = await panel.getByTestId("dfs-contest-portfolio-results").innerText();
    await page.evaluate(() => window.__portfolioFixture.failContestSelect = true);
    await panel.getByRole("button", { name: C.select, exact: true }).click(); await panel.getByRole("alert").filter({ hasText: "Last proposal retained" }).waitFor();
    assert.equal(await panel.getByTestId("dfs-contest-portfolio-results").innerText(), original); receipt.guards.push("failed request retains proposal");
    await page.evaluate(() => { window.__portfolioFixture.failContestSelect = false; window.__portfolioFixture.mismatchContestSelect = true; });
    await panel.getByRole("button", { name: C.select, exact: true }).click(); await panel.getByRole("alert").filter({ hasText: C.responseError }).waitFor();
    assert.equal(await panel.getByTestId("dfs-contest-portfolio-results").innerText(), original); receipt.guards.push("mismatched response retains proposal");
    await page.evaluate(() => window.__portfolioFixture.mismatchContestSelect = false);
    await panel.getByLabel(C.count, { exact: true }).fill("2"); await panel.getByRole("button", { name: C.select, exact: true }).click();
    await panel.getByRole("alert").waitFor(); await panel.getByText(C.previous, { exact: true }).waitFor();
    assert.equal(await panel.getByTestId("dfs-contest-portfolio-results").innerText(), original); receipt.guards.push("actual infeasible search returns no partial proposal");
    await panel.getByLabel(C.count, { exact: true }).fill("1");
    for (const goal of C.goals) {
      await pick(panel, C.goal, goal.label); await compare(panel);
      const request = await page.evaluate(() => window.__portfolioFixture.contestSelectRequests.at(-1));
      exactDownload(await download(page, panel, `goal-${goal.id}.json`), request);
    }
    receipt.guards.push("all three goals match actual engine output");
    const retainedObjective = C.goals.at(-1).id;
    await pick(panel, C.goal, C.goals[1].label);
    await page.evaluate(() => { window.__portfolioFixture.delayContestSelect = true; window.__portfolioFixture.ignoreContestSelectAbort = true; });
    await panel.getByRole("button", { name: C.select, exact: true }).click();
    await page.waitForFunction(() => typeof window.__portfolioFixture.releaseContestSelect === "function");
    await page.waitForTimeout(1100); assert.match(await panel.getByTestId("dfs-contest-portfolio-status").innerText(), /[1-9]\d*s elapsed/);
    receipt.guards.push("elapsed status is visible");
    await panel.getByRole("button", { name: C.cancel, exact: true }).click();
    await page.evaluate(() => { window.__portfolioFixture.delayContestSelect = false; window.__portfolioFixture.releaseContestSelect(); });
    await page.waitForTimeout(100); await panel.getByText(C.cancelled, { exact: true }).waitFor();
    assert.equal((await download(page, panel, "after-cancel.json")).report.objective.mode, retainedObjective);
    receipt.guards.push("cancel discards late response");
    await page.evaluate(() => { window.__portfolioFixture.delayContestSelect = true; });
    const previousRequests = await page.evaluate(() => window.__portfolioFixture.contestSelectRequests.length);
    await panel.getByRole("button", { name: C.select, exact: true }).click();
    await page.waitForFunction(previous => window.__portfolioFixture.contestSelectRequests.length > previous && typeof window.__portfolioFixture.releaseContestSelect === "function", previousRequests);
    await panel.getByLabel(C.count, { exact: true }).fill("2"); await page.evaluate(() => { window.__portfolioFixture.delayContestSelect = false; window.__portfolioFixture.releaseContestSelect(); });
    await page.waitForTimeout(100); await panel.getByText(C.previous, { exact: true }).waitFor();
    assert.equal((await download(page, panel, "after-stale.json")).report.objective.mode, retainedObjective);
    receipt.guards.push("changed settings stale and discard late response");
    await panel.getByLabel(C.count, { exact: true }).fill("1");
    await page.evaluate(() => window.__portfolioFixture.sharedAccessStatus = 403); await panel.getByRole("button", { name: C.select, exact: true }).click();
    await panel.getByRole("alert").filter({ hasText: "account access denied" }).waitFor(); receipt.guards.push("denied account returns no new proposal");
    await page.evaluate(() => window.dispatchEvent(new Event("scoresense-auth-changed")));
    assert.equal(await panel.getByTestId("dfs-contest-portfolio-results").count(), 0); assert.equal(await panel.getByRole("button", { name: C.download, exact: true }).count(), 0);
    receipt.guards.push("account change clears result and download");
    assert.equal(await history(page), before); assert.deepEqual(session.errors, []); assert.deepEqual(session.blocked, []);
  } catch (error) { await failure(session, "guards", error); throw error; }
  finally { await session.context.close(); }
  await writeFile(path.join(output, "browser-verification.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ status: "PASS", cases: receipt.cases.length, layoutStates: receipt.cases.reduce((sum, row) => sum + row.states.length, 0), supplements: receipt.supplements.length, guards: receipt.guards.length, output }));
} finally { await browser.close(); }
