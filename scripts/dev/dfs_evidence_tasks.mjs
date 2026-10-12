// Production opportunity-evidence UI with explicitly synthetic local responses.
// API requests are intercepted; no server, provider, account, or live entry is contacted.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachDfsFixture } from "./dfs_fixture_runtime.mjs";
import { readPortfolioBackup } from "../../frontend/src/dfsPortfolioBackup.js";
import { DFS_EVIDENCE_COPY as C, DFS_STEP_COPY as S } from "../../frontend/src/dfsToolPresentation.js";
import { measureScript, minTargetForWidth, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX,
  COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "outputs/dfs-evidence-review");
const fixture = JSON.parse(await readFile(path.join(root, "frontend/test-fixtures/dfs-evidence-data.json"), "utf8"));
const require = createRequire(path.join(root, "frontend/package.json"));
const { chromium } = require("playwright");
const url = "http://127.0.0.1:5173/test-fixtures/dfs-portfolio.html?evidence";
const choose = async (scope, label, option) => {
  await scope.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  await scope.getByRole("option", { name: option, exact: true }).click();
};
const escaped = text => RegExp.escape(text);
const detail = (scope, text) => scope.locator("summary").filter({ hasText: new RegExp(`^${escaped(text)}(?: .*)?$`) }).locator("..").first();
async function openDetails(scope, text) {
  const target = detail(scope, text);
  if (!await target.evaluate(element => element.open)) await target.locator(":scope > summary").click();
  return target;
}
async function value(scope, label) {
  return scope.locator("dt").filter({ hasText: new RegExp(`^${escaped(label)}$`) }).locator("..").locator("dd").innerText();
}
async function download(page, label, filename) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: label, exact: true }).last().click();
  const file = path.join(output, filename);
  await (await pending).saveAs(file);
  return readFile(file);
}
async function panelShot(page, scope, filename) {
  await scope.evaluate(element => element.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -96));
  const box = await scope.boundingBox(), offset = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  await page.screenshot({ path: path.join(output, filename), fullPage: true,
    clip: { ...box, x: box.x + offset.x, y: box.y + offset.y } });
}
async function fit(scope, label) {
  assert.deepEqual(await scope.evaluate(element => {
    const outer = element.getBoundingClientRect();
    return [...element.querySelectorAll("button,input:not([type=file]),dl,ol,li")]
      .filter(control => control.checkVisibility())
      .filter(control => { const box = control.getBoundingClientRect(); return box.left < outer.left - 1 || box.right > outer.right + 1; })
      .map(control => ({ label: control.getAttribute("aria-label") || control.textContent.trim().slice(0, 80),
        width: control.getBoundingClientRect().width }));
  }), [], `${label}: visible controls and evidence rows fit their panel`);
}
async function start(page) {
  await page.goto(url);
  await page.getByRole("button", { name: "Lock Synthetic BUF QB", exact: true }).waitFor();
  await page.getByRole("spinbutton", { name: "Lineups", exact: true }).fill("3");
  await choose(page, "Minimum differences", "1");
  await page.getByRole("button", { name: `${S.raiseWeight}: BUF @ KC`, exact: true }).click();
  await page.getByRole("button", { name: C.open, exact: true }).click();
  const evidence = page.getByTestId("dfs-evidence-review");
  await page.getByTestId("dfs-evidence-status").getByText(/3 eligible games/).waitFor();
  assert.equal(await evidence.evaluate(element => element === document.activeElement), true, "Opening evidence focuses its section");
  return evidence;
}
async function freezeAndCompare(page, evidence) {
  await evidence.getByRole("button", { name: C.select, exact: true }).click();
  const compare = evidence.getByRole("button", { name: C.compare, exact: true });
  await compare.waitFor({ state: "visible" });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent === "Compare complete lineups" && !button.disabled));
  await compare.click();
  await evidence.getByTestId("dfs-evidence-candidate").first().waitFor();
  return JSON.parse((await download(page, C.download, `comparison-${Date.now()}.json`)).toString("utf8"));
}

