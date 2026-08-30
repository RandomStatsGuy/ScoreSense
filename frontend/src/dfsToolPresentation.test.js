/**
 * Run with: node --test frontend/src/dfsToolPresentation.test.js
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FORMATS,
  capMeterTone,
  dfsHeroCopy,
  dfsHeroNote,
  dfsStatusChip,
  dfsSummaryItems,
  emptyLineupCopy,
  filterObjectives,
  formatPersonality,
  formatSalary,
  launchCopy,
  lockedSalaryTotal,
  optimizeButtonLabel,
  parseSalaryCap,
  rosterHint,
  salarySpend,
  slateLoadCopy,
} from "./dfsToolPresentation.js";

test("formatSalary and parseSalaryCap handle empty and numeric values", () => {
  assert.equal(formatSalary(50000), "$50,000");
  assert.equal(formatSalary(null), "—");
  assert.equal(parseSalaryCap("50000"), 50000);
  assert.equal(parseSalaryCap(""), null);
  assert.equal(parseSalaryCap("nope"), null);
});

test("rosterHint and formatPersonality explain each format", () => {
  assert.match(rosterHint("draftkings"), /DST/);
  assert.match(rosterHint("seasonal"), /FLEX/);
  const dk = formatPersonality("draftkings");
  assert.equal(dk.icon, "DK");
  assert.match(dk.note, /\$50k/i);
  const custom = formatPersonality("custom", { custom: { label: "Custom", description: "2 QB" } });
  assert.equal(custom.label, "Custom");
  assert.equal(custom.note, "2 QB");
});

test("filterObjectives hides value unless the site is DFS", () => {
  assert.equal(filterObjectives(false).some((o) => o.id === "value"), false);
  assert.equal(filterObjectives(true).some((o) => o.id === "value"), true);
});

test("dfsHeroCopy names the user goal instead of the internal tool", () => {
  const dfs = dfsHeroCopy({ isDfs: true, siteLabel: "FanDuel Classic" });
  assert.equal(dfs.eyebrow, "DFS");
  assert.match(dfs.heading, /Spend the cap/i);
  assert.match(dfs.support, /FanDuel Classic/);
  const seasonal = dfsHeroCopy({ isDfs: false });
  assert.equal(seasonal.eyebrow, "Lineups");
  assert.match(seasonal.heading, /startable week/i);
});

test("dfsHeroNote and status chip stay calm about slate state", () => {
  assert.match(dfsHeroNote({ isDfs: true }).title, /Salaries from the slate/i);
  assert.equal(dfsStatusChip({ loadingSalaries: true }).tone, "readonly");
  assert.equal(dfsStatusChip({ isDfs: true, importStats: { matched: 412 } }).label, "412 salaries");
  assert.equal(dfsStatusChip({ slateMeta: { offseason_placeholder: true } }).label, "Offseason slate");
  assert.equal(dfsStatusChip({ isDfs: true, poolCount: 0 }).label, "Pick a slate");
});

test("salarySpend and capMeterTone describe leftover cap", () => {
  const spend = salarySpend({ totalSalary: 49200, salaryCap: 50000, salaryRemaining: 800 });
  assert.equal(spend.used, 49200);
  assert.equal(spend.remaining, 800);
  assert.ok(spend.pct > 98);
  const spendNull = salarySpend({ totalSalary: 49200, salaryCap: 50000, salaryRemaining: null });
  assert.equal(spendNull.remaining, 800);
  const spendMissing = salarySpend({ totalSalary: 49200, salaryCap: 50000 });
  assert.equal(spendMissing.remaining, 800);
  assert.equal(capMeterTone({ remaining: 800, cap: 50000 }), "tight");
  assert.equal(capMeterTone({ remaining: -200, cap: 50000 }), "over");
  assert.equal(capMeterTone({ remaining: 12000, cap: 50000 }), "healthy");
  assert.equal(lockedSalaryTotal(
    [{ player_id: "a", salary: 8000 }, { player_id: "b", salary: 5000 }],
    ["a"],
  ), 8000);
  assert.equal(lockedSalaryTotal(
    [{ player_id: "a", salary: 8000 }, { player_id: "b", salary: 5000 }],
    new Set(["b"]),
  ), 5000);
});

test("dfsSummaryItems lists consequence-first fields", () => {
  const items = dfsSummaryItems({
    siteLabel: "DraftKings Classic",
    season: 2026,
    week: 1,
    slateName: "Main",
    isDfs: true,
    salaryCap: 50000,
    lockedCount: 2,
    excludedCount: 1,
    objectiveId: "ceiling",
    lineupCount: 3,
  });
  const byId = Object.fromEntries(items.map((item) => [item.id, item.value]));
  assert.equal(byId.format, "DraftKings Classic");
  assert.equal(byId.week, "2026 · Wk 1");
  assert.equal(byId.slate, "Main");
  assert.equal(byId.cap, "$50,000");
  assert.equal(byId.goal, "Ceiling (P90)");
  assert.equal(byId.locks, "2 / 1");
  assert.equal(byId.lineups, "3");
});

test("slate and empty-state copy explain what happens next", () => {
  assert.match(
    slateLoadCopy({ site: "draftkings", formats: DEFAULT_FORMATS, loadingSalaries: true }),
    /loading live salaries/i,
  );
  assert.match(
    slateLoadCopy({
      site: "fanduel",
      formats: DEFAULT_FORMATS,
      importStats: { matched: 380, dst_added: 20 },
    }),
    /380 matched/,
  );
  assert.match(emptyLineupCopy({ isDfs: true }), /under the cap/);
  assert.equal(optimizeButtonLabel({ lineupCount: 5 }), "Build 5 lineups");
  assert.equal(optimizeButtonLabel({ optimizing: true }), "Optimizing…");
  assert.match(launchCopy({ isDfs: true, hasLineup: false }).title, /Fill the nine/);
  assert.match(launchCopy({ hasLineup: true }).title, /field/);
});
