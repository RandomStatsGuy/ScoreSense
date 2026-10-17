// Current guided DFS flow, real components with isolated synthetic responses.
// No app server, account, provider request or platform upload is contacted.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachDfsFixture } from "./dfs_fixture_runtime.mjs";
import { DFS_WORKSPACE_COPY as C, DFS_RESULTS_COPY as R,
  DFS_FLOW_COPY as F, DFS_GLOBAL_COPY as G, DFS_WORKFLOW_COPY as W,
  DFS_SHOWDOWN_COPY as S } from "../../frontend/src/dfsToolPresentation.js";
import { resultTotals } from "../../frontend/src/dfsResults.js";
import { csvLines, parseDfsCsv } from "../../frontend/src/dfsCsv.js";
import { measureScript, minTargetForWidth, NUMERIC_RE, BAR_CONTROL_SELECTOR,
  TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "frontend/package.json"));
const { chromium } = require("playwright");
const output = path.join(root, "outputs/dfs-guided-workflows");
const base = "http://127.0.0.1:5173/test-fixtures/dfs-workspace.html";
const report = { synthetic: true, productionComponents: true, scenarios: [] };
const file = (name, text) => ({ name, mimeType: "text/csv", buffer: Buffer.from(text) });
const note = "Sample assumption saved before reviewing results.";
const browser = await chromium.launch({ headless: true,
  channel: process.platform === "win32" ? "msedge" : undefined });
await fs.mkdir(output, { recursive: true });

async function setup(width, theme, state = "workflow") {
  const context = await browser.newContext({ viewport: { width, height: 960 },
    acceptDownloads: true, colorScheme: theme, reducedMotion: "reduce", serviceWorkers: "block" });
  const blocked = [], errors = [];
  await context.route("**/*", route => { blocked.push(route.request().url()); return route.abort(); });
  await context.addInitScript(theme => localStorage.setItem("scoresense-color-theme", theme), theme);
  await attachDfsFixture(context, { fixture: "dfs-workspace" });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => errors.push(error.message));
  // A controlled clock lets the pre-lock check advance past the retained kickoff.
  await page.clock.install({ time: new Date("2026-10-01T12:00:00Z") });
  if (state === "loading") await page.clock.pauseAt(new Date("2026-10-01T12:00:00Z"));
  await page.goto(`${base}?state=${state}`);
  await page.getByTestId("dfs-generate").waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
  return { context, page, errors, blocked };
}
async function disclose(scope, name) {
  const summary = scope.locator("summary").filter({ hasText: name }).filter({ visible: true }).first();
  const details = summary.locator("..");
  if (!await details.evaluate(element => element.open)) await summary.click();
  return details;
}
async function stage(page, name) {
  const button = page.getByTestId(`dfs-flow-${name}`);
  await button.focus(); await page.keyboard.press("Enter");
  await page.waitForFunction(name => document.querySelector(`[data-testid="dfs-flow-${name}"]`)?.getAttribute("aria-current") === "step", name);
}
async function choose(scope, label, value) {
  await scope.getByRole("button", { name: new RegExp(`^${RegExp.escape(label)}:`) }).click();
  await scope.getByRole("option", { name: value, exact: true }).click();
}
async function audit(page, width, theme, state) {
  const layout = await page.evaluate(measureScript(), { minTarget: minTargetForWidth(width),
    numericRe: NUMERIC_RE.source, barControlSelector: BAR_CONTROL_SELECTOR,
    tableDeadZonePx: TABLE_DEAD_ZONE_PX, columnPackRatio: COLUMN_PACK_RATIO,
    gutterSelectors: GUTTER_EDGE_SELECTORS });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  const name = `${state}-${width}-${theme}`;
  await fs.writeFile(path.join(output, `${name}.json`), JSON.stringify({ layout, overflow }, null, 2));
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
  if (state === "results") {
    await page.screenshot({ path: path.join(output, `${name}-top.png`) });
    await page.locator(".dfw-results-grid").screenshot({ path: path.join(output, `${name}-selected.png`) });
  }
  assert.equal(overflow, false, `${name}: overflow`);
  assert.deepEqual(layout.filter(row => !row.ok), [], `${name}: layout`);
  return { state, layout, overflow };
}
async function download(page, label) {
  const pending = page.waitForEvent("download"); pending.catch(() => {});
  await page.getByRole("button", { name: label, exact: true }).filter({ visible: true }).click();
  const result = await pending;
  return fs.readFile(await result.path(), "utf8");
}
async function build(page, imported = true) {
  await choose(page, C.format, "DraftKings Showdown");
  await page.getByTestId("dfs-generate").waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector('[data-testid="dfs-generate"]').disabled);
  await page.getByRole("spinbutton", { name: C.count, exact: true }).fill("2");
  if (imported) {
    await page.getByLabel(C.importEstimates, { exact: true }).setInputFiles(
      file("projections.csv", "ID,Proj,Floor,Ceiling,Ownership\n205,9,4,18,15"));
    await page.getByText("Imported projections for 1 players. Rebuild to apply them.", { exact: true }).waitFor();
  }
  const advanced = await disclose(page, F.advanced);
  await choose(advanced, C.captain, "Blake Corum");
  const players = await disclose(page, F.choose);
  await players.getByRole("row").filter({ hasText: "Puka Nacua" })
    .getByRole("button", { name: /^Captain max:/ }).click();
  await page.getByRole("option", { name: "25%", exact: true }).click();
  await players.getByRole("button", { name: C.notes, exact: true }).click();
  await players.locator("textarea").fill(note);
  await page.getByTestId("dfs-generate").click();
  await page.getByText("Built 2 lineups.", { exact: true }).waitFor();
  assert.equal(await page.getByTestId("dfs-flow-review").getAttribute("aria-current"), "step");
}