async function verifyMain(browser, width, theme) {
  const context = await browser.newContext({ viewport: { width, height: 960 }, colorScheme: theme, reducedMotion: "reduce" });
  await context.addInitScript(theme => localStorage.setItem("scoresense-color-theme", theme), theme);
  await attachDfsFixture(context);
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  try {
    const evidence = await start(page);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme, "The actual rendered theme matches the acceptance case");
    assert.equal(await evidence.locator("select").count(), 0, "Evidence filters use the shared menu primitive");
    const games = await openDetails(evidence, C.games);
    assert.equal(await games.getByTestId("dfs-evidence-game").count(), 3);
    const firstGame = games.getByTestId("dfs-evidence-game").filter({ hasText: "BUF at KC" });
    await firstGame.locator(":scope > summary").click();
    const buf = firstGame.getByRole("region", { name: "BUF volume evidence", exact: true });
    const kc = firstGame.getByRole("region", { name: "KC volume evidence", exact: true });
    assert.equal(await value(firstGame, "Combined play screen"), "133.8");
    assert.equal(await value(buf, "Play screen"), "66.3");
    assert.equal(await value(kc, "Play screen"), "67.5");
    assert.notEqual(await value(buf, "Rough dropback screen"), await value(kc, "Rough dropback screen"));
    assert.equal(await value(buf, "Season games / venue games"), "2 / 1");
    assert.match(await games.innerText(), /Unfitted volume screen/);
    assert.match(await games.innerText(), /not calibrated projections/);
    const seaGame = games.getByTestId("dfs-evidence-game").filter({ hasText: "SEA at LA" });
    await seaGame.locator(":scope > summary").click();
    assert.match(await seaGame.innerText(), /Missing venue sample/);
    await games.getByTestId("dfs-evidence-game").filter({ hasText: "CHI at MIN" }).locator(":scope > summary").click();
    assert.equal(await value(games.getByTestId("dfs-evidence-game").filter({ hasText: "CHI at MIN" }), "Combined play screen"), "\u2014");
    await choose(games, "Game scope", C.primaryGames);
    assert.equal(await games.getByTestId("dfs-evidence-game").count(), 1);
    await choose(games, "Game scope", C.challengerGames);
    assert.equal(await games.getByTestId("dfs-evidence-game").count(), 2);
    await choose(games, "Game scope", C.allGames);
    const scopeTrigger = games.getByRole("button", { name: /^Game scope:/ });
    await scopeTrigger.focus(); await page.keyboard.press("Enter"); await page.keyboard.press("Escape");
    assert.equal(await scopeTrigger.evaluate(element => element === document.activeElement), true);
    if (!await firstGame.evaluate(element => element.open)) await firstGame.locator(":scope > summary").click();
    if ([390, 1280].includes(width)) await panelShot(page, firstGame, `game-${width}-${theme}.png`);

    const players = await openDetails(evidence, C.players);
    await players.getByLabel(C.search, { exact: true }).fill("Synthetic KC WR1");
    const receiver = players.locator(".dfw-review-list > li");
    assert.equal(await receiver.count(), 1);
    assert.equal(await value(receiver, "Targets / full-offense targets"), "16 / 76");
    assert.equal(await value(receiver, "Target share"), "21.1%");
    assert.equal(await value(receiver, "Routes"), C.unavailable);
    assert.match(await players.innerText(), /not expected future roles/);
    if ([390, 1280].includes(width)) await panelShot(page, players, `player-${width}-${theme}.png`);
    await players.getByLabel(C.search, { exact: true }).fill("Synthetic KC WR2");
    const measured = players.locator(".dfw-review-list > li");
    const reportObservation = await openDetails(measured, "synthetic-receiving-report");
    assert.equal(await value(reportObservation, "Receiving grade"), "88.2");
    assert.equal(await value(reportObservation, "Routes"), "100");
    assert.equal(await value(reportObservation, "Routes / player passing snaps"), "80.0%");
    assert.equal(await value(reportObservation, "Routes / team dropbacks"), "66.7%");
    await players.getByLabel(C.search, { exact: true }).fill("");
    await choose(players, C.position, "RB");
    assert.equal(await players.locator(".dfw-review-list > li").count(), 6);
    assert.match(await players.innerText(), /goal-line roles and DST event distributions require independent evidence/);
    await choose(players, C.position, "DST");
    assert.equal(await players.locator(".dfw-review-list > li").count(), 6);
    const defense = players.locator(".dfw-review-list > li").first();
    assert.equal(await value(defense, "Targets / full-offense targets"), "\u2014 / \u2014");
    await choose(players, C.position, "All positions");
    assert.equal(await players.locator(".dfw-review-list > li").count(), 8);
    await players.getByRole("button", { name: C.next, exact: true }).click();
    assert.equal(await players.locator(".dfw-review-list > li").count(), 8);
    await players.getByRole("button", { name: C.previous, exact: true }).click();

    const sources = await openDetails(evidence, C.sources);
    assert.match(await sources.innerText(), /Synthetic local fixture/);
    assert.match(await sources.innerText(), /2026-10-06T00:00:00Z/);
    assert.match(await sources.innerText(), /not permission or authenticity/);
    const originalSource = sources.locator("article").first();
    assert.equal(await value(originalSource, "Raw content SHA-256"), fixture.evidence.sources[0].content_sha256);
    assert.equal(await value(originalSource, "training"), "Not allowed");
    assert.equal(await value(originalSource, "external model"), "Not allowed");
    assert.match(await sources.innerText(), /Synthetic fixtures demonstrate software behavior/);

    const review = await freezeAndCompare(page, evidence);
    const request = await page.evaluate(() => window.__portfolioFixture.comparisonRequests.at(-1));
    assert.deepEqual(request.stack_qb_ids, ["e-buf-qb", "e-kc-qb"]);
    assert.equal(request.pool.length, fixture.pool.length, "QB focus retains all off-focus complementary players");
    assert.equal(request.evidence_id, fixture.evidence.content_id);
    const byId = rows => [...rows].sort((a, b) => a.player_id.localeCompare(b.player_id));
    assert.deepEqual(byId(request.pool), byId(fixture.engine_inputs.pool), "Every actual frozen request player input matches the real solver fixture");
    for (const [key, expected] of Object.entries(fixture.engine_inputs)) {
      if (!["pool", "site"].includes(key)) assert.deepEqual(request[key], expected, `Actual request ${key} matches the real solver fixture`);
    }
    assert.match(request.input_snapshot_id, /^decision:/);
    assert.equal(review.snapshot.input_snapshot_id, request.input_snapshot_id);
    assert.equal(review.snapshot.evidence_id, fixture.evidence.content_id);
    assert.equal(review.snapshot.pool.length, fixture.pool.length);
    assert.equal(Object.hasOwn(review.snapshot, "evidence"), false, "Portable reviews omit source observation ledgers");
    assert.equal(review.snapshot.evidence_reference.content_id, fixture.evidence.content_id);
    assert.deepEqual(review.report, { ...fixture.comparison, input_snapshot_id: request.input_snapshot_id, evidence_id: request.evidence_id }, "UI downloads the synthetic real-engine replay bound to the selected request");
    const comparisons = await openDetails(evidence, C.comparisons);
    assert.match(await comparisons.innerText(), /Strongest evaluated excluded alternative/);
    assert.match(await comparisons.innerText(), /not lineup percentiles, win probabilities or expected payouts/);
    assert.ok(await comparisons.getByTestId("dfs-evidence-candidate").count() <= 8);
    const candidate = comparisons.getByTestId("dfs-evidence-candidate").first();
    await candidate.locator(":scope > summary").click();
    const completionCount = fixture.comparison.candidates.find(item => item.id === fixture.comparison.best_primary_id).completions.length;
    assert.equal(await candidate.locator("ol").count(), completionCount);
    assert.equal(await candidate.locator("ol > li").count(), 9 * completionCount);
    assert.match(await candidate.innerText(), /Synthetic/);
    assert.doesNotMatch(await candidate.locator("ol > li").first().innerText(), /e-buf-qb/);
    await fit(candidate, "Complete-lineup alternative");
    if ([390, 1280].includes(width)) await panelShot(page, candidate, `comparison-${width}-${theme}.png`);
    await comparisons.getByRole("button", { name: C.next, exact: true }).click();
    assert.ok(await comparisons.getByTestId("dfs-evidence-candidate").count() <= 8);
    await comparisons.getByRole("button", { name: C.previous, exact: true }).click();

    await evidence.getByRole("button", { name: C.return, exact: true }).click();
    const railTrigger = page.getByRole("button", { name: C.open, exact: true });
    assert.equal(await railTrigger.evaluate(element => element === document.activeElement), true);
    await page.getByTestId("dfs-generate").click();
    await page.getByRole("button", { name: "Review portfolio", exact: true }).waitFor();
    await page.getByRole("button", { name: "Review portfolio", exact: true }).click();
    await page.getByRole("button", { name: "Download portfolio backup", exact: true }).waitFor();
    const history = readPortfolioBackup((await download(page, "Download portfolio backup", `history-${width}-${theme}.json`)).toString("utf8"));
    assert.equal(history.batches.length, 1);
    assert.equal(history.batches[0].lineups.length, 3);
    await page.getByRole("button", { name: C.open, exact: true }).click();
    const currentScores = await openDetails(evidence, C.currentScores);
    assert.equal(await currentScores.locator(".dfw-review-list > li").count(), 3);
    assert.match(await currentScores.innerText(), /Original saved build forecasts remain unchanged/);
    const updatedReview = JSON.parse((await download(page, C.download, `collection-${width}-${theme}.json`)).toString("utf8"));
    assert.equal(updatedReview.collection_comparisons.length, 3);
    assert.ok(updatedReview.collection_comparisons.every(row => row.status === "available"));
    assert.deepEqual(readPortfolioBackup((await download(page, "Download portfolio backup", `history-after-${width}-${theme}.json`)).toString("utf8")).batches, history.batches);
    await fit(evidence, "Evidence review");
    const measurements = await page.evaluate(measureScript(), { minTarget: minTargetForWidth(width), numericRe: NUMERIC_RE.source,
      barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX, columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS });
    if (measurements.some(result => !result.ok)) await writeFile(path.join(output, `geometry-${width}-${theme}.json`), JSON.stringify(await page.locator("button").evaluateAll(buttons => buttons.filter(button => button.checkVisibility() && button.getBoundingClientRect().height < 44).map(button => ({ text: button.textContent, label: button.getAttribute("aria-label"), classes: button.className, width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height }))), null, 2));
    assert.deepEqual(measurements.filter(result => !result.ok), [], `${width} ${theme} evidence layout`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.deepEqual(errors, []);
    console.log(`PASS evidence ${width} ${theme}: source/count windows, exact team screens, missingness, focus/challengers, complete rosters, frozen review and unchanged collection`);
    return { width, theme, synthetic: true, taskPassed: true, measurements, browserErrors: errors.length };
  } catch (error) {
    await writeFile(path.join(output, `failure-${width}-${theme}.txt`), `${error.stack}\n\n${await page.locator("body").innerText()}\n\nBrowser errors: ${JSON.stringify(errors)}`);
    await page.screenshot({ path: path.join(output, `failure-${width}-${theme}.png`), fullPage: true });
    throw error;
  } finally { await context.close(); }
}

