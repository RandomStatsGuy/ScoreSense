import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { attachDfsFixture } from "./dfs_fixture_runtime.mjs";
import { readPortfolioBackup } from "../../frontend/src/dfsPortfolioBackup.js";
import { csvLines, parseDfsCsv } from "../../frontend/src/dfsCsv.js";
import { exposureBoundCount } from "../../frontend/src/dfsExposureBounds.js";
import { measureScript, minTargetForWidth, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX,
  COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";

// Synthetic responses prove UI/request/recovery behavior; real engine selection
// and pair-cap enforcement have their own Python/Node integration checks.
export async function verifyGuardrails(browser, root) {
  const output = path.join(root, "outputs/dfs-guardrails-review"), report = [];
  await mkdir(output, { recursive: true });
  const downloadJson = async (page, button, name) => {
    const pending = page.waitForEvent("download"); await page.getByRole("button", { name: button, exact: true }).click();
    const file = path.join(output, name); await (await pending).saveAs(file);
    return readFile(file, "utf8");
  };
  const choose = async (scope, label, option) => {
    await scope.getByRole("button", { name: new RegExp(`^${label}:`) }).click();
    await scope.getByRole("option", { name: option, exact: true }).click();
  };
  const fit = async (scope, label) => assert.deepEqual(await scope.evaluate(element => {
    const outer = element.getBoundingClientRect();
    return [...element.querySelectorAll("button, input:not([type=file])")].filter(control => control.getClientRects().length)
      .filter(control => { const box = control.getBoundingClientRect(); return box.left < outer.left - 1 || box.right > outer.right + 1; })
      .map(control => control.getAttribute("aria-label") || control.textContent || control.type);
  }), [], `${label}: controls fit the visible panel`);
  try {
    for (const width of [390, 768, 1280, 1440]) for (const theme of ["dark", "light"]) {
      const context = await browser.newContext({ viewport: { width, height: 960 }, acceptDownloads: true, reducedMotion: "reduce" });
      await context.addInitScript(value => localStorage.setItem("scoresense-color-theme", value), theme);
      await attachDfsFixture(context);
      const page = await context.newPage(), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto("http://127.0.0.1:5173/test-fixtures/dfs-portfolio.html?guardrails");
      await page.getByRole("button", { name: "Lock Example 1", exact: true }).waitFor();
      const count = page.getByRole("spinbutton", { name: "Lineups", exact: true });
      const navigation = page.getByRole("navigation", { name: "Player pool", exact: true });
      const global = page.locator("[aria-labelledby='dfw-global-title']");
      await count.fill("3"); await choose(page, "Minimum differences", "1");
      await navigation.getByRole("button", { name: "Exposure", exact: true }).click();
      await page.getByRole("checkbox", { name: "Select the portfolio together", exact: true }).check();
      const groups = page.getByTestId("dfs-group-controls"); await groups.locator("summary").click();
      await groups.getByRole("button", { name: "Add combination", exact: true }).click();
      await groups.getByRole("alert").filter({ hasText: "Choose 2 to 9 players" }).waitFor();
      const member = async number => {
        await groups.getByLabel("Find a combination member", { exact: true }).fill(`Example ${number}`);
        await groups.getByRole("checkbox", { name: new RegExp(`^Example ${number}\\b`) }).first().check();
      };
      await groups.getByLabel("Combination label (optional)", { exact: true }).fill("RB support pair");
      await member(2); await member(3); await groups.getByRole("button", { name: "Add combination", exact: true }).click();
      const pairMin = page.getByRole("spinbutton", { name: "Minimum combination: RB support pair", exact: true });
      const pairTarget = page.getByRole("spinbutton", { name: "Target combination: RB support pair", exact: true });
      const pairMax = page.getByRole("spinbutton", { name: "Maximum combination: RB support pair", exact: true });
      await pairMin.fill("80"); await pairMax.fill("40"); await page.locator(".dfw-build-button").click();
      await page.getByRole("alert").filter({ hasText: /minimum 3 exceeds maximum 1/ }).first().waitFor();
      assert.equal(await page.evaluate(() => window.__portfolioFixture.requests.length), 0);
      await pairMin.fill("50"); await pairTarget.fill("50"); await pairMax.fill("80");
      await choose(page, "Exposure units", "Appearances");
      assert.equal(await pairMin.inputValue(), "2"); assert.equal(await pairTarget.inputValue(), "1.5"); assert.equal(await pairMax.inputValue(), "2");
      await choose(page, "Exposure units", "Percent");
      await pairMin.fill("50"); await pairTarget.fill("50"); await pairMax.fill("80");
      await member(2); await member(3); await groups.getByRole("button", { name: "Add combination", exact: true }).click();
      await groups.getByRole("alert").filter({ hasText: "This combination already has controls" }).waitFor();
      await groups.getByLabel("Combination label (optional)", { exact: true }).fill("QB and RB core");
      await member(1); await member(2); await member(3); await groups.getByRole("button", { name: "Add combination", exact: true }).click();
      await navigation.getByRole("button", { name: "Player pool", exact: true }).click();
      const poolSearch = page.getByPlaceholder("Search players…", { exact: true });
      await poolSearch.fill("Example 2"); await page.getByRole("button", { name: "Lock Example 2", exact: true }).click();
      await poolSearch.fill("Example 16"); await page.getByRole("button", { name: "Skip Example 16", exact: true }).click();
      await page.getByText("Stacking & other rules", { exact: true }).click();
      const stack = page.getByTestId("dfs-exact-stacks"), stackSections = stack.locator(":scope > .dfw-settings-grid");
      for (const [index, label] of [[0, "Same-team attachments"], [1, "Opposing players"]]) {
        for (const mode of ["At least", "At most", "Optional", "Forbidden"]) {
          await choose(stackSections.nth(index), label, mode);
          assert.equal(await stackSections.nth(index).getByRole("button", { name: /^Player count:/ }).isDisabled(), ["Optional", "Forbidden"].includes(mode));
          if (mode === "Optional") assert.match(await stackSections.nth(index).innerText(), /neither required nor banned/);
          if (mode === "Forbidden") assert.match(await stackSections.nth(index).innerText(), /No .* allowed/);
        }
      }
      await choose(stackSections.nth(0), "Same-team attachments", "Exactly"); await choose(stackSections.nth(0), "Player count", "4");
      await choose(stackSections.nth(1), "Opposing players", "Exactly"); await choose(stackSections.nth(1), "Player count", "3");
      await stack.getByText("Qualifying receiving RBs", { exact: true }).click();
      await stack.getByRole("checkbox", { name: /^Example 3\b/ }).check();
      await stack.getByRole("checkbox", { name: /^Example 179\b/ }).check();
      const plans = page.getByTestId("dfs-build-plans"); await plans.locator("summary").click();
      await plans.getByLabel("Plan name", { exact: true }).fill("Reviewed fixture strategy");
      const planText = await downloadJson(page, "Download build plan", `strategy-${width}-${theme}.json`), plan = JSON.parse(planText);
      assert.deepEqual(plan.inputs.locked_player_ids, ["p2"]); assert.deepEqual(plan.inputs.excluded_player_ids, ["p16"]);
      const pairRule = plan.inputs.group_exposure_limits.find(group => group.player_ids.length === 2);
      assert.deepEqual({ min: pairRule.min, max: pairRule.max }, { min: "0.5", max: "0.8" });
      assert.equal(exposureBoundCount(pairRule.target, 3, "target"), 1.5);
      await page.locator(".dfw-build-button").click(); await page.getByText("Built 3 lineups.", { exact: true }).waitFor();
      await navigation.getByRole("button", { name: "Exposure", exact: true }).click();
      await page.getByText("3 of 3 selected", { exact: false }).waitFor();
      const initialRequest = await page.evaluate(() => window.__portfolioFixture.requests.at(-1));
      assert.deepEqual(initialRequest.projection_overrides, {});
      assert.deepEqual(initialRequest.classic_stack_rules, { version: 1, attachments: { mode: "exact", count: 4, receiving_rb_ids: ["p179", "p3"] }, bring_back: { mode: "exact", count: 3 } });
      await page.getByLabel("Batch label", { exact: true }).fill("Phase 2 synthetic batch");
      await page.getByRole("button", { name: "Add current build to portfolio", exact: true }).click();
      const original = readPortfolioBackup(await downloadJson(page, "Download portfolio backup", `before-plan-${width}-${theme}.json`));
      await navigation.getByRole("button", { name: "Exposure", exact: true }).click();
      if (await groups.getAttribute("open") === null) await groups.locator("summary").click();
      assert.match(await groups.locator(".dfw-exposure-row").filter({ hasText: "RB support pair" }).innerText(), /Actual: 2 of 3 generated/);
      await fit(global, `${width} ${theme} group editor`);
      await groups.screenshot({ path: path.join(output, `groups-${theme}-${width}.png`) });
      // The old legacy controls intentionally contain stale locks, skips and a
      // weighted schedule. Preview/cancel preserves them; Apply replaces all.
      await page.getByRole("checkbox", { name: "Select the portfolio together", exact: true }).uncheck();
      await navigation.getByRole("button", { name: "Player pool", exact: true }).click();
      await page.getByRole("button", { name: "Clear locks and skips", exact: true }).click();
      await poolSearch.fill("Example 1"); await page.getByRole("button", { name: "Lock Example 1", exact: true }).click();
      await poolSearch.fill("Example 15"); await page.getByRole("button", { name: "Skip Example 15", exact: true }).click();
      await count.fill("2"); await page.getByRole("button", { name: /^Raise stack weight:/ }).click();
      const importPlan = () => plans.getByLabel("Import build plan", { exact: true }).setInputFiles({ name: "strategy.json", mimeType: "application/json", buffer: Buffer.from(planText) });
      await importPlan(); await plans.getByRole("region", { name: "Plan preview", exact: true }).waitFor();
      assert.equal(await count.inputValue(), "2");
      assert.match(await plans.innerText(), /Game allocation schedule/);
      await fit(plans, `${width} ${theme} plan preview`);
      await plans.screenshot({ path: path.join(output, `plan-${theme}-${width}.png`) });
      await plans.getByRole("button", { name: "Keep current controls", exact: true }).focus(); await page.keyboard.press("Enter");
      assert.equal(await plans.getByRole("button", { name: "Import build plan", exact: true }).evaluate(button => document.activeElement === button), true,
        "Keyboard Cancel returns focus to the visible Import trigger");
      assert.equal(await count.inputValue(), "2"); assert.equal(await page.evaluate(() => window.__portfolioFixture.requests.length), 1);
      await importPlan(); await plans.getByRole("button", { name: "Apply reviewed plan", exact: true }).focus(); await page.keyboard.press("Enter");
      assert.equal(await plans.getByRole("button", { name: "Import build plan", exact: true }).evaluate(button => document.activeElement === button), true,
        "Keyboard Apply returns focus to the visible Import trigger");
      await plans.getByText("Applied controls match the plan. The same match is checked again before Build.", { exact: true }).waitFor();
      assert.equal(await count.inputValue(), "3"); assert.equal(await page.evaluate(() => window.__portfolioFixture.requests.length), 1, "Apply does not build");
      assert.equal(await page.locator(".dfw-matchup-card.is-active").count(), 0, "Old schedule is replaced");
      await navigation.getByRole("button", { name: "Exposure", exact: true }).click();
      await choose(page, "Exposure units", "Appearances");
      assert.equal(await page.locator(".dfw-build-button").isEnabled(), true, "Changing display units preserves the approved appearance contract");
      await choose(page, "Exposure units", "Percent");
      assert.equal(await page.locator(".dfw-build-button").isEnabled(), true);
      await count.fill("4");
      assert.equal(await page.locator(".dfw-build-button").isDisabled(), true);
      await page.locator("#dfw-plan-block").getByText("Controls differ from the applied plan. Reapply its preview or release the plan before building.", { exact: true }).waitFor();
      const buildDescription = await page.locator(".dfw-build-button").getAttribute("aria-describedby");
      assert.ok(buildDescription, "Blocked Build is associated with its visible reason");
      assert.match(await page.locator(`#${buildDescription}`).innerText(), /Controls differ from the applied plan/);
      assert.equal(await page.evaluate(() => window.__portfolioFixture.requests.length), 1, "Plan mismatch blocks before API");
      await count.fill("3"); assert.equal(await page.locator(".dfw-build-button").isEnabled(), true); await page.locator(".dfw-build-button").click();
      await page.waitForFunction(() => window.__portfolioFixture.requests.length === 2);
      await navigation.getByRole("button", { name: "Exposure", exact: true }).click();
      await page.getByText("3 of 3 selected", { exact: false }).waitFor();
      const finalRequest = await page.evaluate(() => window.__portfolioFixture.requests.at(-1));
      assert.deepEqual(finalRequest.locked_player_ids, ["p2"]); assert.deepEqual(finalRequest.excluded_player_ids, ["p16"]);
      assert.deepEqual(finalRequest.stack_game_weights, []); assert.deepEqual(finalRequest.classic_stack_rules, initialRequest.classic_stack_rules);
      const preserved = readPortfolioBackup(await downloadJson(page, "Download portfolio backup", `after-plan-${width}-${theme}.json`));
      assert.deepEqual(preserved.batches, original.batches, "Preview/apply/rebuild retains collected original batches");
      await page.getByLabel("Batch label", { exact: true }).fill("Applied fixture plan");
      await page.getByRole("button", { name: "Add current build to portfolio", exact: true }).click();
      const appliedBackup = readPortfolioBackup(await downloadJson(page, "Download portfolio backup", `applied-plan-${width}-${theme}.json`));
      assert.deepEqual(appliedBackup.batches[0], original.batches[0]);
      assert.equal(appliedBackup.batches.length, 2);
      const retainedManifest = appliedBackup.batches[1].settings.plan_manifest;
      assert.equal(retainedManifest.schema, "scoresense_build_plan_application_v1");
      assert.equal(retainedManifest.planId, plan.id); assert.equal(retainedManifest.matches, true);
      assert.deepEqual(retainedManifest.requested.locked_player_ids, ["p2"]);
      assert.deepEqual(retainedManifest.applied.classic_stack_rules, finalRequest.classic_stack_rules);
      await navigation.getByRole("button", { name: "Exposure", exact: true }).click();
      await groups.locator("summary").evaluate(summary => { if (!summary.parentElement.open) summary.click(); });
      const structure = global.locator("details").filter({ has: page.locator("summary", { hasText: "Pairs & FLEX structure" }) });
      await structure.locator("summary").click();
      await structure.getByText("Same-team attachments: 4 players in 3 lineups", { exact: true }).waitFor();
      await structure.getByText("Opposing players: 3 players in 3 lineups", { exact: true }).waitFor();
      await structure.screenshot({ path: path.join(output, `structure-${theme}-${width}.png`) });
      await groups.scrollIntoViewIfNeeded();
      const measurements = await page.evaluate(measureScript(), { minTarget: minTargetForWidth(width), numericRe: NUMERIC_RE.source,
        barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX, columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS });
      assert.deepEqual(measurements.filter(result => !result.ok), [], `${width} ${theme} guardrail layout`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      // Export the actual approved current build. Collected older batches remain
      // untouched, and the fourth account entry retains its original cells.
      const rows = [["Entry ID", "Contest ID", "Contest Name", "Entry Fee", "QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST", "Note"],
        ...Array.from({ length: 4 }, (_, i) => [String(101 + i), "900", "Synthetic Classic", "$3.00", ...Array(9).fill("Keep"), "Synthetic metadata"])];
      await page.getByLabel("Import Edit Entries CSV", { exact: true }).setInputFiles({ name: "entries.csv", mimeType: "text/csv", buffer: Buffer.from(csvLines(rows).join("\n")) });
      await page.getByRole("button", { name: "Assign lineups in order", exact: true }).click();
      await page.getByRole("checkbox", { name: "I checked the slate and start time; none of the assigned players have locked.", exact: true }).check();
      const csvDownload = page.waitForEvent("download"); await page.getByRole("button", { name: "Download DraftKings entry-update CSV", exact: true }).click();
      const csvFile = path.join(output, `entries-${width}-${theme}.csv`); await (await csvDownload).saveAs(csvFile);
      const bytes = await readFile(csvFile), audit = JSON.parse(await downloadJson(page, "Download export audit", `audit-${width}-${theme}.json`));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), audit.hashes.output_csv_sha256);
      assert.deepEqual(parseDfsCsv(bytes.toString("utf8"))[4], rows[4]);
      const exportedPair = audit.globalBuild.bounds.find(rule => rule.id === pairRule.id);
      assert.deepEqual({ min: exportedPair.minimum, max: exportedPair.maximum, actual: exportedPair.actual }, { min: 2, max: 2, actual: 2 });
      assert.equal(audit.globalBuild.stack_audit.length, 3);
      for (const item of audit.globalBuild.stack_audit) {
        assert.equal(item.attachments.actual_count, 4); assert.equal(item.bring_back.actual_count, 3);
      }
      assert.equal(audit.prelockEvidence.status, "known_not_started");
      await page.getByText("Local draft saved", { exact: true }).waitFor(); await page.reload();
      await page.getByRole("button", { name: "Restore local draft", exact: true }).click();
      const recovered = readPortfolioBackup(await downloadJson(page, "Download portfolio backup", `recovered-${width}-${theme}.json`));
      assert.deepEqual(recovered.batches, appliedBackup.batches);
      assert.equal(await page.evaluate(() => window.__portfolioFixture.requests.length), 0);
      if (width === 1280 && theme === "dark") {
        await plans.locator("summary").click(); await importPlan();
        await plans.getByRole("region", { name: "Plan preview", exact: true }).waitFor();
        await count.fill("2"); await plans.getByRole("button", { name: "Apply reviewed plan", exact: true }).click();
        await plans.getByRole("alert").filter({ hasText: "settings changed after preview" }).waitFor();
        assert.equal(await count.inputValue(), "2");
        await importPlan(); await plans.getByRole("region", { name: "Plan preview", exact: true }).waitFor();
        await choose(page, "Week", "6"); await page.getByRole("button", { name: "Lock Example 1", exact: true }).waitFor();
        assert.equal(await plans.getByRole("region", { name: "Plan preview", exact: true }).count(), 0, "Context change clears stale preview");
        await importPlan(); await plans.getByRole("alert").filter({ hasText: "different slate, week or salary snapshot" }).waitFor();
        assert.equal(await page.evaluate(() => window.__portfolioFixture.requests.length), 0);
        await page.goto("http://127.0.0.1:5173/test-fixtures/dfs-portfolio.html?guardrails");
        await page.getByRole("button", { name: "Lock Example 1", exact: true }).waitFor();
        await plans.locator("summary").click();
        const nullRulesPlan = { ...plan, inputs: { ...plan.inputs, classic_stack_rules: null } };
        await plans.getByLabel("Import build plan", { exact: true }).setInputFiles({ name: "optional-plan.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(nullRulesPlan)) });
        await plans.getByRole("region", { name: "Plan preview", exact: true }).waitFor();
        await plans.getByRole("button", { name: "Apply reviewed plan", exact: true }).click();
        await page.locator(".dfw-build-button").click(); await page.getByText("Built 3 lineups.", { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.__portfolioFixture.requests.at(-1).classic_stack_rules), null, "Null native rules retain their approved wire semantics");
        await page.getByText("Stacking & other rules", { exact: true }).click();
        await choose(stackSections.nth(0), "Same-team attachments", "At least");
        assert.equal(await page.locator(".dfw-build-button").isDisabled(), true, "First edit after a null-rules plan safely invalidates its match");
        assert.equal(await page.evaluate(() => window.__portfolioFixture.requests.length), 1);
        await choose(page, "Format", "DraftKings Showdown");
        await page.getByRole("button", { name: "Compare Captains", exact: true }).waitFor();
        await count.fill("0"); assert.equal(await page.locator(".dfw-build-button").isDisabled(), true);
        await page.getByRole("button", { name: "Compare Captains", exact: true }).click();
        await page.getByText("0 lineups solved · 0 of 0 Captains evaluated", { exact: false }).waitFor();
        const comparisonRequest = await page.evaluate(() => window.__portfolioFixture.requests.at(-1));
        assert.equal(comparisonRequest.include_captain_comparison, true); assert.equal(comparisonRequest.lineup_count, 1,
          "Captain comparison ignores the unused invalid portfolio lineup count");
        await choose(page, "Format", "DraftKings Classic"); await page.getByRole("button", { name: "Lock Example 1", exact: true }).waitFor();
        await count.fill("3"); await navigation.getByRole("button", { name: "Exposure", exact: true }).click();
        await page.getByRole("checkbox", { name: "Select the portfolio together", exact: true }).check();
        for (const format of ["FanDuel Classic", "Season-long PPR"]) {
          await choose(page, "Format", format); await navigation.getByRole("button", { name: "Player pool", exact: true }).click();
          await page.getByRole("button", { name: "Lock Example 1", exact: true }).waitFor();
          await page.getByText("Stacking & other rules", { exact: true }).evaluate(summary => { if (!summary.parentElement.open) summary.click(); });
          await page.getByRole("button", { name: /^Pass catchers per QB:/ }).waitFor();
          assert.equal(await page.getByTestId("dfs-exact-stacks").count(), 0, `${format} retains legacy stack controls`);
          await page.getByRole("button", { name: /^Minimum differences:/ }).click();
          assert.deepEqual(await page.getByRole("option").allTextContents(), Array.from({ length: format === "FanDuel Classic" ? 9 : 4 }, (_, i) => String(i + 1)));
          await page.keyboard.press("Escape");
          await choose(page, "Format", "DraftKings Classic"); await page.getByRole("button", { name: "Lock Example 1", exact: true }).waitFor();
          await navigation.getByRole("button", { name: "Exposure", exact: true }).click();
          await page.getByRole("checkbox", { name: "Select the portfolio together", exact: true }).check();
        }
        // Reach page two, then atomically replace six groups with one on the
        // same slate. The one remaining bound must be immediately editable.
        const six = [["p1","p2"],["p1","p3"],["p1","p179"],["p2","p3"],["p2","p179"],["p3","p179"]];
        const pagePlan = { ...plan, inputs: { ...plan.inputs, group_exposure_limits: six.map((player_ids, i) => ({ id: `pagination:${i}`, player_ids })) } };
        await plans.locator("summary").evaluate(summary => { if (!summary.parentElement.open) summary.click(); });
        const importObject = value => plans.getByLabel("Import build plan", { exact: true }).setInputFiles({ name: "pagination-plan.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) });
        await importObject({ ...plan, inputs: { ...plan.inputs, portfolio_mode: "legacy", classic_stack_rules: null,
          player_exposure_limits: {}, group_exposure_limits: [], require_qb_stack: true, qb_stack_count: 0 } });
        await plans.getByRole("alert").filter({ hasText: "stack count of at least 1" }).waitFor();
        assert.equal(await plans.getByRole("region", { name: "Plan preview", exact: true }).count(), 0);
        assert.equal(await groups.locator(".dfw-exposure-row").count(), 0, "Invalid required-zero legacy plan does not alter existing controls");
        await importObject(pagePlan); await plans.getByRole("button", { name: "Apply reviewed plan", exact: true }).click();
        await groups.locator("summary").evaluate(summary => { if (!summary.parentElement.open) summary.click(); });
        await groups.locator(".dfw-pagination").last().getByRole("button", { name: "Next", exact: true }).click();
        await groups.locator(".dfw-pagination").last().getByText("2 / 2", { exact: true }).waitFor();
        await importObject({ ...plan, inputs: { ...plan.inputs, group_exposure_limits: [pairRule] } });
        await plans.getByRole("button", { name: "Apply reviewed plan", exact: true }).click();
        assert.equal(await groups.locator(".dfw-exposure-row").count(), 1);
        const remaining = groups.getByRole("spinbutton", { name: "Minimum combination: Example 2 + Example 3", exact: true });
        await remaining.waitFor(); assert.equal(await remaining.inputValue(), "2");
      }
      assert.deepEqual(errors, []);
      report.push({ width, theme, state: "pair/core + exact stacks + atomic plan", measurements, taskPassed: true });
      console.log(`PASS guardrails ${width} ${theme}: pair/core bounds and actual2of3, exact stack/qualified RB request+histogram, atomic plan/cancel/mismatch, original and applied-plan backup+reload, independent export audit+CSV hash`);
      await context.close();
    }
  } finally { await writeFile(path.join(output, "report.json"), JSON.stringify({ synthetic: true, report }, null, 2)); }
}
