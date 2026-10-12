// Production UI workflow verification with explicitly synthetic local responses.
// No server, paid feed, account entry, or platform upload is contacted.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachDfsFixture } from "./dfs_fixture_runtime.mjs";
import { readPortfolioBackup } from "../../frontend/src/dfsPortfolioBackup.js";
import { csvLines, parseDfsCsv } from "../../frontend/src/dfsCsv.js";
import { measureScript, minTargetForWidth, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX,
  COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "outputs/dfs-workflow-review");
const require = createRequire(path.join(root, "frontend/package.json"));
const { chromium } = require("playwright");
const fixtureUrl = "http://127.0.0.1:5173/test-fixtures/dfs-portfolio.html?workflow";
const choose = async (page, label, option) => {
  await page.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
};
async function download(page, label, filename) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: label, exact: true }).last().click();
  const file = path.join(output, filename);
  await (await pending).saveAs(file);
  return readFile(file);
}
const backup = async (page, name) => {
  const text = (await download(page, "Download portfolio backup", name)).toString("utf8");
  try {
    await page.waitForFunction(() => document.activeElement?.textContent.trim() === "Download portfolio backup" && !document.activeElement.disabled, null, { timeout: 5000 });
  } catch (error) {
    console.error("Backup focus diagnostic", name, await page.evaluate(() => ({
      active: { tag: document.activeElement?.tagName, text: document.activeElement?.textContent, disabled: document.activeElement?.disabled },
      button: [...document.querySelectorAll("button")].filter(element => /Download portfolio backup|Preparing backup/.test(element.textContent)).map(element => ({ text: element.textContent, disabled: element.disabled }))
    })));
    throw error;
  }
  return readPortfolioBackup(text);
};
const visibleFocus = async page => page.evaluate(() => {
  const element = document.activeElement, box = element?.getBoundingClientRect();
  return Boolean(element && element !== document.body && box?.width && box?.height && getComputedStyle(element).visibility !== "hidden");
});
async function fit(scope, label) {
  assert.deepEqual(await scope.evaluate(element => {
    const outer = element.getBoundingClientRect();
    return [...element.querySelectorAll("button,input:not([type=file])")]
      .filter(control => control.getClientRects().length)
      .filter(control => { const box = control.getBoundingClientRect(); return box.left < outer.left - 1 || box.right > outer.right + 1; })
      .map(control => control.getAttribute("aria-label") || control.textContent || control.type);
  }), [], `${label}: controls fit their panel`);
}
async function fitRosterTables(preview) {
  assert.deepEqual(await preview.evaluate(element => [...element.querySelectorAll(".dfw-review-rosters > div")].flatMap(panel => {
    const outer = panel.getBoundingClientRect();
    return [...panel.querySelectorAll("tr,th,td")].filter(cell => cell.checkVisibility())
      .filter(cell => { const box = cell.getBoundingClientRect(); return box.left < outer.left - 1 || box.right > outer.right + 1; })
      .map(cell => cell.textContent.trim());
  })), [], "Visible original/candidate roster rows and numeric cells fit their panels");
}
async function panelShot(page, scope, filename) {
  await scope.evaluate(element => element.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -96));
  const box = await scope.boundingBox(), offset = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  await page.screenshot({ path: path.join(output, filename), fullPage: true,
    clip: { ...box, x: box.x + offset.x, y: box.y + offset.y } });
}
async function startGlobalBuild(page, count = "3") {
  await page.getByRole("spinbutton", { name: "Lineups", exact: true }).fill(count);
  await choose(page, "Minimum differences", "1");
  const navigation = page.getByRole("navigation", { name: "Player pool", exact: true });
  await navigation.getByRole("button", { name: "Exposure", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select the portfolio together", exact: true }).check();
  const groups = page.getByTestId("dfs-group-controls"); await groups.locator("summary").click();
  await groups.getByLabel("Combination label (optional)", { exact: true }).fill("Reviewed RB core");
  for (const number of [2, 3]) {
    await groups.getByLabel("Find a combination member", { exact: true }).fill(`Example ${number}`);
    await groups.getByRole("checkbox", { name: new RegExp(`^Example ${number}\\b`) }).first().check();
  }
  await groups.getByRole("button", { name: "Add combination", exact: true }).click();
  await groups.getByRole("spinbutton", { name: "Minimum combination: Reviewed RB core", exact: true }).fill("50");
  await navigation.getByRole("button", { name: "Player pool", exact: true }).click();
  await page.getByRole("button", { name: "Lock Example 1", exact: true }).click();
}
async function importEntries(page, count) {
  const rows = [["Entry ID", "Contest ID", "Contest Name", "Entry Fee", "QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST", "Note"],
    ...Array.from({ length: count + 1 }, (_, i) => [String(101 + i), "900", "Synthetic Classic", "$3.00", ...Array(9).fill("Keep"), "Synthetic metadata"])];
  await page.getByLabel("Import Edit Entries CSV", { exact: true }).setInputFiles({ name: "entries.csv", mimeType: "text/csv", buffer: Buffer.from(csvLines(rows).join("\n")) });
  await page.getByRole("button", { name: "Assign lineups in order", exact: true }).click();
  return rows;
}
async function verifyBackgroundRefresh(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  await attachDfsFixture(context);
  const page = await context.newPage();
  try {
    await page.clock.install();
    await page.goto(fixtureUrl);
    await page.getByRole("button", { name: "Lock Example 1", exact: true }).waitFor();
    const initial = await page.evaluate(() => {
      window.__portfolioFixture.poolVersion = 1;
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      return window.__portfolioFixture.poolRequests;
    });
    await page.clock.runFor(300100);
    assert.equal(await page.evaluate(() => window.__portfolioFixture.poolRequests), initial, "Hidden tabs skip the actual scheduled pool request");
    await page.evaluate(() => Object.defineProperty(document, "hidden", { configurable: true, value: false }));
    await page.clock.runFor(300100);
    await page.getByTestId("dfs-pool-update-preview").getByText("1 affected player", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__portfolioFixture.poolRequests), initial + 1);
    console.log("PASS workflow hidden-tab scheduled refresh: no hidden request; visible poll stages an explicit update");
  } finally { await context.close(); }

  const overridesContext = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  await attachDfsFixture(overridesContext);
  const overridesPage = await overridesContext.newPage();
  try {
    await overridesPage.goto(fixtureUrl);
    await overridesPage.getByRole("button", { name: "Lock Example 1", exact: true }).waitFor();
    await startGlobalBuild(overridesPage);
    await overridesPage.getByLabel("Import projections & ownership", { exact: true }).setInputFiles({ name: "user-estimates.csv", mimeType: "text/csv", buffer: Buffer.from("ID,Proj,Floor,Ceiling\n1,17,8,23") });
    await overridesPage.getByRole("cell", { name: "17.0", exact: true }).waitFor();
    const projection = () => overridesPage.getByRole("button", { name: "Lock Example 1", exact: true }).locator("xpath=ancestor::tr").getByRole("cell").nth(2).innerText();
    assert.equal(await projection(), "17.0");
    await overridesPage.evaluate(() => { window.__portfolioFixture.poolVersion = 1; window.__portfolioFixture.publishDataRevision(); });
    await overridesPage.getByRole("button", { name: "Check player update", exact: true }).click();
    await overridesPage.getByTestId("dfs-pool-update-preview").getByRole("button", { name: "Use reviewed inputs", exact: true }).click();
    assert.equal(await projection(), "17.0", "A live update preserves the user's imported estimate");
    await overridesPage.locator(".dfw-build-button").click(); await overridesPage.getByText("Built 3 lineups.", { exact: true }).waitFor();
    const request = await overridesPage.evaluate(() => window.__portfolioFixture.requests.at(-1));
    assert.deepEqual(request.projection_overrides.p1, { proj: 17, floor: 8, ceiling: 23 });
    console.log("PASS workflow live update preserves imported estimates and their next-build request");
  } finally { await overridesContext.close(); }
}
async function verifyStaleFilesAndDiscard(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, reducedMotion: "reduce" });
  await attachDfsFixture(context);
  const page = await context.newPage();
  try {
    await page.goto(fixtureUrl); await page.getByRole("button", { name: "Lock Example 1", exact: true }).waitFor();
    await page.evaluate(() => {
      const readText = File.prototype.text;
      File.prototype.text = function () {
        const file = this;
        if (file.name === "delayed-estimates.csv") return new Promise(resolve => {
          window.__portfolioFixture.releaseFile = () => readText.call(file).then(resolve);
        });
        return readText.call(file);
      };
    });
    await page.getByLabel("Import projections & ownership", { exact: true }).setInputFiles({ name: "delayed-estimates.csv", mimeType: "text/csv", buffer: Buffer.from("ID,Proj,Floor,Ceiling\n1,17,8,23") });
    await page.waitForFunction(() => typeof window.__portfolioFixture.releaseFile === "function");
    await choose(page, "Format", "FanDuel Classic"); await page.getByRole("button", { name: "Lock Example 1", exact: true }).waitFor();
    await page.evaluate(() => window.__portfolioFixture.releaseFile());
    assert.equal(await page.getByRole("button", { name: "Lock Example 1", exact: true }).locator("xpath=ancestor::tr").getByRole("cell").nth(2).innerText(), "10.0");
    assert.equal(await page.getByText("Imported", { exact: true }).count(), 0, "A delayed file from a different format cannot change the new pool");
    console.log("PASS workflow stale estimate file: context change discards the delayed read");
    const projection = () => page.getByRole("button", { name: "Lock Example 1", exact: true }).locator("xpath=ancestor::tr").getByRole("cell").nth(2).innerText();
    const oldEstimates = { name: "delayed-estimates.csv", mimeType: "text/csv", buffer: Buffer.from("ID,Proj,Floor,Ceiling\n1,17,8,23") };
    await page.getByLabel("Import projections & ownership", { exact: true }).setInputFiles(oldEstimates);
    await page.getByLabel("Import projections & ownership", { exact: true }).setInputFiles({ name: "latest-estimates.csv", mimeType: "text/csv", buffer: Buffer.from("ID,Proj,Floor,Ceiling\n1,22,8,25") });
    await page.getByRole("button", { name: "Lock Example 1", exact: true }).locator("xpath=ancestor::tr").getByRole("cell").nth(2).getByText("22.0", { exact: true }).waitFor();
    await page.evaluate(() => window.__portfolioFixture.releaseFile());
    assert.equal(await projection(), "22.0", "A slower earlier file cannot overwrite the latest selected estimates");
    await page.getByLabel("Import projections & ownership", { exact: true }).setInputFiles(oldEstimates);
    await page.evaluate(() => { window.__portfolioFixture.poolVersion = 1; window.__portfolioFixture.publishDataRevision(); });
    await page.getByRole("button", { name: "Check player update", exact: true }).click();
    await page.getByTestId("dfs-pool-update-preview").getByRole("button", { name: "Use reviewed inputs", exact: true }).click();
    await page.evaluate(() => window.__portfolioFixture.releaseFile());
    assert.equal(await projection(), "22.0", "A file read against the previous input version cannot overwrite the reviewed update");
    console.log("PASS workflow latest estimate selection and reviewed-input version both reject earlier delayed reads");
  } finally { await context.close(); }

  const entryContext = await browser.newContext({ viewport: { width: 390, height: 960 }, reducedMotion: "reduce" });
  await attachDfsFixture(entryContext);
  const entryPage = await entryContext.newPage();
  try {
    await entryPage.goto(fixtureUrl); await entryPage.getByRole("button", { name: "Lock Example 1", exact: true }).waitFor();
    await startGlobalBuild(entryPage); await entryPage.locator(".dfw-build-button").click();
    await entryPage.getByText("Built 3 lineups.", { exact: true }).waitFor();
    await entryPage.evaluate(() => {
      const readText = File.prototype.text;
      File.prototype.text = function () {
        const file = this;
        if (file.name === "delayed-entries.csv") return new Promise(resolve => {
          window.__portfolioFixture.releaseFile = () => readText.call(file).then(resolve);
        });
        return readText.call(file);
      };
    });
    const rows = [["Entry ID", "Contest ID", "Contest Name", "Entry Fee", "QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"],
      ["101", "900", "Synthetic Classic", "$3.00", ...Array(9).fill("Keep")]];
    await entryPage.getByLabel("Import Edit Entries CSV", { exact: true }).setInputFiles({ name: "delayed-entries.csv", mimeType: "text/csv", buffer: Buffer.from(csvLines(rows).join("\n")) });
    await entryPage.waitForFunction(() => typeof window.__portfolioFixture.releaseFile === "function");
    const latestRows = [rows[0], ["202", "900", "Synthetic Classic", "$3.00", ...Array(9).fill("Keep")]];
    await entryPage.getByLabel("Import Edit Entries CSV", { exact: true }).setInputFiles({ name: "latest-entries.csv", mimeType: "text/csv", buffer: Buffer.from(csvLines(latestRows).join("\n")) });
    await entryPage.locator(".dfw-assignment small").filter({ hasText: /^202/ }).waitFor();
    await entryPage.evaluate(() => window.__portfolioFixture.releaseFile());
    assert.match(await entryPage.locator(".dfw-assignment small").innerText(), /^202\b/, "The latest selected template wins over an earlier delayed read");
    console.log("PASS workflow latest entry-template selection rejects an earlier delayed file");
    await entryPage.getByLabel("Import Edit Entries CSV", { exact: true }).setInputFiles({ name: "delayed-entries.csv", mimeType: "text/csv", buffer: Buffer.from(csvLines(rows).join("\n")) });
    await entryPage.evaluate(() => { window.dispatchEvent(new Event("scoresense-auth-changed")); window.__portfolioFixture.releaseFile(); });
    await entryPage.getByText("Load a slate, choose your settings, and build your first lineup.", { exact: true }).waitFor();
    assert.equal(await entryPage.getByRole("button", { name: "Assign lineups in order", exact: true }).count(), 0);
    assert.equal(await entryPage.evaluate(() => window.__portfolioFixture.imports.length), 0);
    console.log("PASS workflow stale entry-template file: account change prevents review or ledger writes");
  } finally { await entryContext.close(); }

  const draftContext = await browser.newContext({ viewport: { width: 1280, height: 960 }, reducedMotion: "reduce" });
  await attachDfsFixture(draftContext);
  const draftPage = await draftContext.newPage();
  try {
    await draftPage.clock.install();
    await draftPage.goto(fixtureUrl); await draftPage.getByRole("button", { name: "Lock Example 1", exact: true }).waitFor();
    await startGlobalBuild(draftPage); await draftPage.locator(".dfw-build-button").click();
    await draftPage.getByText("Built 3 lineups.", { exact: true }).waitFor();
    await draftPage.clock.runFor(500); await draftPage.getByText("Local draft saved", { exact: true }).waitFor();
    await draftPage.clock.pauseAt(new Date(await draftPage.evaluate(() => Date.now())));
    await draftPage.locator(".dfw-build-button").click(); await draftPage.getByText("Built 3 lineups.", { exact: true }).waitFor();
    await draftPage.getByRole("button", { name: "Delete local draft", exact: true }).click();
    await draftPage.clock.runFor(500);
    await draftPage.getByText("No local draft saved", { exact: false }).waitFor();
    assert.equal(await draftPage.getByRole("button", { name: "Restore local draft", exact: true }).isDisabled(), true);
    console.log("PASS workflow discard during pending autosave: the delayed timer cannot recreate the removed draft");
  } finally { await draftContext.close(); }
}

