// Production UI and workers; intercepted synthetic responses computed by the Python planner.
// No live account, provider, entry or running app server is contacted.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachDfsFixture } from "./dfs_fixture_runtime.mjs";
import { DFS_LATE_SWAP_COPY as C } from "../../frontend/src/dfsToolPresentation.js";
import { measureScript, minTargetForWidth, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."), output = path.join(root, "outputs/dfs-late-swap-production");
const require = createRequire(path.join(root, "frontend/package.json")), { chromium } = require("playwright");
const fixture = JSON.parse(await readFile(path.join(root, "frontend/test-fixtures/dfs-late-swap-data.json"), "utf8"));
const receipt = { synthetic: true, productionComponents: true, actualEngineResponses: true, liveAccountOrPlatformVerified: false, cases: [], guards: [] };
async function setup(browser, width, theme) {
  const context = await browser.newContext({ viewport: { width, height: 960 }, acceptDownloads: true, colorScheme: theme, reducedMotion: "reduce", serviceWorkers: "block" });
  const blocked = [], errors = [], workers = [], downloads = [];
  await context.route("**/*", route => { blocked.push(route.request().url()); return route.abort("blockedbyclient"); });
  await context.addInitScript(value => localStorage.setItem("scoresense-color-theme", value), theme);
  await attachDfsFixture(context); const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message)); page.on("worker", worker => workers.push(worker.url())); page.on("download", download => downloads.push(download.suggestedFilename()));
  await page.goto("http://127.0.0.1:5173/test-fixtures/dfs-portfolio.html?late-swap"); await page.getByTestId("dfs-generate").waitFor();
  await page.getByRole("spinbutton", { name: "Lineups", exact: true }).fill("2"); await page.getByTestId("dfs-generate").click();
  await page.getByText("Built 2 lineups.", { exact: true }).waitFor(); await page.getByTestId("dfs-flow-download").click();
  return { page, context, blocked, errors, workers, downloads };
}
async function open(page, testId) {
  const panel = page.getByTestId(testId); if (!await panel.evaluate(element => element.open)) await panel.locator(":scope > summary").click(); return panel;
}
async function importSnapshot(panel, value = fixture.package) {
  await panel.getByLabel(C.file, { exact: true }).setInputFiles({ name: "synthetic-late-swap.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) });
  await panel.page().waitForFunction(reading => !document.querySelector('[data-testid="dfs-late-swap-status"]').textContent.includes(reading), C.reading);
}
async function prepare(page) {
  const panel = await open(page, "dfs-late-swap"); await importSnapshot(panel);
  await panel.getByRole("button", { name: C.preview, exact: true }).click(); await panel.getByRole("button", { name: C.use, exact: true }).click();
  await panel.getByText(C.ready, { exact: true }).waitFor(); return panel;
}
async function compare(panel) {
  await panel.getByRole("button", { name: C.compare, exact: true }).click(); await panel.getByTestId("dfs-late-swap-results").waitFor();
  await panel.getByRole("button", { name: C.download, exact: true }).waitFor();
}
async function audit(page, width, theme, state) {
  const measures = await page.evaluate(measureScript(), { minTarget: minTargetForWidth(width), numericRe: NUMERIC_RE.source,
    barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX, columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  await writeFile(path.join(output, `layout-${width}-${theme}-${state}.json`), JSON.stringify(measures, null, 2));
  assert.equal(overflow, false, `${width}/${theme}/${state} overflow`); assert.deepEqual(measures.filter(row => !row.ok), [], `${width}/${theme}/${state} layout`);
  return { state, overflow, measures };
}
async function screenshot(page, width, theme, state) {
  if (![390, 1280].includes(width)) return;
  await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: path.join(output, `${state}-${width}-${theme}.png`), fullPage: true });
  if (state !== "closed") await page.getByTestId("dfs-late-swap").screenshot({ path: path.join(output, `panel-${state}-${width}-${theme}.png`) });
}
const history = page => page.evaluate(() => JSON.stringify({ builds: window.__portfolioFixture.builds, imports: window.__portfolioFixture.imports,
  saves: window.__portfolioFixture.saveAttempts, local: Object.entries(localStorage).filter(([key]) => key.includes("dfs")) }));
async function download(page, panel, filename) {
  const pending = page.waitForEvent("download"); await panel.getByRole("button", { name: C.download, exact: true }).click();
  const target = path.join(output, filename); await (await pending).saveAs(target); const value = JSON.parse(await readFile(target, "utf8"));
  assert.deepEqual(value.package, fixture.package); assert.deepEqual(value.preview, fixture.preview); assert.deepEqual(value.report, fixture.report);
  assert.equal(Object.hasOwn(value, "csv"), false); return value;
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
      assert.equal(await page.getByTestId("dfs-late-swap").evaluate(element => element.open), false);
      const states = [await audit(page, width, theme, "closed")]; await screenshot(page, width, theme, "closed");
      const panel = await prepare(page), before = await history(page); await compare(panel);
      assert.equal(await panel.locator(".dfw-late-facts").evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length), 2, "snapshot facts retain two compact columns");
      states.push(await audit(page, width, theme, "proposal")); await screenshot(page, width, theme, "proposal");
      await download(page, panel, `plan-${width}-${theme}.json`); assert.equal(await history(page), before);
      assert.ok(session.workers.some(url => url.includes("dfsLateSwap.worker.js"))); assert.deepEqual(session.errors, []); assert.deepEqual(session.blocked, []);
      await open(page, "dfs-late-swap-rosters"); await panel.getByTestId("dfs-late-swap-rosters").locator("li details").first().locator("summary").click();
      await open(page, "dfs-late-swap-method");
      states.push(await audit(page, width, theme, "details")); await screenshot(page, width, theme, "details");
      assert.ok(await panel.getByText(C.lockedLabel, { exact: false }).count());
      receipt.cases.push({ width, theme, states, defaultClosed: true, exactPersonalDownload: true, historyUnchanged: true, realWorker: true });
    } catch (error) { await failure(session, `${width}-${theme}`, error); throw error; }
    finally { await session.context.close(); }
  }
  const session = await setup(browser, 390, "dark"), { page } = session;
  try {
    const summary = page.getByTestId("dfs-late-swap").locator(":scope > summary"); await summary.focus(); await summary.press("Enter");
    assert.equal(await page.getByTestId("dfs-late-swap").evaluate(element => element.open), true); receipt.guards.push("keyboard disclosure opens");
    const panel = await prepare(page); await compare(panel); const before = await history(page), original = await panel.getByTestId("dfs-late-swap-results").textContent();
    assert.equal(await panel.getByTestId("dfs-late-swap-results").evaluate(element => document.activeElement === element), true); receipt.guards.push("completed result receives keyboard focus");
    for (const flag of ["failLateSwapPlan", "mismatchLateSwapPlan"]) {
      await page.evaluate(flag => window.__portfolioFixture[flag] = true, flag); await panel.getByRole("button", { name: C.compare, exact: true }).click();
      await panel.getByRole("alert").waitFor(); assert.equal(await panel.getByTestId("dfs-late-swap-results").textContent(), original);
      await page.evaluate(flag => window.__portfolioFixture[flag] = false, flag);
    }
    receipt.guards.push("failed and mismatched responses retain the previous plan");
    const previewCount = await page.evaluate(() => window.__portfolioFixture.lateSwapPreviewRequests.length);
    await importSnapshot(panel, fixture.blocked.unknown_lock.package); await panel.getByRole("alert").filter({ hasText: C.lockError }).waitFor();
    assert.equal(await page.evaluate(() => window.__portfolioFixture.lateSwapPreviewRequests.length), previewCount); receipt.guards.push("unknown lock blocked locally before upload");
    await importSnapshot(panel, fixture.blocked.locked_move.package); await panel.getByRole("button", { name: C.preview, exact: true }).click();
    await panel.getByRole("alert").filter({ hasText: fixture.blocked.locked_move.error }).waitFor(); assert.equal(await panel.getByTestId("dfs-late-swap-results").textContent(), original);
    receipt.guards.push("actual-engine locked WR to FLEX rejection retains prior plan");
    await importSnapshot(panel); await panel.getByRole("button", { name: C.preview, exact: true }).click(); await panel.getByRole("button", { name: C.use, exact: true }).click();
    await page.evaluate(() => { window.__portfolioFixture.delayLateSwapPlan = true; window.__portfolioFixture.ignoreLateSwapPlanAbort = true; });
    await panel.getByRole("button", { name: C.compare, exact: true }).click(); await page.waitForFunction(() => typeof window.__portfolioFixture.releaseLateSwapPlan === "function");
    await page.waitForTimeout(1100); assert.match(await panel.getByTestId("dfs-late-swap-status").innerText(), /[1-9]\d*s elapsed/);
    await panel.getByRole("button", { name: C.cancel, exact: true }).click();
    await page.evaluate(() => { window.__portfolioFixture.delayLateSwapPlan = false; window.__portfolioFixture.releaseLateSwapPlan(); });
    await page.waitForTimeout(100); await panel.getByText(C.cancelled, { exact: true }).waitFor();
    assert.equal(await panel.getByTestId("dfs-late-swap-results").textContent(), original); receipt.guards.push("cancel ignores late response and shows elapsed time");
    const downloadCount = session.downloads.length;
    await page.evaluate(() => window.__portfolioFixture.accessStatus = 403); await panel.getByRole("button", { name: C.download, exact: true }).click();
    await panel.getByRole("alert").waitFor(); assert.equal(session.downloads.length, downloadCount); assert.equal(await panel.getByTestId("dfs-late-swap-results").textContent(), original);
    await page.evaluate(() => window.__portfolioFixture.accessStatus = 200); receipt.guards.push("fresh account access denial blocks personal download");
    await download(page, panel, "after-cancel.json"); assert.equal(await history(page), before);
    const previousRequests = await page.evaluate(() => window.__portfolioFixture.lateSwapPlanRequests.length);
    await page.evaluate(() => { window.__portfolioFixture.delayLateSwapPlan = true; });
    await panel.getByRole("button", { name: C.compare, exact: true }).click(); await page.waitForFunction(previous => window.__portfolioFixture.lateSwapPlanRequests.length > previous && typeof window.__portfolioFixture.releaseLateSwapPlan === "function", previousRequests);
    await page.getByRole("button", { name: /^Format:/ }).click(); await page.getByRole("option", { name: "DraftKings Showdown", exact: true }).click();
    await page.evaluate(() => { window.__portfolioFixture.delayLateSwapPlan = false; window.__portfolioFixture.releaseLateSwapPlan(); });
    await page.waitForTimeout(100); await panel.getByText(C.stale, { exact: true }).waitFor({ state: "attached" }); assert.equal(await panel.getByRole("button", { name: C.compare, exact: true, includeHidden: true }).isDisabled(), true);
    assert.equal(await panel.getByTestId("dfs-late-swap-results").textContent(), original); receipt.guards.push("changed format discards late response and blocks stale comparison");
    await page.evaluate(() => dispatchEvent(new CustomEvent("scoresense-auth-changed")));
    await panel.getByTestId("dfs-late-swap-results").waitFor({ state: "detached" }); assert.equal(await panel.getByRole("button", { name: C.download, exact: true, includeHidden: true }).count(), 0);
    receipt.guards.push("account change clears private accepted-entry inputs and plan");
    assert.deepEqual(session.errors, []); assert.deepEqual(session.blocked, []);
  } catch (error) { await failure(session, "guards", error); throw error; }
  finally { await session.context.close(); }
  await writeFile(path.join(output, "receipt.json"), JSON.stringify(receipt, null, 2)); process.stdout.write(JSON.stringify({ cases: receipt.cases.length, guards: receipt.guards, output }, null, 2));
} finally { await browser.close(); }
