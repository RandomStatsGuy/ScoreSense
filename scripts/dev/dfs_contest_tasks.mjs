// Real production components, workers and actual-engine synthetic responses.
// Requests are intercepted inside this browser; no user account or server is used.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachDfsFixture } from "./dfs_fixture_runtime.mjs";
import { readPortfolioBackup } from "../../frontend/src/dfsPortfolioBackup.js";
import { DFS_CONTEST_COPY as C, DFS_SHARED_OUTCOMES_COPY as S,
  DFS_PORTFOLIO_COPY as P } from "../../frontend/src/dfsToolPresentation.js";
import { measureScript, minTargetForWidth, NUMERIC_RE, BAR_CONTROL_SELECTOR,
  TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "outputs/dfs-contest-production");
const require = createRequire(path.join(root, "frontend/package.json"));
const { chromium } = require("playwright");
const fixture = JSON.parse(await readFile(path.join(root, "frontend/test-fixtures/dfs-contest-data.json"), "utf8"));
const shared = JSON.parse(await readFile(path.join(root, "frontend/test-fixtures/dfs-shared-data.json"), "utf8"));
const report = { synthetic: true, productionComponents: true, actualEngineResponses: true,
  liveAccountOrPlatformVerified: false, cases: [], guards: [], supplements: [] };
const canonicalPool = rows => [...rows].sort((a, b) => a.player_id.localeCompare(b.player_id));

