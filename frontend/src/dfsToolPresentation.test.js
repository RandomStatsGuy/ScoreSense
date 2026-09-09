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
  gameStackLabel,
  highestTotalGameId,
  isCaptainFormat,
  launchCopy,
  lockedSalaryTotal,
  normalizeDfsTeam,
  optimizeButtonLabel,
  gamesMarkedCopy,
  listGameStacks,
  pickGameStack,
  stackOptionCopy,
  replaceStackLocks,
  slateGames,
  stackApplyLiveText,
  stackClearLiveText,
  stackPlayerIds,
  stackPreviewCopy,
  vegasGameCta,
  parseSalaryCap,
  pinActionLabel,
  pickSwapTarget,
  poolRowToLineupSlot,
  rosterHint,
  salarySpend,
  slateLoadCopy,
  slateProviderSite,
  slotAcceptsPosition,
  sortPoolRows,
  swapActionLabel,
  swapPoolPlayerIntoLineup,
  swapResultLiveText,
  teamMatchupHint,
  vegasKickoffLabel,
  vegasSpreadLabel,
  vegasTotalLabel,
  formatSlateOption,
  buildResultLiveText,
  nextExclusiveChoice,
  objectiveSortColumn,
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
  assert.match(dfs.heading, /high totals/i);
  assert.match(dfs.support, /FanDuel Classic/);
  assert.match(dfs.support, /backup/i);
  const captain = dfsHeroCopy({ isDfs: true, captain: true, siteLabel: "DraftKings Showdown" });
  assert.match(captain.heading, /captain/i);
  assert.match(captain.support, /leave salary|lose/i);
  const seasonal = dfsHeroCopy({ isDfs: false });
  assert.equal(seasonal.eyebrow, "Lineups");
  assert.match(seasonal.heading, /this week's PPR lineup/i);
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
    stackGameLabel: "BUF @ MIA",
  });
  const byId = Object.fromEntries(items.map((item) => [item.id, item.value]));
  assert.equal(byId.format, "DraftKings Classic");
  assert.equal(byId.week, "2026 · Wk 1");
  assert.equal(byId.slate, "Main");
  assert.equal(byId.cap, "$50,000");
  assert.equal(byId.game, "BUF @ MIA");
  assert.equal(items.find((item) => item.id === "game")?.label, "Game");
  const multi = dfsSummaryItems({
    siteLabel: "DraftKings Classic",
    isDfs: true,
    stackGameLabel: "2 games in the build",
  });
  assert.equal(multi.find((item) => item.id === "game")?.label, "Games");
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
  assert.match(emptyLineupCopy({ isDfs: true, hasStack: true }), /games you marked/);
  assert.equal(optimizeButtonLabel({ lineupCount: 5 }), "Build 5 lineups");
  assert.equal(optimizeButtonLabel({ optimizing: true }), "Optimizing…");
  assert.equal(optimizeButtonLabel({ hasLineup: true }), "Rebuild this lineup");
  assert.equal(optimizeButtonLabel({ hasLineup: true, lineupCount: 3 }), "Rebuild 3 lineups");
  assert.equal(optimizeButtonLabel({ hasStack: true }), "Build around these games");
  assert.equal(optimizeButtonLabel({ hasStack: true, lineupCount: 20 }), "Build 20 lineups around these games");
  assert.match(launchCopy({ isDfs: true, hasLineup: false }).title, /Nine spots/);
  assert.match(launchCopy({ hasLineup: true }).title, /built/);
  assert.match(launchCopy({ stackGameLabel: "BUF @ MIA" }).title, /BUF @ MIA/);
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
  assert.equal(vegasSpreadLabel({ away: "SF", home: "LA", spread_line: 3.5 }), "LAR -3.5");
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

test("lock and skip names include the player", () => {
  assert.equal(pinActionLabel("lock", "Lamar Jackson"), "Lock Lamar Jackson");
  assert.equal(pinActionLabel("skip", "Lamar Jackson"), "Skip Lamar Jackson");
  assert.equal(swapActionLabel("George Kittle", "Mark Andrews"), "Swap George Kittle in for Mark Andrews");
});

test("build and swap results announce a concrete outcome", () => {
  assert.match(buildResultLiveText({ playerCount: 7, totalPoints: 106.9 }), /7 players/);
  assert.match(buildResultLiveText({ playerCount: 7, totalPoints: 106.9 }), /106\.9/);
  assert.match(buildResultLiveText({ ok: false, error: "Cap bust" }), /Cap bust/);
  assert.equal(
    swapResultLiveText({ incomingName: "George Kittle", outgoingName: "Mark Andrews" }),
    "Swapped Mark Andrews for George Kittle.",
  );
});

