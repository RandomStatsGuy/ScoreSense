// Real production components; all API responses are intercepted and synthetic.
// The declared Showdown results come from the Python optimizer, never a live account.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachDfsFixture } from "./dfs_fixture_runtime.mjs";
import { DFS_SHOWDOWN_COPY as C, DFS_GLOBAL_COPY as G, DFS_WORKSPACE_COPY as W } from "../../frontend/src/dfsToolPresentation.js";
import { measureScript, minTargetForWidth, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."), output = path.join(root, "outputs/dfs-showdown-production");
const require = createRequire(path.join(root, "frontend/package.json")), { chromium } = require("playwright");
const fixture = JSON.parse(await readFile(path.join(root, "frontend/test-fixtures/dfs-showdown-data.json"), "utf8"));
const receipt = { synthetic: true, actualEngineResponses: true, productionComponents: true, original20LineupAuditReproduced: false, liveAccountOrPlatformVerified: false, cases: [], guards: [] };
async function open(page, id) { const panel = page.getByTestId(id); if (!await panel.evaluate(el => el.open)) await panel.locator(":scope > summary").click(); return panel; }
async function choose(scope, label, option) { await scope.getByRole("button", { name: new RegExp(`^${RegExp.escape(label)}:`) }).click(); await scope.getByRole("option", { name: new RegExp(`^${RegExp.escape(option)}(?:\\s|$)`) }).click(); }
async function setup(browser, width, theme) {
  const context = await browser.newContext({ viewport: { width, height: 960 }, acceptDownloads: true, colorScheme: theme, reducedMotion: "reduce", serviceWorkers: "block" });
  const blocked = [], errors = [];
  await context.route("**/*", route => { blocked.push(route.request().url()); return route.abort("blockedbyclient"); });
  await context.addInitScript(theme => localStorage.setItem("scoresense-color-theme", theme), theme);
  await attachDfsFixture(context); const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:5173/test-fixtures/dfs-portfolio.html?showdown"); await page.getByTestId("dfs-generate").waitFor();
  await choose(page, W.format, "DraftKings Showdown"); await page.getByRole("spinbutton", { name: W.count, exact: true }).fill("1");
  await choose(page, "Scoring goal", C.objectives.ceiling);
  assert.equal(await page.getByTestId("dfs-advanced").evaluate(el => el.open), false);
  assert.equal(await page.getByTestId("dfs-showdown-review").evaluate(el => el.open), false);
  const advanced = await open(page, "dfs-advanced");
  await choose(advanced, C.pairing, "Require"); await choose(advanced, C.qbChoice("BUF"), "Avery Quarterback"); await choose(advanced, C.qbChoice("LA"), "Morgan Quarterback");
  await choose(advanced, W.differences, "Captain change only");
  await advanced.locator(":scope > summary").click();
  return { context, page, blocked, errors };
}
async function build(page) { await page.getByTestId("dfs-generate").click(); await page.getByText("Built 1 lineup.", { exact: true }).waitFor(); await page.getByTestId("dfs-flow-review").waitFor(); }
async function audit(page, width, theme, state) {
  const measures = await page.evaluate(measureScript(), { minTarget: minTargetForWidth(width), numericRe: NUMERIC_RE.source, barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX, columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  await writeFile(path.join(output, `layout-${width}-${theme}-${state}.json`), JSON.stringify(measures, null, 2));
  assert.equal(overflow, false, `${width}/${theme}/${state} overflow`); assert.deepEqual(measures.filter(row => !row.ok), [], `${width}/${theme}/${state} layout`);
  return { state, overflow, measures };
}
async function shot(page, width, theme, state) { if (![390, 1280].includes(width)) return; await page.screenshot({ path: path.join(output, `${state}-${width}-${theme}.png`), fullPage: true }); }
async function compare(page) {
  const panel = await open(page, "dfs-showdown-review"); await choose(panel, C.comparePlayer, "Drew Reserve"); await choose(panel, C.placement, "Include in FLEX");
  await panel.getByRole("button", { name: C.compare, exact: true }).click(); await panel.getByTestId("dfs-showdown-comparison").waitFor(); return panel;
}
const history = page => page.evaluate(() => JSON.stringify({ builds: window.__portfolioFixture.builds, imports: window.__portfolioFixture.imports }));
async function save(page, panel, filename) { const pending = page.waitForEvent("download"); await panel.getByRole("button", { name: C.saveReview, exact: true }).click(); const destination = path.join(output, filename); await (await pending).saveAs(destination); return { destination, review: JSON.parse(await readFile(destination, "utf8")) }; }
async function fail(session, label, error) { await writeFile(path.join(output, `failure-${label}.txt`), `${error.stack}\n\n${await session.page.locator("body").innerText()}\n${JSON.stringify({ errors: session.errors, blocked: session.blocked })}`); await session.page.screenshot({ path: path.join(output, `failure-${label}.png`), fullPage: true }); }
await mkdir(output, { recursive: true }); const browser = await chromium.launch({ headless: true });
try {
  for (const width of [390, 768, 1280]) for (const theme of ["light", "dark"]) {
    const session = await setup(browser, width, theme), { page } = session;
    try {
      const states = [await audit(page, width, theme, "build")]; await build(page);
      assert.match(await page.locator(".dfw-portfolio").innerText(), /217.0.*P90-input score/s);
      await page.getByTestId("dfs-showdown-audit").getByRole("button", { name: C.reviewCount(1), exact: true }).click();
      assert.equal(await page.locator(".dfw-portfolio > button").count(), 1);
      await page.locator(".dfw-portfolio > button").first().click();
      assert.ok(await page.getByText("At build: Questionable", { exact: true }).count());
      await page.locator(".dfw-lineup").getByText(C.scoring, { exact: true }).click();
      assert.ok(await page.locator("dd").filter({ hasText: /^152\.00/ }).count());
      await page.locator(".dfw-lineup").getByText(C.scoring, { exact: true }).click();
      await page.getByTestId("dfs-showdown-audit").getByRole("button", { name: C.all, exact: true }).click();
      states.push(await audit(page, width, theme, "review")); await shot(page, width, theme, "review");
      const before = await history(page), panel = await compare(page);
      const request = await page.evaluate(() => window.__portfolioFixture.requests.at(-1));
      assert.deepEqual(request.showdown_rules, fixture.build_request.showdown_rules); assert.equal(request.comparison_snapshot.id, fixture.build.build_snapshot.id); assert.equal(request.max_exposure, null); assert.equal(request.lineup_count, 1);
      assert.equal(await panel.getByTestId("dfs-showdown-comparison").evaluate(el => document.activeElement === el), true);
      states.push(await audit(page, width, theme, "comparison")); await shot(page, width, theme, "comparison");
      const saved = await save(page, panel, `review-${width}-${theme}.json`);
      assert.equal(saved.review.build.lineups[0].score_metadata.objective_score, 217); assert.equal(saved.review.build.lineups[0].score_metadata.projection_sum, 152);
      assert.equal(saved.review.build.lineups[0].lineup.find(p => p.player_id === "wb").diagnostics.build_injury_status, "Questionable");
      await panel.getByLabel(C.reopen, { exact: true }).setInputFiles(saved.destination); await panel.getByTestId("dfs-showdown-saved").waitFor(); assert.equal(await history(page), before);
      await page.getByTestId("dfs-flow-download").click();
      const downloadDetails = page.locator("details").filter({ has: page.getByText("Download for My Lineups", { exact: true }) }).last(); await downloadDetails.locator(":scope > summary").click();
      const pending = page.waitForEvent("download"); await page.getByRole("button", { name: W.download, exact: true }).click(); const siteFile = path.join(output, `site-${width}-${theme}.csv`); await (await pending).saveAs(siteFile);
      assert.match(await readFile(siteFile, "utf8"), /^"CPT","FLEX","FLEX","FLEX","FLEX","FLEX"/); assert.equal(await history(page), before);
      assert.deepEqual(session.errors, []); assert.deepEqual(session.blocked, []);
      receipt.cases.push({ width, theme, states, frozenComparison: true, exactScore: 217, projectionSum: 152, statusPreserved: true, savedReviewReopened: true, supportedSiteCsv: true, historyUnchanged: true });
    } catch (error) { await fail(session, `${width}-${theme}`, error); throw error; }
    finally { await session.context.close(); }
  }
  const session = await setup(browser, 390, "dark"), { page } = session;
  try {
    await build(page); const summary = page.getByTestId("dfs-showdown-review").locator(":scope > summary"); await summary.focus(); await summary.press("Enter"); assert.equal(await page.getByTestId("dfs-showdown-review").evaluate(el => el.open), true); receipt.guards.push("keyboard disclosure");
    const panel = await compare(page), previous = await panel.getByTestId("dfs-showdown-comparison").textContent(), original = await history(page);
    const guardReview = await save(page, panel, "guard-review.json"); await panel.getByLabel(C.reopen, { exact: true }).setInputFiles(guardReview.destination); await panel.getByTestId("dfs-showdown-saved").waitFor();
    for (const flag of ["failOptimize", "mismatchComparison"]) { await page.evaluate(flag => window.__portfolioFixture[flag] = true, flag); await panel.getByRole("button", { name: C.compare, exact: true }).click(); await panel.getByRole("alert").waitFor(); assert.equal(await panel.getByTestId("dfs-showdown-comparison").textContent(), previous); await page.evaluate(flag => window.__portfolioFixture[flag] = false, flag); }
    receipt.guards.push("failure and mismatched snapshot retain result");
    await page.evaluate(() => { window.__portfolioFixture.delayOptimize = true; window.__portfolioFixture.ignoreOptimizeAbort = true; });
    await panel.getByRole("button", { name: C.compare, exact: true }).click(); await page.waitForFunction(() => typeof window.__portfolioFixture.releaseOptimize === "function"); await page.waitForTimeout(1100); assert.ok(await panel.getByText(/1s elapsed/).count());
    await panel.getByRole("button", { name: C.cancel, exact: true }).click(); await page.evaluate(() => { window.__portfolioFixture.delayOptimize = false; window.__portfolioFixture.releaseOptimize(); }); await page.waitForTimeout(100); assert.equal(await panel.getByTestId("dfs-showdown-comparison").textContent(), previous); receipt.guards.push("cancel discards late response and retains previous review");
    await page.evaluate(() => window.__portfolioFixture.accessStatus = 403); await panel.getByRole("button", { name: C.saveReview, exact: true }).click(); await panel.getByRole("alert").filter({ hasText: /denied/ }).waitFor(); await page.evaluate(() => window.__portfolioFixture.accessStatus = 200); receipt.guards.push("fresh account access before personal download");
    await page.getByTestId("dfs-flow-download").click(); const downloads = page.locator("details").filter({ has: page.getByText("Download for My Lineups", { exact: true }) }).last(); await downloads.locator(":scope > summary").click();
    await page.evaluate(() => window.__portfolioFixture.latestOut = true); await page.getByRole("button", { name: W.download, exact: true }).click(); await page.getByRole("alert").filter({ hasText: /Current unavailable status: Jamie Receiver/ }).waitFor(); receipt.guards.push("fresh confirmed inactivity blocks site CSV without rewriting history");
    assert.equal(await history(page), original); await page.getByTestId("dfs-flow-review").click(); assert.ok(await page.getByText("At build: Questionable", { exact: true }).count());
    const selectedLineup = page.locator(".dfw-lineup"); if (!await selectedLineup.evaluate(el => el.open)) await selectedLineup.locator(":scope > summary").click();
    const statusRow = selectedLineup.locator(".dfw-lineup-row").filter({ has: page.getByText("Jamie Receiver", { exact: true }) }); await statusRow.locator("summary").filter({ hasText: C.sourceDetails }).click();
    assert.match(await statusRow.innerText(), /At build.*Questionable.*Latest.*Out/s);
    const expectedLatestTime = await page.evaluate(() => new Date("2026-10-12T14:00:00Z").toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }));
    assert.equal(await statusRow.locator(".dfw-showdown-facts > div").filter({ has: page.getByText(C.latest, { exact: true }) }).locator("small").innerText(), expectedLatestTime);
    receipt.guards.push("at-build Questionable remains immutable beside latest Out and source timestamp");
    await page.evaluate(() => { window.__portfolioFixture.delayOptimize = true; window.__portfolioFixture.ignoreOptimizeAbort = true; });
    await panel.getByRole("button", { name: C.compare, exact: true }).click(); await page.waitForFunction(() => typeof window.__portfolioFixture.releaseOptimize === "function");
    await page.getByTestId("dfs-flow-build").click(); await choose(page, "Scoring goal", C.objectives.median);
    await page.evaluate(() => { window.__portfolioFixture.delayOptimize = false; window.__portfolioFixture.releaseOptimize(); }); await page.waitForTimeout(100);
    await panel.getByTestId("dfs-showdown-comparison").waitFor({ state: "detached" }); receipt.guards.push("edited working inputs discard late comparison without changing original build");
    await page.getByTestId("dfs-flow-review").click(); assert.ok(await page.getByText("At build: Questionable", { exact: true }).count());
    await page.evaluate(() => dispatchEvent(new CustomEvent("scoresense-auth-changed"))); await panel.getByTestId("dfs-showdown-comparison").waitFor({ state: "detached" }); await panel.getByTestId("dfs-showdown-saved").waitFor({ state: "detached" }); receipt.guards.push("account change clears personal build and review");
    assert.deepEqual(session.errors, []); assert.deepEqual(session.blocked, []);
  } catch (error) { await fail(session, "guards", error); throw error; } finally { await session.context.close(); }
  await writeFile(path.join(output, "receipt.json"), JSON.stringify(receipt, null, 2)); process.stdout.write(JSON.stringify({ cases: receipt.cases.length, guards: receipt.guards, output }, null, 2));
} finally { await browser.close(); }