async function verifyFailureAndRace(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, reducedMotion: "reduce" });
  await attachDfsFixture(context);
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(10000);
  try {
    const evidence = await start(page);
    await page.evaluate(() => { window.__portfolioFixture.failEvidence = true; });
    await evidence.getByRole("button", { name: C.refresh, exact: true }).click();
    await evidence.getByRole("alert").waitFor();
    assert.equal(await evidence.getByTestId("dfs-evidence-game").count(), 3, "A failed evidence refresh retains the last usable evidence");
    await page.evaluate(() => { window.__portfolioFixture.failEvidence = false; });
    await evidence.getByRole("button", { name: C.refresh, exact: true }).click();
    await page.getByTestId("dfs-evidence-status").getByText(/3 eligible games/).waitFor();
    const first = await freezeAndCompare(page, evidence);
    await page.evaluate(() => { window.__portfolioFixture.mismatchComparison = true; });
    await evidence.getByRole("button", { name: C.compare, exact: true }).click();
    await evidence.getByRole("alert").getByText(C.responseMismatch, { exact: true }).waitFor();
    assert.deepEqual(JSON.parse((await download(page, C.download, "wrong-echo-retained.json")).toString("utf8")).report, first.report);
    await page.evaluate(() => { window.__portfolioFixture.mismatchComparison = false; });
    await page.evaluate(() => { window.__portfolioFixture.failComparison = true; });
    await evidence.getByRole("button", { name: C.compare, exact: true }).click();
    await evidence.getByRole("alert").waitFor();
    const retained = JSON.parse((await download(page, C.download, "failed-comparison-retained.json")).toString("utf8"));
    assert.deepEqual(retained.report, first.report);
    assert.deepEqual(retained.snapshot, first.snapshot);
    await page.evaluate(() => { const state = window.__portfolioFixture; state.failComparison = false; state.delayComparison = true; state.ignoreComparisonAbort = true; });
    await evidence.getByRole("button", { name: C.compare, exact: true }).click();
    await page.waitForFunction(() => Boolean(window.__portfolioFixture.releaseComparison));
    await evidence.getByRole("button", { name: "Cancel comparison", exact: true }).click();
    await page.evaluate(() => window.__portfolioFixture.releaseComparison());
    assert.deepEqual(JSON.parse((await download(page, C.download, "cancelled-comparison-retained.json")).toString("utf8")).report, first.report);
    await page.evaluate(() => { const state = window.__portfolioFixture; state.delayComparison = false; state.missingEvidence = true; });
    await evidence.getByRole("button", { name: C.refresh, exact: true }).click();
    await evidence.getByText(C.newest, { exact: true }).waitFor();
    await evidence.getByRole("button", { name: C.select, exact: true }).click();
    await page.waitForFunction(() => !document.querySelectorAll('[data-testid="dfs-evidence-game"]').length);
    assert.equal(await evidence.getByTestId("dfs-evidence-candidate").count(), 0);
    await page.evaluate(() => { window.__portfolioFixture.missingEvidence = false; });
    await evidence.getByRole("button", { name: C.refresh, exact: true }).click();
    await evidence.getByText(C.newest, { exact: true }).waitFor();
    assert.equal(await evidence.getByTestId("dfs-evidence-game").count(), 0, "A selected missing-evidence snapshot does not silently acquire new observations");
    const active = await freezeAndCompare(page, evidence);
    await page.evaluate(() => { const state = window.__portfolioFixture; state.failComparison = false; state.delayComparison = true; state.ignoreComparisonAbort = true; });
    await evidence.getByRole("button", { name: C.compare, exact: true }).click();
    await page.waitForFunction(() => Boolean(window.__portfolioFixture.releaseComparison));
    await choose(page, "Score to optimize", /^Floor \(P10\)/);
    await evidence.getByText(C.stale, { exact: true }).waitFor();
    await page.evaluate(() => window.__portfolioFixture.releaseComparison());
    await page.waitForFunction(() => ![...document.querySelectorAll("button")].some(button => button.textContent === "Comparing complete lineups\u2026"));
    assert.equal(await evidence.getByRole("button", { name: C.compare, exact: true }).isDisabled(), true);
    const stale = JSON.parse((await download(page, C.download, "stale-comparison-retained.json")).toString("utf8"));
    assert.deepEqual(stale.snapshot, active.snapshot, "An ignored-abort late response cannot replace selected inputs");
    assert.deepEqual(stale.report, active.report);
    await page.evaluate(() => { const state = window.__portfolioFixture; state.delayComparison = false; state.delayEvidence = true; state.ignoreEvidenceAbort = true; });
    await evidence.getByRole("button", { name: C.refresh, exact: true }).click();
    await page.waitForFunction(() => Boolean(window.__portfolioFixture.releaseEvidence));
    await page.evaluate(() => { const state = window.__portfolioFixture; state.delayedEvidenceRelease = state.releaseEvidence; state.delayEvidence = false; });
    await choose(page, "Week", "6");
    await page.evaluate(() => window.__portfolioFixture.delayedEvidenceRelease());
    await page.waitForFunction(() => window.__portfolioFixture.evidenceRequests >= 4);
    await page.waitForFunction(() => !document.querySelector('[data-testid="dfs-evidence-status"]')?.textContent.includes("Loading"));
    assert.equal(await evidence.getByTestId("dfs-evidence-game").count(), 0, "Cross-context evidence never remains visible");
    assert.equal(await evidence.getByRole("button", { name: C.download, exact: true }).isDisabled(), true);
    assert.deepEqual(errors, []);
    await choose(page, "Score to optimize", /^Proj \(P50\)/);
    await choose(page, "Week", "5");
    await page.getByTestId("dfs-evidence-status").getByText(/3 eligible games/).waitFor();
    await freezeAndCompare(page, evidence);
    await page.evaluate(() => { const state = window.__portfolioFixture; state.delayComparison = true; state.ignoreComparisonAbort = true; });
    await evidence.getByRole("button", { name: C.compare, exact: true }).click();
    await page.waitForFunction(() => Boolean(window.__portfolioFixture.releaseComparison));
    await page.evaluate(() => window.dispatchEvent(new Event("scoresense-auth-changed")));
    await page.evaluate(() => window.__portfolioFixture.releaseComparison());
    assert.equal(await evidence.getByRole("button", { name: C.download, exact: true }).isDisabled(), true);
    assert.equal(await evidence.getByTestId("dfs-evidence-candidate").count(), 0);
    assert.deepEqual(errors, []);
    console.log("PASS evidence failure/race: last-good evidence/report, exact response IDs, cancellation, explicit missing-to-available selection, control/slate/account late-response guards");
    return { passed: true, checks: ["last-good evidence", "failed comparison retains review", "wrong response IDs rejected", "cancel late response", "missing-to-available explicit selection", "control-change late comparison", "slate-change late evidence", "account-change late comparison"] };
  } finally { await context.close(); }
}

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = [], result = { synthetic: true, report, supplemental: null };
try {
  const widths = process.argv.includes("--quick") ? [390] : [390, 768, 1280, 1440];
  const themes = process.argv.includes("--quick") ? ["dark"] : ["dark", "light"];
  if (!process.argv.includes("--supplemental-only")) for (const width of widths) for (const theme of themes)
    report.push(await verifyMain(browser, width, theme));
  if (!process.argv.includes("--quick")) result.supplemental = await verifyFailureAndRace(browser);
} finally {
  await writeFile(path.join(output, "report.json"), JSON.stringify(result, null, 2) + "\n");
  await browser.close();
}