test("goal choice drives the default pool sort column", () => {
  assert.equal(objectiveSortColumn("floor"), "floor");
  assert.equal(objectiveSortColumn("ceiling"), "ceiling");
  assert.equal(objectiveSortColumn("value"), "value");
  assert.equal(objectiveSortColumn("median"), "proj");
});

test("sortPoolRows orders by floor and implied totals", () => {
  const rows = [
    { Player: "B", "Low (P10)": 8, Team: "SEA", "Projected Points": 12 },
    { Player: "A", "Low (P10)": 14, Team: "NE", "Projected Points": 10 },
  ];
  const byFloor = sortPoolRows(rows, { column: "floor", dir: "desc" });
  assert.equal(byFloor[0].Player, "A");
  const byName = sortPoolRows(rows, { column: "player", dir: "asc" });
  assert.equal(byName[0].Player, "A");
  const byImp = sortPoolRows(rows, { column: "implied", dir: "desc" }, {
    SEA: { implied_total: 28 },
    NE: { implied_total: 19 },
  });
  assert.equal(byImp[0].Team, "SEA");
});

test("exclusive choice arrows wrap around the group", () => {
  assert.equal(nextExclusiveChoice(["a", "b", "c"], "a", "ArrowRight"), "b");
  assert.equal(nextExclusiveChoice(["a", "b", "c"], "c", "ArrowRight"), "a");
  assert.equal(nextExclusiveChoice(["a", "b", "c"], "a", "ArrowLeft"), "c");
  assert.equal(nextExclusiveChoice(["a", "b", "c"], "b", "Enter"), "b");
});

test("swap prefers an exact slot then the lowest FLEX", () => {
  assert.equal(slotAcceptsPosition("FLEX", "TE"), true);
  assert.equal(slotAcceptsPosition("QB", "TE"), false);
  const lineup = [
    { slot: "TE", player: "Mark Andrews", player_id: "and", position: "TE", proj: 11 },
    { slot: "FLEX", player: "Flex WR", player_id: "wr", position: "WR", proj: 9 },
  ];
  assert.equal(pickSwapTarget(lineup, "TE").player_id, "and");
  assert.equal(pickSwapTarget(lineup, "WR").player_id, "wr");
  const swapped = swapPoolPlayerIntoLineup(lineup, {
    player_id: "kit",
    Player: "George Kittle",
    Position: "TE",
    Team: "SF",
    "Projected Points": 14.2,
    "Low (P10)": 8,
    "High (P90)": 20,
  });
  assert.equal(swapped.outgoing.player_id, "and");
  assert.equal(swapped.lineup[0].player, "George Kittle");
  assert.equal(swapped.lineup[0].slot, "TE");
  assert.equal(swapped.totalPoints, 23.2);
  assert.equal(swapPoolPlayerIntoLineup(lineup, { player_id: "and", Player: "Mark Andrews", Position: "TE" }), null);
  assert.equal(poolRowToLineupSlot({ Player: "X", player_id: "x", Position: "QB" }, "QB").slot, "QB");
});

test("pickGameStack locks the higher-ceiling QB plus two catchers and a bring-back", () => {
  const game = { game_id: "g1", away: "BUF", home: "MIA" };
  const pool = [
    { player_id: "allen", Player: "Josh Allen", Position: "QB", Team: "BUF", "High (P90)": 34, "Projected Points": 24 },
    { player_id: "tua", Player: "Tua", Position: "QB", Team: "MIA", "High (P90)": 28, "Projected Points": 20 },
    { player_id: "shakir", Player: "Khalil Shakir", Position: "WR", Team: "BUF", "High (P90)": 22, "Projected Points": 14 },
    { player_id: "kincaid", Player: "Dalton Kincaid", Position: "TE", Team: "BUF", "High (P90)": 18, "Projected Points": 11 },
    { player_id: "cooks", Player: "Keon Coleman", Position: "WR", Team: "BUF", "High (P90)": 12, "Projected Points": 8 },
    { player_id: "waddle", Player: "Jaylen Waddle", Position: "WR", Team: "MIA", "High (P90)": 24, "Projected Points": 15 },
    { player_id: "out-wr", Player: "Out WR", Position: "WR", Team: "BUF", "Injury Status": "Out", "High (P90)": 40 },
    { player_id: "lar-qb", Player: "Stafford", Position: "QB", Team: "LAR", "High (P90)": 20 },
  ];
  const stack = pickGameStack(pool, game, { stackCount: 2 });
  assert.equal(stack.complete, true);
  assert.equal(stack.stackTeam, "BUF");
  assert.deepEqual(stackPlayerIds(stack), ["allen", "shakir", "kincaid", "waddle"]);
  assert.equal(stack.players[3].label, "Bring");
  assert.equal(gameStackLabel(game), "BUF @ MIA");
  assert.match(stackPreviewCopy(stack).body, /pin a stack/i);
  assert.match(stackApplyLiveText(stack), /in the build/i);
  assert.match(stackClearLiveText(), /cleared/i);
  assert.equal(vegasGameCta({ selected: true }), "In the build");
  assert.equal(vegasGameCta({ selected: false }), "Add this total");
  assert.equal(gamesMarkedCopy(0), "");
  assert.equal(gamesMarkedCopy(1), "1 game in the build");
  assert.equal(gamesMarkedCopy(2), "2 games in the build");
});