async function verifyNormal150(browser) {
  const results = [];
  for (const [width, theme] of [[390, "dark"], [1280, "light"]]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, acceptDownloads: true, reducedMotion: "reduce" });
    await context.addInitScript(value => localStorage.setItem("scoresense-color-theme", value), theme);
    await attachDfsFixture(context);
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto(fixtureUrl); await page.getByRole("button", { name: "Lock Example 1", exact: true }).waitFor();
      await startGlobalBuild(page, "150");
      await page.getByRole("button", { name: "Build 150 lineups", exact: true }).click();
      await page.getByText("Built 150 lineups.", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Review portfolio", exact: true }).click();
      const original = await backup(page, `normal150-${width}.json`);
      assert.equal(original.batches.length, 1, "Normal review collects the single generated 150-lineup build");
      assert.equal(original.batches[0].lineups.length, 150);
      const summary = page.getByTestId("dfs-workflow-summary");
      const count = label => summary.locator("dl > div").filter({ has: page.getByText(label, { exact: true }) }).locator("dd").innerText();
      for (const label of ["Requested", "Generated", "Selected", "Unique"]) assert.equal(await count(label), "150");
      await page.getByRole("button", { name: "Review entries", exact: true }).click();
      const rows = await importEntries(page, 150);
      assert.equal(await count("Assigned"), "150");
      await page.getByRole("checkbox", { name: "I checked the slate and start time; none of the assigned players have locked.", exact: true }).check();
      const csv = await download(page, "Download DraftKings entry-update CSV", `normal150-${width}.csv`);
      const audit = JSON.parse((await download(page, "Download export audit", `normal150-audit-${width}.json`)).toString("utf8"));
      assert.equal(createHash("sha256").update(csv).digest("hex"), audit.hashes.output_csv_sha256);
      const exported = parseDfsCsv(csv.toString("utf8"));
      assert.equal(exported.length, 152); assert.deepEqual(exported[151], rows[151]);
      await page.getByText("Local draft saved", { exact: true }).waitFor();
      await page.reload(); await page.getByRole("button", { name: "Restore local draft", exact: true }).click();
      const restored = await backup(page, `normal150-restored-${width}.json`);
      assert.deepEqual(restored.batches, original.batches);
      assert.equal(await page.evaluate(() => window.__portfolioFixture.requests.length), 0);
      assert.equal(await page.getByRole("button", { name: "Assign lineups in order", exact: true }).count(), 0, "Recovered lineups require fresh entry review");
      assert.deepEqual(errors, []);
      results.push({ width, theme, synthetic: true, generated: 150, batches: 1, unique: 150,
        assigned: 150, unrelatedEntriesPreserved: 1, sealedCsvHashMatches: true, exactRestore: true, regenerated: false });
      console.log(`PASS normal 150 ${width} ${theme}: Generate → auto-collected review → entries → 150 assignments → sealed CSV → exact local recovery without regeneration`);
    } finally { await context.close(); }
  }
  return results;
}

