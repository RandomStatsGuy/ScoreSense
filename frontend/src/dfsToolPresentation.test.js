/**
 * Run with: node --test frontend/src/dfsToolPresentation.test.js
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FORMATS,
  capMeterTone,
  constructionSummary,
  defaultSlateCategory,
  dfsHeroCopy,
  dfsHeroNote,
  dfsStatusChip,
  dfsSummaryItems,
  emptyLineupCopy,
  filterObjectives,
  formatPersonality,
  formatSalary,
  highestTotalGameId,
  isCaptainFormat,
  launchCopy,
  lockedSalaryTotal,
  optimizeButtonLabel,
  parseSalaryCap,
  rosterHint,
  salarySpend,
  slateLoadCopy,
  slateProviderSite,
  teamMatchupHint,
  vegasKickoffLabel,
  vegasSpreadLabel,
  vegasTotalLabel,
  formatSlateOption,
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

test("formatSlateOption and sparse lobby copy explain few DK slates", () => {
  assert.equal(
    formatSlateOption({ name: "Classic · 12 games", slate_id: "1" }),
    "Classic · 12 games",
  );
  assert.match(
    formatSlateOption({ name: "Classic", game_count: 12, player_count: 400 }),
    /12g/,
  );
  assert.match(
    slateLoadCopy({
      site: "draftkings",
      formats: DEFAULT_FORMATS,
      slateCount: 2,
    }),
    /2 NFL slates so far/i,
  );
});

test("captain formats are recognized with site-appropriate defaults", () => {
  assert.equal(isCaptainFormat("draftkings_showdown"), true);
  assert.equal(isCaptainFormat("fanduel_single"), true);
  assert.equal(isCaptainFormat("draftkings"), false);
  assert.equal(defaultSlateCategory("draftkings_showdown"), "showdown");
  assert.equal(defaultSlateCategory("draftkings"), "all");
  assert.equal(slateProviderSite("fanduel_single"), "fanduel");
  assert.equal(slateProviderSite("seasonal"), null);
  const showdown = formatPersonality("draftkings_showdown");
  assert.match(showdown.note, /CPT/);
});

test("vegas labels read like a betting board", () => {
  const game = {
    game_id: "g1",
    away: "NE",
    home: "SEA",
    spread_line: 3.5,
    total_line: 44.5,
    kickoff_et: "2026-09-09T20:20:00-04:00",
    weekday: "Wednesday",
  };
  assert.equal(vegasSpreadLabel(game), "SEA -3.5");
  assert.equal(vegasSpreadLabel({ ...game, spread_line: -2.5 }), "NE -2.5");
  assert.equal(vegasSpreadLabel({ ...game, spread_line: 0 }), "Pick 'em");
  assert.equal(vegasSpreadLabel({ ...game, spread_line: null }), "No line");
  assert.equal(vegasTotalLabel(game), "O/U 44.5");
  assert.equal(vegasTotalLabel({}), "O/U —");
  assert.match(vegasKickoffLabel(game.kickoff_et, game.weekday), /^Wed/);
  assert.equal(vegasKickoffLabel(null, "Sunday"), "Sun");
  assert.equal(
    highestTotalGameId([game, { game_id: "g2", total_line: 51.5 }]),
    "g2",
  );
});

test("teamMatchupHint compresses opponent and implied total", () => {
  assert.equal(
    teamMatchupHint({ opponent: "NE", is_home: true, implied_total: 24 }),
    "vs NE · 24.0 implied",
  );
  assert.equal(
    teamMatchupHint({ opponent: "SEA", is_home: false, implied_total: null }),
    "@ SEA",
  );
  assert.equal(teamMatchupHint(null), "");
});

test("constructionSummary compresses active rules", () => {
  assert.equal(constructionSummary({}), "");
  const summary = constructionSummary({
    stackCount: 2,
    bringBack: true,
    maxPerTeam: 3,
    maxExposure: 0.5,
    randomness: 0.12,
    minSpendLeft: 500,
    isDfs: true,
    lineupCount: 20,
  });
  assert.match(summary, /QB \+2/);
  assert.match(summary, /bring-back/);
  assert.match(summary, /≤3\/team/);
  assert.match(summary, /≤50% exposure/);
  assert.match(summary, /medium randomness/);
  assert.match(summary, /\$500 unspent/);
});