async function setup(browser, width, theme) {
  const context = await browser.newContext({ viewport: { width, height: 960 }, acceptDownloads: true,
    colorScheme: theme, reducedMotion: "reduce", serviceWorkers: "block" });
  const blocked = [], errors = [], workers = [];
  await context.route("**/*", route => { blocked.push(route.request().url()); return route.abort("blockedbyclient"); });
  await context.addInitScript(value => localStorage.setItem("scoresense-color-theme", value), theme);
  await attachDfsFixture(context);
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("worker", worker => workers.push(worker.url()));
  await page.goto("http://127.0.0.1:5173/test-fixtures/dfs-portfolio.html?shared");
  await page.getByTestId("dfs-generate").waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
  assert.equal(await page.locator("main#main-content").count(), 1);
  return { page, context, errors, blocked, workers };
}
async function disclosure(page, id, open = true) {
  const section = page.getByTestId(id);
  if (await section.evaluate(element => element.open) !== open) await section.locator(":scope > summary").click();
  return section;
}
async function go(page, stage) {
  await page.getByTestId(`dfs-flow-${stage}`).click();
  await page.waitForFunction(stage => document.querySelector(`[data-testid="dfs-flow-${stage}"]`)?.getAttribute("aria-current") === "step", stage);
}
async function showAncestors(locator) {
  await locator.evaluate(element => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement)
      if (parent.tagName === "DETAILS") parent.open = true;
  });
}
async function download(page, label, filename, scope = page) {
  const button = scope.getByRole("button", { name: label, exact: true }).filter({ visible: true }).last();
  await showAncestors(button);
  const pending = page.waitForEvent("download", { timeout: 20000 }); pending.catch(() => {});
  await button.click();
  const file = path.join(output, filename); await (await pending).saveAs(file);
  return JSON.parse(await readFile(file, "utf8"));
}
async function backup(page, filename) {
  const save = page.getByRole("button", { name: "Save this set", exact: true }).filter({ visible: true });
  if (await save.count()) await save.click();
  await disclosure(page, "dfs-recovery");
  const button = page.getByRole("button", { name: P.backup, exact: true }).filter({ visible: true }).last();
  await showAncestors(button);
  const portable = await download(page, P.backup, filename);
  await disclosure(page, "dfs-recovery", false);
  return readPortfolioBackup(JSON.stringify(portable));
}
async function audit(page, width, theme, state) {
  const measures = await page.evaluate(measureScript(), { minTarget: minTargetForWidth(width), numericRe: NUMERIC_RE.source,
    barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX,
    columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  await writeFile(path.join(output, `layout-${width}-${theme}-${state}.json`), JSON.stringify(measures, null, 2));
  assert.equal(overflow, false, `${width}/${theme}/${state} overflow`);
  assert.deepEqual(measures.filter(row => !row.ok), [], `${width}/${theme}/${state} layout`);
  return { state, overflow, measures };
}
async function screenshot(page, width, theme, state) {
  if (![390, 1280].includes(width)) return;
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, `${state}-${width}-${theme}.png`), fullPage: true });
  if (state.startsWith("contest")) await page.getByTestId("dfs-contest-research").screenshot({ path: path.join(output, `panel-${state === "contest" ? "" : "details-"}${width}-${theme}.png`) });
}
async function buildAndSelectGames(page) {
  await page.getByRole("spinbutton", { name: "Lineups", exact: true }).fill("2");
  await page.getByTestId("dfs-generate").click(); await page.getByText("Built 2 lineups.", { exact: true }).waitFor();
  await go(page, "review");
  await disclosure(page, "dfs-research");
  const panel = await disclosure(page, "dfs-shared-review");
  await panel.getByLabel(S.file, { exact: true }).setInputFiles({ name: "synthetic-games.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(shared.engine_inputs.bank)) });
  await panel.getByRole("button", { name: S.preview, exact: true }).click();
  await panel.getByRole("button", { name: S.use, exact: true }).click();
  const contest = await disclosure(page, "dfs-contest-research");
  assert.equal(await contest.getByLabel(C.file, { exact: true }).isDisabled(), false);
  return contest;
}
async function upload(panel, value = fixture.file, name = "synthetic-contest.json") {
  await panel.getByLabel(C.file, { exact: true }).setInputFiles({ name, mimeType: "application/json",
    buffer: Buffer.from(typeof value === "string" ? value : JSON.stringify(value)) });
}
async function previewAndSelect(panel) {
  await panel.getByRole("button", { name: C.preview, exact: true }).click();
  await panel.getByRole("button", { name: C.use, exact: true }).click();
  await panel.getByText(C.ready, { exact: true }).waitFor();
}
async function compare(panel) {
  await panel.getByRole("button", { name: C.compare, exact: true }).click();
  await panel.getByTestId("dfs-contest-results").waitFor();
}
function exactRequest(request) {
  assert.deepEqual(request.context, shared.engine_inputs.context);
  assert.deepEqual(canonicalPool(request.pool), canonicalPool(shared.engine_inputs.pool));
  assert.deepEqual(request.bank, shared.engine_inputs.bank);
  assert.deepEqual(request.contest_field, fixture.file.contest_field);
  assert.deepEqual(request.payout_contract, fixture.file.payout_contract);
  if (request.lineups) {
    assert.equal(request.seed, 0); assert.equal(request.draw_count, 128); assert.equal(request.top_k, 10);
    assert.equal(request.bank_id, shared.summary.content_id); assert.equal(request.contest_research_id, fixture.summary.content_id);
    assert.match(request.input_snapshot_id, /^scenario:/);
    assert.deepEqual(request.lineups.map(row => ({ lineup_id: row.lineup_id, player_ids: [...row.player_ids].sort() })),
      shared.engine_inputs.lineups.map((row, i) => ({ lineup_id: `current:${i}`, player_ids: [...row.player_ids].sort() })));
  }
}
function exactDownload(portable, request) {
  assert.deepEqual(portable.report, { ...fixture.evaluation, input_snapshot_id: request.input_snapshot_id });
  assert.deepEqual(portable.assumptions, fixture.summary);
  assert.equal(portable.snapshot.input_snapshot_id, request.input_snapshot_id);
  assert.equal(portable.report.capabilities.expected_payout, false);
  assert.equal(portable.report.capabilities.ownership_calibrated, false);
  assert.equal(portable.report.opponent_entry_count + portable.report.own_entry_count, fixture.file.payout_contract.entrant_count);
  const serialized = JSON.stringify(portable);
  for (const key of ["templates", "ownership", "events", "bank"])
    assert.equal(serialized.includes(`"${key}":`), false, `${key} raw source data omitted`);
  assert.equal(portable.assumptions.field.sources[0].rights.redistribution, false);
}
async function failure(page, name, error, session) {
  await writeFile(path.join(output, `failure-${name}.txt`), `${error.stack}\n\n${await page.locator("body").innerText()}\n\n${JSON.stringify({ errors: session.errors, blocked: session.blocked })}`);
  await page.screenshot({ path: path.join(output, `failure-${name}.png`), fullPage: true });
}
async function mainCase(browser, width, theme) {
  const session = await setup(browser, width, theme), { page, context, errors, blocked, workers } = session;
  const audits = [];
  try {
    for (const id of ["dfs-choose-players", "dfs-advanced", "dfs-research", "dfs-recovery", "dfs-shared-review", "dfs-contest-research"])
      assert.equal(await page.getByTestId(id).evaluate(element => element.open), false, `${id} initially closed`);
    audits.push(await audit(page, width, theme, "build")); await screenshot(page, width, theme, "build");
    const panel = await buildAndSelectGames(page);
    const original = await backup(page, `history-before-${width}-${theme}.json`);
    await upload(panel); await previewAndSelect(panel);
    exactRequest(await page.evaluate(() => window.__portfolioFixture.contestPreviewRequests.at(-1)));
    await compare(panel);
    const request = await page.evaluate(() => window.__portfolioFixture.contestEvaluateRequests.at(-1)); exactRequest(request);
    const portable = await download(page, C.download, `contest-${width}-${theme}.json`, panel); exactDownload(portable, request);
    assert.ok(workers.some(url => url.endsWith("dfsContestResearch.worker.js")), "Actual contest worker used");
    const headings = await panel.getByTestId("dfs-contest-results").locator("h4").allTextContents();
    assert.deepEqual(headings, fixture.evaluation.assumptions.map(row => `${row.provider} · ${row.scenario_id}`));
    assert.notDeepEqual(fixture.file.contest_field.scenarios.map(row => row.scenario_id), fixture.evaluation.assumptions.map(row => row.scenario_id), "Unsorted source assumptions exercise identity joins");
    audits.push(await audit(page, width, theme, "contest")); await screenshot(page, width, theme, "contest");
    if (width === 320 || (width === 390 && theme === "dark") || (width === 1280 && theme === "light")) {
      const parentPanel = page.getByTestId("dfs-shared-review");
      await parentPanel.locator(":scope > details > summary").filter({ hasText: new RegExp(`^${RegExp.escape(S.settings)}$`) }).click();
      for (const label of [C.settings, C.details, C.moreResults]) {
        const summary = panel.locator("summary").filter({ hasText: new RegExp(`^${RegExp.escape(label)}$`) }).first();
        await summary.click();
      }
      await panel.getByRole("spinbutton", { name: C.topK, exact: true }).waitFor();
      assert.equal(await panel.getByRole("spinbutton", { name: C.topK, exact: true }).inputValue(), "10");
      assert.equal(await panel.getByRole("button", { name: /^Draws:/ }).isVisible(), true);
      for (const source of fixture.summary.field.sources)
        await panel.getByText(source.content_sha256, { exact: true }).waitFor();
      for (const row of fixture.summary.field.scenarios) {
        const article = panel.locator("article").filter({ hasText: `${row.provider} · ${row.scenario_id}` });
        await article.getByText(C.audience(row.ownership_contest_type), { exact: true }).waitFor();
        const gap = row.ownership_consistency.mean_absolute_fraction_gap;
        await article.getByText(Number.isFinite(gap) ? `${(gap * 100).toFixed(1)}%` : "—", { exact: true }).waitFor();
      }
      await panel.getByText(C.roundingLabel(fixture.summary.payout_contract.tie_policy.rounding), { exact: true }).waitFor();
      const measurements = await audit(page, width, theme, "contest-details");
      assert.equal(measurements.measures.filter(row => row.rule === "control-rows" && row.selector.includes("dfw-control-fields")).length, 2,
        "Both shared-game and contest settings have measured aligned field rows");
      await screenshot(page, width, theme, "contest-details");
      report.supplements.push({ width, theme, passed: true, check: "opened settings, payout and method/source details",
        settingsReachable: true, bothSettingsRowsMeasured: true, sourceHashesShown: true, audienceAndOwnershipGapShown: true, measurements });
    }
    assert.deepEqual((await backup(page, `history-after-${width}-${theme}.json`)).batches, original.batches);
    assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
    report.cases.push({ width, theme, passed: true, exactEngineRequestAndDownload: true, actualWorkerObserved: true,
      rawSourcesOmitted: true, originalHistoryUnchanged: true, unsortedAssumptionsJoinedById: true, audits });
    console.log(`PASS contest ${width} ${theme}: compact closed Build, explicit selection, exact conditional engine output and unchanged history`);
  } catch (error) { await failure(page, `${width}-${theme}`, error, session); throw error; }
  finally { await context.close(); }
}
async function guards(browser) {
  const session = await setup(browser, 390, "dark"), { page, context, errors, blocked } = session;
  try {
    const panel = await buildAndSelectGames(page); await upload(panel); await previewAndSelect(panel); await compare(panel);
    const request = await page.evaluate(() => window.__portfolioFixture.contestEvaluateRequests.at(-1));
    const baseline = await download(page, C.download, "guards-baseline.json", panel); exactDownload(baseline, request);
    const before = await page.evaluate(() => window.__portfolioFixture.contestPreviewRequests.length);
    const denied = structuredClone(fixture.file); denied.contest_field.sources[0].rights.hosted_ingestion = false;
    await upload(panel, denied, "denied-rights.json"); await panel.getByRole("alert").filter({ hasText: C.rightsError }).waitFor();
    assert.equal(await page.evaluate(() => window.__portfolioFixture.contestPreviewRequests.length), before);
    assert.deepEqual((await download(page, C.download, "guards-denied.json", panel)).report, baseline.report);
    await upload(panel, '{"contest_field":1,"contest_field":2}', "duplicate-json.json");
    await panel.getByRole("alert").filter({ hasText: /repeated|duplicate/i }).waitFor();
    assert.equal(await page.evaluate(() => window.__portfolioFixture.contestPreviewRequests.length), before);
    assert.deepEqual((await download(page, C.download, "guards-invalid.json", panel)).report, baseline.report);
    await upload(panel, fixture.file, "new-valid-file.json");
    await panel.getByText("new-valid-file.json", { exact: true }).waitFor();
    assert.equal(await panel.getByRole("button", { name: C.compare, exact: true }).count(), 0, "New admitted file clears chosen assumptions");
    await panel.getByText(C.previous, { exact: true }).waitFor();
    assert.deepEqual((await download(page, C.download, "guards-new-file.json", panel)).report, baseline.report);
    await previewAndSelect(panel);
    await page.evaluate(() => { window.__portfolioFixture.failContestEvaluate = true; });
    await panel.getByRole("button", { name: C.compare, exact: true }).click();
    await panel.getByRole("alert").filter({ hasText: "Synthetic contest research failure" }).waitFor();
    assert.deepEqual((await download(page, C.download, "guards-failed.json", panel)).report, baseline.report);
    await page.evaluate(() => Object.assign(window.__portfolioFixture, { failContestEvaluate: false, mismatchContestEvaluate: true }));
    await panel.getByRole("button", { name: C.compare, exact: true }).click(); await panel.getByRole("alert").filter({ hasText: C.responseError }).waitFor();
    assert.deepEqual((await download(page, C.download, "guards-mismatch.json", panel)).report, baseline.report);
    await page.evaluate(() => Object.assign(window.__portfolioFixture, { mismatchContestEvaluate: false, delayContestEvaluate: true, ignoreContestEvaluateAbort: true }));
    await panel.getByRole("button", { name: C.compare, exact: true }).click();
    await page.waitForFunction(() => typeof window.__portfolioFixture.releaseContestEvaluate === "function");
    await page.waitForFunction(() => /Comparing scenarios… [1-9]\d*s/.test(document.querySelector('[data-testid="dfs-contest-research"] [role="status"]')?.textContent || ""));
    await panel.getByRole("button", { name: C.cancel, exact: true }).click();
    await page.evaluate(() => window.__portfolioFixture.releaseContestEvaluate());
    assert.deepEqual((await download(page, C.download, "guards-cancelled.json", panel)).report, baseline.report);
    await page.evaluate(() => { window.__portfolioFixture.delayContestEvaluate = false; });
    const settings = panel.locator("summary").filter({ hasText: new RegExp(`^${RegExp.escape(C.settings)}$`) });
    await settings.click();
    await panel.getByRole("spinbutton", { name: C.topK, exact: true }).fill("11");
    assert.equal(await panel.getByRole("button", { name: C.compare, exact: true }).isDisabled(), true);
    await panel.getByText(C.stale, { exact: true }).waitFor();
    assert.deepEqual((await download(page, C.download, "guards-stale.json", panel)).report, baseline.report);
    await panel.getByRole("spinbutton", { name: C.topK, exact: true }).fill("10");
    await page.evaluate(() => { window.__portfolioFixture.sharedAccessStatus = 403; });
    await panel.getByRole("button", { name: C.compare, exact: true }).click();
    await panel.getByRole("alert").filter({ hasText: /access denied/ }).waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event("scoresense-auth-changed")));
    await page.waitForFunction(() => !document.querySelector('[data-testid="dfs-contest-results"]'));
    assert.equal(await panel.getByLabel(C.file, { exact: true }).isDisabled(), true);
    assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
    report.guards.push({ width: 390, theme: "dark", passed: true, checks: ["denied rights rejected before API", "invalid import keeps previous review",
      "new valid file clears selection and labels retained review as earlier", "backend failure retains review", "mismatched response rejected",
      "elapsed work status advances", "cancel discards late response", "changed settings stale selection", "denied account access", "account change clears review"] });
    console.log("PASS contest guards: rights/import/failure/mismatch/cancel/stale/account isolation");
  } catch (error) { await failure(page, "guards", error, session); throw error; }
  finally { await context.close(); }
}

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, downloadsPath: path.join(output, "browser-downloads") });
try {
  const cases = process.argv.includes("--smoke") ? [[390, "dark"]] : [390, 1280, 320].flatMap(width => ["dark", "light"].map(theme => [width, theme]));
  for (const [width, theme] of cases) await mainCase(browser, width, theme);
  if (!process.argv.includes("--smoke")) await guards(browser);
} finally {
  await browser.close(); await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
}