try {
  for (const width of [1280, 390]) for (const theme of ["light", "dark"]) {
    const { context, page, errors, blocked } = await setup(width, theme);
    const checks = [];
    try {
      for (const id of ["dfs-advanced", "dfs-choose-players", "dfs-research", "dfs-recovery"]) {
        const details = page.getByTestId(id);
        if (await details.count()) assert.equal(await details.evaluate(element => element.open), false, `${id} starts closed`);
      }
      checks.push(await audit(page, width, theme, "build"));
      await build(page);
      const request = await page.evaluate(() => window.__lastDfsRequest);
      assert.equal(request.lineup_count, 2);
      assert.equal(request.locked_captain_id, "p5");
      assert.equal(request.captain_exposure_limits.p0, 0.25);
      assert.equal(request.projection_overrides.p5.proj, 9);
      await disclose(page, F.appearances);
      assert.equal(await page.locator(".dfw-actual-exposure tbody tr").count(), 7);
      await disclose(page, C.selected);
      await page.getByRole("button", { name: C.save, exact: true }).click();
      await page.getByRole("button", { name: C.saved, exact: true }).waitFor();
      const saved = await page.evaluate(() => window.__lastDfsSavedBuild);
      assert.equal(saved.note, note);
      assert.equal(saved.lineups[0].lineup[0].proj, 13.5, "Captain multiplier applies once to imported input");
      checks.push(await audit(page, width, theme, "review"));
      // Editing future-build controls cannot rewrite the reviewed snapshot.
      await stage(page, "build");
      await page.getByRole("spinbutton", { name: C.count, exact: true }).fill("3");
      await stage(page, "download");
      await disclose(page, F.newCsv);
      let downloads = 0; page.on("download", () => downloads++);
      await page.evaluate(() => { window.__dfsAccessDenied = true; });
      await page.getByRole("button", { name: C.download, exact: true }).click();
      await page.getByRole("alert").filter({ hasText: S.downloadAccess }).waitFor();
      assert.equal(downloads, 0, "Revoked access blocks My Lineups download");
      await page.evaluate(() => { window.__dfsAccessDenied = false; });
      const newCsv = parseDfsCsv(await download(page, C.download));
      assert.equal(newCsv.length, 3, "Uses the two reviewed lineups, not the edited request count");
      assert.equal(newCsv[0][0], "CPT");
      assert.equal(newCsv[1][0], "Blake Corum (105)");
      assert.notDeepEqual(newCsv[1], newCsv[2], "Two distinct legal fixture lineups");
      const template = [["Entry ID", "Contest Name", "Contest ID", "Entry Fee", "CPT", "FLEX", "FLEX", "FLEX", "FLEX", "FLEX", "Note"],
        ["0001", "Sample contest", "0010", "$5", ...Array(6).fill("Keep"), "Original metadata"],
        ["0002", "Sample contest", "0010", "$5", ...Array(6).fill("Keep"), "Second reservation"],
        ["0099", "Other contest", "0090", "$7", ...Array(6).fill("Untouched"), "Unrelated metadata"]];
      await page.getByLabel(C.template, { exact: true }).setInputFiles(file("entries.csv", csvLines(template).join("\n")));
      assert.equal(await page.getByRole("button", { name: C.sequential, exact: true }).isDisabled(), true, "Choose a contest before assigning");
      await choose(page, G.contest, G.selectedContest("Sample contest", 2));
      await page.getByRole("button", { name: C.sequential, exact: true }).click();
      const reviewed = page.getByRole("button", { name: W.downloadReviewed, exact: true });
      assert.equal(await reviewed.isDisabled(), true, "Pre-lock attestation required");
      await page.getByLabel(G.prelock, { exact: true }).check();
      // The validated file is sealed before optional history writes. Recover it,
      // retry the same history update, then compare the exact downloaded bytes.
      await page.evaluate(() => { window.__dfsHistorySyncFailure = true; });
      const beforePending = downloads;
      await reviewed.click();
      await page.getByText(G.pending, { exact: true }).waitFor();
      assert.equal(downloads, beforePending, "Pending sync requires an explicit recovery action");
      await page.evaluate(() => { window.__dfsAccessDenied = true; });
      await page.getByRole("button", { name: G.recovery, exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Sign in to this account again" }).waitFor();
      assert.equal(downloads, beforePending, "Recovery also checks current access");
      await page.evaluate(() => { window.__dfsAccessDenied = false; });
      const recovery = await download(page, G.recovery);
      await page.evaluate(() => { window.__dfsHistorySyncFailure = false; });
      await page.getByRole("button", { name: G.retry, exact: true }).click();
      await page.getByText(G.synced, { exact: true }).waitFor();
      const final = await download(page, W.downloadReviewed);
      assert.equal(final, recovery, "Recovery and retry use the same sealed CSV");
      const rows = parseDfsCsv(final);
      assert.deepEqual(rows[0], template[0]);
      assert.deepEqual(rows[1].slice(0, 4), template[1].slice(0, 4));
      assert.deepEqual(rows[2].slice(0, 4), template[2].slice(0, 4));
      assert.deepEqual(rows[1].slice(4, 10), newCsv[1]);
      assert.deepEqual(rows[2].slice(4, 10), newCsv[2]);
      assert.equal(rows[1][10], template[1][10]);
      assert.equal(rows[2][10], template[2][10]);
      assert.deepEqual(rows[3], template[3], "Unassigned reservation preserved exactly");
      assert.deepEqual(await page.evaluate(() => window.__lastDfsSavedBuild), saved, "Original build inputs remain unchanged");
      const manifest = JSON.parse(await download(page, G.manifest));
      assert.equal(manifest.acceptance, "unconfirmed");
      assert.equal(manifest.prelockEvidence.status, "known_not_started");
      assert.equal(manifest.selectedEntryCount, 2);
      checks.push(await audit(page, width, theme, "download"));
      await page.getByRole("button", { name: C.results, exact: true }).click();
      await page.getByText("$710.00", { exact: true }).first().waitFor();
      const history = file("history.csv", "Entry ID,Contest ID,Contest Name,Date,Entry Fee,Winnings,Points,Rank\n0001,0010,Sample contest,10/01/2026,5,20,110,12");
      for (let index = 0; index < 2; index++) {
        await page.getByLabel(R.history, { exact: true }).filter({ visible: true }).first().setInputFiles(history);
        await page.getByRole("button", { name: R.preview, exact: true }).click();
        await page.getByRole("button", { name: R.saveImport, exact: true }).click();
        await page.getByText("+$125.00", { exact: true }).first().waitFor();
        await page.getByRole("button", { name: R.saveImport, exact: true }).waitFor({ state: "detached" });
      }
      assert.equal((await page.evaluate(() => window.__dfsLedger().entries)).length, 122, "Re-import updates existing identity");
      const totals = resultTotals(await page.evaluate(() => window.__dfsLedger().entries));
      assert.equal(totals.fees, 60500); assert.equal(totals.payouts, 73000);
      await page.getByRole("button", { name: R.next, exact: true }).click();
      await page.getByRole("button", { name: R.next, exact: true }).click();
      const row = page.locator(".dfw-entry-table tbody tr").filter({ hasText: "Sample contest" }).first();
      await row.focus(); await page.keyboard.press("Enter");
      await page.getByText(note, { exact: true }).waitFor();
      const projected = saved.lineups[0].lineup.reduce((sum, row) => sum + row.proj, 0).toFixed(1);
      await page.locator(".dfw-review-row").filter({ hasText: R.projection }).getByText(projected, { exact: true }).waitFor();
      await page.locator(".dfw-results-grid textarea").fill("Sample postgame note.");
      await page.getByRole("button", { name: R.saveNote, exact: true }).click();
      await page.waitForFunction(() => window.__dfsLedger().entries.some(entry => entry.entry_id === "0001" && entry.note === "Sample postgame note."));
      checks.push(await audit(page, width, theme, "results"));
      await page.getByRole("button", { name: C.build, exact: true }).filter({ visible: true }).first().click();
      await stage(page, "download");
      await disclose(page, F.newCsv);
      await page.evaluate(() => { window.__dfsUnavailableId = "p5"; });
      const beforeUnavailable = downloads;
      await page.getByRole("button", { name: C.download, exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Current unavailable status" }).waitFor();
      assert.equal(downloads, beforeUnavailable, "Fresh unavailable status blocks Showdown export");
      await stage(page, "build");
      await disclose(page, F.advanced);
      const calendar = page.locator("details.dfw-calendar");
      if (!await calendar.evaluate(element => element.open)) await calendar.locator("summary").click();
      await choose(calendar, "Week", "2");
      await page.getByRole("button", { name: `${C.captain}: ${C.anyCaptain}`, exact: true }).waitFor();
      assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
      report.scenarios.push({ width, theme, workflow: "PASS", checks });
      console.log(`PASS guided workflow ${width}/${theme}`);
    } catch (error) {
      await fs.writeFile(path.join(output, "failure.txt"), `${error.stack}\n${await page.locator("body").innerText()}`);
      await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
      throw error;
    } finally { await context.close(); }
  }
  for (const width of [1280, 390]) for (const state of ["loading", "empty", "error", "readonly", "workflow"]) {
    const { context, page, errors, blocked } = await setup(width, "light", state);
    try {
      if (state === "loading") {
        await disclose(page, F.choose);
        await page.getByLabel(C.loading).first().waitFor();
        await page.clock.runFor(1500);
        await page.waitForFunction(() => !document.querySelector('[data-testid="dfs-generate"]').disabled);
      } else if (state === "empty") {
        await disclose(page, F.choose);
        await page.getByText(C.noPlayers, { exact: true }).waitFor();
        assert.equal(await page.getByTestId("dfs-generate").isDisabled(), true);
        await page.getByRole("button", { name: C.results, exact: true }).click();
        await page.getByText(R.emptyTitle, { exact: true }).waitFor();
      } else if (state === "error") {
        await page.getByRole("alert").filter({ hasText: "Sample salary service failure" }).waitFor();
      } else if (state === "readonly") {
        await page.getByRole("button", { name: C.results, exact: true }).click();
        await page.getByRole("alert").filter({ hasText: "Sign in" }).waitFor();
      } else {
        await build(page, false); await stage(page, "download"); await disclose(page, F.newCsv);
        const saved = await page.evaluate(() => window.__lastDfsRequest);
        await page.clock.fastForward(86400001);
        let downloads = 0; page.on("download", () => downloads++);
        await page.getByRole("button", { name: C.download, exact: true }).click();
        await page.getByRole("alert").filter({ hasText: "scheduled game has started" }).waitFor();
        assert.equal(downloads, 0, "Known kickoff blocks pre-lock export");
        assert.deepEqual(await page.evaluate(() => window.__lastDfsRequest), saved);
        const header = ["Entry ID", "Contest Name", "Contest ID", "Entry Fee", "CPT", "FLEX", "FLEX", "FLEX", "FLEX", "FLEX"];
        const entries = [header, ...["0001", "0002"].map(id => [id, "Started contest", "0010", "$5", ...Array(6).fill("")])];
        await page.getByLabel(C.template, { exact: true }).setInputFiles(file("started.csv", csvLines(entries).join("\n")));
        await page.getByRole("button", { name: C.sequential, exact: true }).click();
        await page.getByLabel(G.prelock, { exact: true }).check();
        assert.equal(await page.getByRole("button", { name: W.downloadReviewed, exact: true }).isDisabled(), true,
          "Known kickoff also blocks reserved-entry updates");
      }
      assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
      report.scenarios.push({ width, theme: "light", state: state === "workflow" ? "started" : state, passed: true });
      console.log(`PASS ${state === "workflow" ? "started" : state} ${width}`);
    } finally { await context.close(); }
  }
} finally {
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log("PASS: current Build / Review / Download / Results, frozen inputs, both CSVs, entry metadata, recovery, access/status/kickoff guards, idempotent imports and review notes.");