test("listGameStacks offers each side's starter QB and ignores a loud backup ceiling", () => {
  const game = { game_id: "mia-lv", away: "MIA", home: "LV" };
  const pool = [
    { player_id: "willis", Player: "Malik Willis", Position: "QB", Team: "MIA", "Projected Points": 9.3, "High (P90)": 25.5 },
    { player_id: "cousins", Player: "Kirk Cousins", Position: "QB", Team: "LV", "Projected Points": 10.6, "High (P90)": 17.7 },
    { player_id: "cook", Player: "Brady Cook", Position: "QB", Team: "MIA", "Projected Points": 2.5, "High (P90)": 4.5 },
    { player_id: "bowers", Player: "Brock Bowers", Position: "TE", Team: "LV", "Projected Points": 11, "High (P90)": 22 },
    { player_id: "tucker", Player: "Tre Tucker", Position: "WR", Team: "LV", "Projected Points": 4, "High (P90)": 13 },
    { player_id: "achane", Player: "De'Von Achane", Position: "RB", Team: "MIA", "Projected Points": 14, "High (P90)": 26 },
    { player_id: "dulcich", Player: "Greg Dulcich", Position: "TE", Team: "MIA", "Projected Points": 5.5, "High (P90)": 15 },
  ];
  const stacks = listGameStacks(pool, game, { stackCount: 2 });
  assert.deepEqual(stacks.map((row) => row.qb.player_id), ["cousins", "willis"]);
  assert.equal(stacks.some((row) => row.qb.player_id === "cook"), false);
  const suggested = pickGameStack(pool, game, { stackCount: 2 });
  assert.equal(suggested.players[0].row.player_id, "cousins");
  const cousins = stackOptionCopy(stacks.find((row) => row.qb.player_id === "cousins"));
  assert.equal(cousins.title, "Kirk Cousins · LV");
  assert.equal(cousins.game, "MIA @ LV");
  assert.match(cousins.body, /Bowers/);
  assert.equal(normalizeDfsTeam("LVR"), "LV");
  assert.equal(normalizeDfsTeam("OAK"), "LV");
});

test("pickGameStack treats LAR and LA as the same team and skips byes", () => {
  const game = { game_id: "g2", away: "LA", home: "SEA" };
  const pool = [
    { player_id: "staff", Player: "Stafford", Position: "QB", Team: "LAR", "High (P90)": 22 },
    { player_id: "puka", Player: "Puka Nacua", Position: "WR", Team: "LAR", "High (P90)": 26 },
    { player_id: "bye-te", Player: "Bye TE", Position: "TE", Team: "LAR", on_bye: true, "High (P90)": 30 },
    { player_id: "kupp", Player: "Cooper Kupp", Position: "WR", Team: "LA", "High (P90)": 19 },
    { player_id: "metcalf", Player: "DK Metcalf", Position: "WR", Team: "SEA", "High (P90)": 21 },
  ];
  const stack = pickGameStack(pool, game, { stackCount: 2 });
  assert.equal(normalizeDfsTeam("LAR"), "LA");
  assert.deepEqual(stackPlayerIds(stack), ["staff", "puka", "kupp", "metcalf"]);
  const games = slateGames([
    game,
    { game_id: "g3", away: "BUF", home: "MIA" },
  ], pool);
  assert.deepEqual(games.map((row) => row.game_id), ["g2"]);
});

test("replaceStackLocks swaps the auto-stack without dropping a user lock", () => {
  const next = replaceStackLocks(["user", "old-qb"], ["old-qb"], ["new-qb", "new-wr"]);
  assert.equal(next.has("user"), true);
  assert.equal(next.has("old-qb"), false);
  assert.equal(next.has("new-qb"), true);
  assert.equal(next.has("new-wr"), true);
});