export async function verifyWorkflow(browser) {
  await mkdir(output, { recursive: true });
  const report = [];
  let supplementalChecksComplete = false;
  let normal150 = [];
  try {
    for (const width of [390, 768, 1280, 1440]) for (const theme of ["dark", "light"]) {
      const context = await browser.newContext({ viewport: { width, height: 960 }, acceptDownloads: true, reducedMotion: "reduce" });
      await context.addInitScript(value => localStorage.setItem("scoresense-color-theme", value), theme);
      await attachDfsFixture(context);
      const page = await context.newPage(), errors = [], workers = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("worker", worker => workers.push(worker.url()));
      await page.goto(fixtureUrl);
      await page.getByRole("button", { name: "Lock Example 1", exact: true }).waitFor();
      const capabilities = page.getByTestId("dfs-capabilities");
      await capabilities.locator("summary").click();
      assert.equal(await capabilities.locator("[data-capability=identity]").innerText(), "Available");
      for (const key of ["roles", "joint", "field", "returns", "lateSwap"])
        assert.equal(await capabilities.locator(`[data-capability=${key}]`).innerText(), "Unavailable");
      assert.equal(await capabilities.locator("[data-capability=acceptance]").innerText(), "Unconfirmed");
      await startGlobalBuild(page);
      if ([390, 1280].includes(width)) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(output, `workflow-before-${width}-${theme}.png`) });
      }
      await page.locator(".dfw-build-button").click();
      await page.getByText("Built 3 lineups.", { exact: true }).waitFor();
      if ([390, 1280].includes(width)) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(output, `workflow-after-${width}-${theme}.png`) });
      }
      await page.getByRole("button", { name: "Review portfolio", exact: true }).click();
      const original = await backup(page, `original-${width}-${theme}.json`);
      assert.equal(original.batches.length, 1);
      assert.ok(workers.some(url => url.endsWith("/dfsPortfolioBackup.worker.js")), "Portable backup encoding runs in the actual production worker");
      assert.equal(original.batches[0].label, "Reviewed build", "The normal review action collects the generated set without batch arithmetic");
      const playerBounds = page.getByTestId("dfs-portfolio-review").locator("details").filter({ has: page.locator(":scope > summary", { hasText: "Player bounds across collection" }) });
      await playerBounds.locator("summary").click();
      await fit(playerBounds, "Collection player bounds");
      assert.equal(await playerBounds.locator("table").evaluate(table => table.scrollWidth <= table.parentElement.clientWidth + 1), true,
        "Player names, actual counts and all three collection bounds fit together");
      if ([390, 1280].includes(width)) await panelShot(page, playerBounds, `collection-player-bounds-${width}-${theme}.png`);
      await playerBounds.locator("summary").click();
      const summary = page.getByTestId("dfs-workflow-summary");
      const countValue = label => summary.locator("dl > div").filter({ has: page.getByText(label, { exact: true }) }).locator("dd").innerText();
      for (const label of ["Requested", "Generated", "Selected", "Unique"]) assert.equal(await countValue(label), "3");
      assert.equal(await countValue("Assigned"), "0");
      await choose(page, "Reserved-entry lineup source", "Current build");
      const status = page.getByTestId("dfs-build-status");
      await status.getByText("Last returned selection", { exact: true }).click();
      await status.getByText("synthetic workflow fixture response", { exact: true }).waitFor();
      for (const label of ["Bound", "Gap", "Runtime (seconds)"])
        assert.equal(await status.locator("dl > div").filter({ has: page.getByText(label, { exact: true }) }).locator("dd").innerText(), "Unavailable");

      await page.evaluate(() => { window.__portfolioFixture.delayOptimize = true; });
      await page.locator(".dfw-build-button").click();
      await status.getByText("Build request in progress", { exact: true }).waitFor();
      await status.getByText("3 previous lineups remain available.", { exact: true }).waitFor();
      assert.match(await status.innerText(), /\d+s elapsed/);
      assert.doesNotMatch(await status.innerText(), /\b\d+%|ETA|percent complete/i);
      const cancel = page.getByRole("button", { name: "Cancel build", exact: true });
      await cancel.focus(); await page.keyboard.press("Enter");
      await status.getByText("Build cancelled · previous result retained", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__portfolioFixture.optimizeAborts), 1);
      assert.equal(await visibleFocus(page), true, "Cancel returns keyboard focus to a visible control");
      assert.deepEqual((await backup(page, `cancelled-${width}-${theme}.json`)).batches, original.batches);
      // Also model a transport that ignores abort: the generation guard must
      // discard its late successful response without replacing reviewed work.
      const lateRun = await page.evaluate(() => { window.__portfolioFixture.ignoreOptimizeAbort = true; return window.__portfolioFixture.run; });
      await page.locator(".dfw-build-button").click(); await cancel.waitFor(); await cancel.click();
      await page.evaluate(() => window.__portfolioFixture.releaseOptimize());
      await page.waitForFunction(previous => window.__portfolioFixture.run === previous + 1, lateRun);
      await status.getByText("Build cancelled · previous result retained", { exact: true }).waitFor();
      assert.deepEqual((await backup(page, `late-${width}-${theme}.json`)).batches, original.batches);
      await page.evaluate(() => { Object.assign(window.__portfolioFixture, { delayOptimize: false, ignoreOptimizeAbort: false, failOptimize: true }); });
      await page.locator(".dfw-build-button").click();
      await status.getByText("Build failed · previous result retained", { exact: true }).waitFor();
      assert.deepEqual((await backup(page, `failed-${width}-${theme}.json`)).batches, original.batches);
      await page.evaluate(() => { Object.assign(window.__portfolioFixture, { failOptimize: false, partialCount: 2 }); });
      await page.locator(".dfw-build-button").click();
      await status.getByText("Partial result · review count and constraints", { exact: true }).waitFor();
      assert.equal(await countValue("Requested"), "3"); assert.equal(await countValue("Generated"), "2");
      await page.evaluate(() => { window.__portfolioFixture.partialCount = null; });
      await page.locator(".dfw-build-button").click(); await page.getByText("Built 3 lineups.", { exact: true }).waitFor();

      // Compare an accumulated audit with an explicitly chosen candidate. The
      // generated batches keep their own input contracts throughout this flow.
      await page.getByLabel("Batch label", { exact: true }).fill("Candidate sample B");
      await page.getByRole("button", { name: "Add current build to portfolio", exact: true }).click();
      const review = page.getByTestId("dfs-portfolio-review");
      const shared = review.locator("details").filter({ has: page.locator(":scope > summary", { hasText: "Shared construction" }) });
      await review.getByText("Shared construction", { exact: true }).click();
      const pair = shared.locator(".dfw-review-list").first().locator("li").filter({ has: page.getByText("Example 2 + Example 3", { exact: true }) });
      await pair.getByText("4 / 6 lineups · 2 batches", { exact: true }).waitFor();
      await pair.getByRole("button", { name: "Set collection bounds", exact: true }).click();
      const groupDisclosure = review.locator("details").filter({ has: page.locator(":scope > summary", { hasText: "Pair & core bounds across collection" }) });
      await groupDisclosure.getByRole("button", { name: "Add collection combination", exact: true }).click();
      const groupMaximum = groupDisclosure.getByRole("spinbutton", { name: "Maximum collection appearances: Example 2 + Example 3", exact: true });
      await groupMaximum.fill("3");
      await page.getByRole("alert").filter({ hasText: "4 appearances exceeds the maximum of 3" }).first().waitFor();
      await groupMaximum.fill("4");
      await groupDisclosure.getByRole("spinbutton", { name: "Target collection appearances: Example 2 + Example 3", exact: true }).fill("3.5");
      await groupDisclosure.getByText("Actual: 4 / 6 · Target miss: 0.5", { exact: true }).waitFor();
      await groupMaximum.locator("xpath=ancestor::li").getByRole("button", { name: "Show affected lineups", exact: true }).click();
      const support = page.getByTestId("dfs-portfolio-support");
      assert.equal(await support.locator("li").count(), 4);
      await support.getByRole("button", { name: "Review replacement for this lineup", exact: true }).first().click();
      await fit(groupDisclosure, "Collection pair bounds");
      if ([390, 1280].includes(width)) await panelShot(page, groupDisclosure, `collection-audit-${width}-${theme}.png`);
      await page.getByRole("button", { name: "Remove batch: Candidate sample B", exact: true }).click();
      assert.deepEqual((await backup(page, `audit-${width}-${theme}.json`)).batches, original.batches);
      await choose(page, "Reserved-entry lineup source", "Reviewed portfolio");
      await importEntries(page, 3); assert.equal(await countValue("Assigned"), "3");

      await choose(review, "Replacement scope", "Selected lineup");
      await choose(review, "Original lineup", "Reviewed build · lineup 2");
      await choose(review, "Candidate lineup", "After · lineup 2");
      const replacement = page.getByTestId("dfs-portfolio-replacement-preview");
      await review.getByRole("button", { name: "Preview selected-lineup replacement", exact: true }).click();
      await replacement.getByText("2 unchanged scoring lineups · 1 removed · 1 added. Slot permutations share one scoring identity.", { exact: true }).waitFor();
      await fitRosterTables(replacement);
      if ([390, 1280].includes(width)) await panelShot(page, replacement, `selected-replacement-${width}-${theme}.png`);
      assert.deepEqual((await backup(page, `replacement-preview-${width}-${theme}.json`)).batches, original.batches);
      await replacement.getByRole("button", { name: "Keep current collection", exact: true }).focus(); await page.keyboard.press("Enter");
      assert.equal(await visibleFocus(page), true, "Cancel replacement returns keyboard focus");
      assert.equal(await countValue("Assigned"), "3", "Cancelling a preview preserves the reviewed entry mapping");
      await review.getByRole("button", { name: "Preview selected-lineup replacement", exact: true }).click();
      await replacement.getByRole("button", { name: "Accept reviewed replacement", exact: true }).focus(); await page.keyboard.press("Enter");
      assert.equal(await visibleFocus(page), true, "Apply replacement returns keyboard focus");
      const selectedReplacement = await backup(page, `selected-replacement-${width}-${theme}.json`);
      assert.deepEqual(selectedReplacement.batches[0].lineups[0], original.batches[0].lineups[0]);
      assert.deepEqual(selectedReplacement.batches[0].lineups[2], original.batches[0].lineups[2]);
      assert.notDeepEqual(selectedReplacement.batches[0].lineups[1], original.batches[0].lineups[1]);
      assert.ok(selectedReplacement.batches[0].settings.replacement_manifest);
      assert.equal(await countValue("Assigned"), "0", "Accepting a material replacement clears entry mappings");
      assert.equal(await page.getByRole("button", { name: "Assign lineups in order", exact: true }).count(), 0);
      await review.getByRole("button", { name: "Undo batch replacement", exact: true }).click();
      assert.deepEqual((await backup(page, `selected-undo-${width}-${theme}.json`)).batches, original.batches);
      await choose(review, "Replacement scope", "Whole batch");
      await review.getByRole("button", { name: "Preview whole-batch replacement", exact: true }).click();
      await replacement.getByText("0 unchanged scoring lineups · 3 removed · 3 added. Slot permutations share one scoring identity.", { exact: true }).waitFor();
      assert.equal(await replacement.getByRole("button", { name: "Accept reviewed replacement", exact: true }).isDisabled(), false);
      await fit(replacement, "Replacement preview");
      assert.deepEqual(await replacement.evaluate(element => {
        const outer = element.getBoundingClientRect();
        return [...element.querySelectorAll(".dfw-review-compare tr,.dfw-review-compare th,.dfw-review-compare td")]
          .filter(cell => cell.getClientRects().length)
          .filter(cell => { const box = cell.getBoundingClientRect(); return box.left < outer.left - 1 || box.right > outer.right + 1; })
          .map(cell => cell.textContent.trim());
      }), [], "Replacement measurements, including numeric cells, fit the preview");
      if ([390, 1280].includes(width)) await replacement.screenshot({ path: path.join(output, `replacement-${width}-${theme}.png`) });
      await replacement.getByText("Changed roster examples", { exact: true }).click();
      await fitRosterTables(replacement);
      await replacement.getByText("Changed roster examples", { exact: true }).click();
      await replacement.getByRole("button", { name: "Accept reviewed replacement", exact: true }).click();
      const wholeReplacement = await backup(page, `whole-replacement-${width}-${theme}.json`);
      assert.notEqual(wholeReplacement.batches[0].id, original.batches[0].id);
      await review.getByRole("button", { name: "Undo batch replacement", exact: true }).click();
      assert.deepEqual((await backup(page, `whole-undo-${width}-${theme}.json`)).batches, original.batches);

      const navigation = page.getByRole("navigation", { name: "Player pool", exact: true });
      await navigation.getByRole("button", { name: "Exposure", exact: true }).click();
      await page.getByTestId("dfs-group-controls").locator("summary").evaluate(summary => { if (!summary.parentElement.open) summary.click(); });
      await page.getByRole("button", { name: "Remove combination: Reviewed RB core", exact: true }).click();
      await page.evaluate(() => { window.__portfolioFixture.allAlternateRb = true; });
      await page.locator(".dfw-build-button").click(); await page.getByText("Built 3 lineups.", { exact: true }).waitFor();
      await review.getByRole("button", { name: "Preview whole-batch replacement", exact: true }).click();
      await replacement.getByText(/Approved core .*below preserved minimum 2/).waitFor();
      assert.equal(await replacement.getByRole("button", { name: "Accept reviewed replacement", exact: true }).isDisabled(), true);
      assert.deepEqual((await backup(page, `blocked-core-${width}-${theme}.json`)).batches, original.batches);
      await replacement.getByRole("button", { name: "Keep current collection", exact: true }).click();

      await navigation.getByRole("button", { name: "Player pool", exact: true }).click();
      const player = page.getByRole("button", { name: "Lock Example 1", exact: true }).locator("xpath=ancestor::tr");
      const projection = () => player.getByRole("cell").nth(2).innerText();
      assert.equal(await projection(), "10.0");
      await page.evaluate(() => { window.__portfolioFixture.poolVersion = 1; window.__portfolioFixture.publishDataRevision(); });
      await page.getByRole("button", { name: "Check player update", exact: true }).click();
      const update = page.getByTestId("dfs-pool-update-preview");
      await update.getByText("1 affected player", { exact: true }).waitFor();
      await update.getByText("Input version 1 → 2", { exact: true }).waitFor();
      assert.equal(await projection(), "10.0", "A preview cannot silently change working forecasts");
      assert.deepEqual((await backup(page, `update-preview-${width}-${theme}.json`)).batches, original.batches);
      await fit(update, "Input preview");
      if ([390, 1280].includes(width)) await update.screenshot({ path: path.join(output, `input-update-${width}-${theme}.png`) });
      const keep = update.getByRole("button", { name: "Keep current inputs", exact: true });
      await keep.focus(); await page.keyboard.press("Enter");
      assert.equal(await projection(), "10.0");
      assert.equal(await visibleFocus(page), true, "Keeping inputs returns focus to a visible control");
      await page.evaluate(() => window.__portfolioFixture.publishDataRevision());
      await page.getByRole("button", { name: "Check player update", exact: true }).click();
      await update.getByRole("button", { name: "Use reviewed inputs", exact: true }).waitFor();
      await update.getByRole("button", { name: "Use reviewed inputs", exact: true }).focus(); await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelector(".dfw-table tbody tr td.num") != null);
      assert.equal(await projection(), "12.0");
      assert.equal(await visibleFocus(page), true, "Applying inputs keeps visible keyboard focus");
      assert.deepEqual((await backup(page, `update-applied-${width}-${theme}.json`)).batches, original.batches, "Updates preserve original historical forecasts");
      await update.getByRole("button", { name: "Undo input update", exact: true }).click();
      assert.equal(await projection(), "10.0");
      await update.getByText("Update undone", { exact: false }).waitFor();

      await page.evaluate(() => { window.__portfolioFixture.failPool = true; window.__portfolioFixture.publishDataRevision(); });
      await page.getByRole("button", { name: "Check player update", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: /refresh|update/i }).first().waitFor();
      assert.equal(await projection(), "10.0");
      await page.evaluate(() => { Object.assign(window.__portfolioFixture, { failPool: false, failSalaryImport: true }); });
      await page.getByLabel("Import salary CSV", { exact: true }).setInputFiles({ name: "invalid-salary.csv", mimeType: "text/csv", buffer: Buffer.from("wrong,columns\n1,2") });
      await page.getByRole("alert").filter({ hasText: "Synthetic invalid salary file" }).first().waitFor();
      assert.equal(await projection(), "10.0", "A rejected salary file preserves usable inputs");
      assert.equal(await page.getByRole("button", { name: "Lock Example 1", exact: true }).getAttribute("aria-pressed"), "true");
      assert.deepEqual((await backup(page, `invalid-import-${width}-${theme}.json`)).batches, original.batches);

      await choose(page, "Reserved-entry lineup source", "Reviewed portfolio");
      const rows = await importEntries(page, 3);
      await page.getByRole("checkbox", { name: "I checked the slate and start time; none of the assigned players have locked.", exact: true }).check();
      const bytes = await download(page, "Download DraftKings entry-update CSV", `entries-${width}-${theme}.csv`);
      const audit = JSON.parse((await download(page, "Download export audit", `export-audit-${width}-${theme}.json`)).toString("utf8"));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), audit.hashes.output_csv_sha256);
      assert.deepEqual(parseDfsCsv(bytes.toString("utf8"))[4], rows[4], "Unrelated reservation stays byte-equivalent at the cell level");
      assert.equal(await capabilities.locator("[data-capability=acceptance]").innerText(), "Unconfirmed");
      await fit(summary, "Workflow summary");
      await capabilities.scrollIntoViewIfNeeded();
      const measurements = await page.evaluate(measureScript(), { minTarget: minTargetForWidth(width), numericRe: NUMERIC_RE.source,
        barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX, columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS });
      assert.deepEqual(measurements.filter(result => !result.ok), [], `${width} ${theme} workflow layout`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.getByText("Local draft saved", { exact: true }).waitFor(); await page.reload();
      await page.getByRole("button", { name: "Restore local draft", exact: true }).click();
      assert.deepEqual((await backup(page, `recovered-${width}-${theme}.json`)).batches, original.batches);
      assert.equal(await page.evaluate(() => window.__portfolioFixture.requests.length), 0, "Reload recovery never regenerates lineups");
      assert.deepEqual(errors, []);
      report.push({ width, theme, synthetic: true, taskPassed: true, workerObserved: true, state: "cancel/retry + audit/replacement + versioned update + recovery/export", measurements });
      console.log(`PASS workflow ${width} ${theme}: capabilities/counts, cancel+late response+retry+partial result, combined pair/core bounds, selected/whole replacement+undo/core protection, input preview/apply/undo, failed refresh/import preservation, worker recovery and sealed CSV`);
      await context.close();
    }
    await verifyBackgroundRefresh(browser);
    await verifyStaleFilesAndDiscard(browser);
    normal150 = await verifyNormal150(browser);
    supplementalChecksComplete = true;
  } finally {
    await writeFile(path.join(output, "report.json"), JSON.stringify({ synthetic: true, report, normal150, supplementalChecksComplete,
      supplementalChecks: ["hidden-tab scheduled refresh", "live update retains imported estimates", "delayed estimate context guard", "latest estimate selection and input version guard", "latest entry-template selection", "delayed entry account guard", "delete during pending autosave"] }, null, 2));
  }
  assert.ok(report.length === 8 && report.every(result => result.taskPassed), "Workflow acceptance is not complete");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const browser = await chromium.launch({ headless: true });
  try {
    if (process.argv.includes("--normal-150-only")) {
      await mkdir(output, { recursive: true });
      await writeFile(path.join(output, "normal150-report.json"), JSON.stringify({ synthetic: true, results: await verifyNormal150(browser) }, null, 2));
    } else if (process.argv.includes("--supplemental-only")) {
      await mkdir(output, { recursive: true });
      await verifyBackgroundRefresh(browser);
      await verifyStaleFilesAndDiscard(browser);
      await writeFile(path.join(output, "supplemental-report.json"), JSON.stringify({ synthetic: true, passed: true,
        checks: ["hidden-tab scheduled refresh", "live update retains imported estimates", "delayed estimate context guard", "latest estimate selection and input version guard", "latest entry-template selection", "delayed entry account guard", "delete during pending autosave"] }, null, 2));
    } else await verifyWorkflow(browser);
  }
  finally { await browser.close(); }
}
