import assert from "node:assert/strict";
import test from "node:test";
import {
  boardTitle,
  buildStarterSlotPlan,
  decisionForStarter,
  fillStarterSlots,
  slotTone,
  swapBenchIdSet,
  canEditHubLineup,
  decisionSwapIds,
  trophyStripCopy,
  formatDraftNightShort,
  WEEK_BOARD_COPY,
  weekHeroCopy,
  weekBoardOverlayCopy,
  weekPrimaryAction,
  weekRailItems,
  weekRailNote,
} from "./weekBoard.js";

const PRESET_RULES = {
  roster: {
    qb: { min: 2, max: 4, starter: 1 },
    rb: { min: 4, max: 8, starter: 2 },
    wr: { min: 4, max: 8, starter: 2 },
    te: { min: 1, max: 3, starter: 1 },
    k: { min: 0, max: 2, starter: 1 },
    def: { min: 0, max: 2, starter: 1 },
    flex: { starter: 1, eligible: ["RB", "WR", "TE"] },
  },
};

test("buildStarterSlotPlan uses default 9-slot board without rules", () => {
  const plan = buildStarterSlotPlan(null);
  assert.deepEqual(plan.map((s) => s.slot), [
    "QB", "RB1", "RB2", "WR1", "WR2", "TE", "FLEX", "K", "DEF",
  ]);
});

test("buildStarterSlotPlan follows league starter counts including flex", () => {
  const plan = buildStarterSlotPlan(PRESET_RULES);
  assert.equal(plan.length, 9);
  assert.equal(plan.filter((s) => s.position === "WR").length, 2);
  assert.equal(plan.some((s) => s.slot === "FLEX"), true);
});

test("buildStarterSlotPlan omits flex when roster has no flex rule", () => {
  const plan = buildStarterSlotPlan({
    roster: { qb: { starter: 1 }, rb: { starter: 2 }, wr: { starter: 3 } },
  });
  assert.deepEqual(plan.map((s) => s.slot), ["QB", "RB1", "RB2", "WR1", "WR2", "WR3"]);
});

test("fillStarterSlots skips starters without a player_id", () => {
  const plan = buildStarterSlotPlan({ roster: { qb: { starter: 1 } } });
  const filled = fillStarterSlots(plan, [
    { player_name: "Ghost", position: "QB", slot: "QB" },
    { player_id: "qb1", player_name: "A", position: "QB", slot: "QB" },
  ]);
  assert.equal(filled[0].player.player_id, "qb1");
});

test("decisionForStarter ignores null decisions", () => {
  const slot = { slot: "QB", player: { player_id: "qb1" } };
  assert.equal(decisionForStarter(slot, [null, { starter_player_id: "qb1", bench_player_name: "B" }]).bench_player_name, "B");
  assert.equal(decisionForStarter(slot, [undefined]), null);
});

test("swapBenchIdSet drops empty ids", () => {
  const ids = swapBenchIdSet([
    { bench_player_id: "bn-1" },
    { bench_player_id: "" },
    null,
    { bench_player_id: 12 },
  ]);
  assert.deepEqual([...ids].sort(), ["12", "bn-1"]);
});

test("fillStarterSlots matches by slot label and leaves unused waiting", () => {
  const plan = buildStarterSlotPlan(PRESET_RULES);
  const filled = fillStarterSlots(plan, [
    { player_id: "qb1", player_name: "A", position: "QB", slot: "QB", lineup_role: "starter" },
    { player_id: "rb1", player_name: "B", position: "RB", slot: "RB1", lineup_role: "starter" },
  ]);
  assert.equal(filled[0].player.player_name, "A");
  assert.equal(filled[1].player.player_name, "B");
  assert.equal(filled[2].player, null);
  assert.equal(slotTone(filled[2]), "empty");
});

test("decisionForStarter attaches the swap to the challenged slot", () => {
  const slot = {
    slot: "WR1",
    player: { player_id: "wr-ace", player_name: "Ace" },
  };
  const decision = decisionForStarter(slot, [
    {
      starter_player_id: "wr-ace",
      starter_slot: "WR1",
      bench_player_name: "WR Co",
      delta_p50: 3.2,
    },
  ]);
  assert.equal(decision.bench_player_name, "WR Co");
  assert.equal(slotTone(slot, { decision }), "swap");
});

test("empty week hero and rail name the missing board, not zeros", () => {
  const hero = weekHeroCopy({
    emptyRoster: true,
    unlinked: true,
    draftCompleted: true,
    weekLabel: "Week 1",
  });
  assert.equal(hero.heading, "Need a roster to set a lineup.");
  assert.match(hero.support, /Lock a night|Empty seats|Link Sleeper/i);
  assert.equal(hero.chipTone, "readonly");

  const items = weekRailItems({ emptyRoster: true });
  assert.deepEqual(items.map((i) => i.value), ["Empty", "Waiting on roster"]);
  assert.match(weekRailNote({ emptyRoster: true, unlinked: true }), /Lock a night|Draft/);
  assert.equal(weekPrimaryAction({ emptyRoster: true, unlinked: true, draftCompleted: false }).kind, "room");
  assert.equal(weekPrimaryAction({ emptyRoster: true, unlinked: true, draftCompleted: true }).kind, "office-access");
  assert.match(
    weekHeroCopy({ emptyRoster: true, unlinked: false, draftCompleted: true }).support,
    /Sync league|Link Sleeper/i,
  );
});

test("failed load names the miss and a real next destination", () => {
  const hero = weekHeroCopy({ loadFailed: true, weekLabel: "Week 1" });
  assert.equal(hero.heading, "Lineup did not load. Retry.");
  assert.match(hero.support, /Retry/i);
  assert.doesNotMatch(hero.support, /Recent mocks|League settings|No swap/i);
  assert.equal(weekPrimaryAction({ loadFailed: true }).kind, "retry");
  assert.equal(weekPrimaryAction({ loadFailed: true }).label, "Retry");
  assert.deepEqual(weekRailItems({ loadFailed: true }).map((i) => i.value), ["Did not load", "Retry"]);
  assert.match(weekRailNote({ loadFailed: true }), /Retry/i);
  const overlay = weekBoardOverlayCopy({ loadFailed: true });
  assert.match(overlay.title, /did not load/i);
  assert.doesNotMatch(overlay.body, /Recent mocks|League settings/i);
});

test("week hero follows board state instead of a false swap", () => {
  assert.equal(weekHeroCopy({ loading: true }).heading, "Reading your lineup…");
  assert.equal(weekHeroCopy({ error: true }).heading, "Lineup did not load. Retry.");
  assert.equal(weekPrimaryAction({ error: true }).kind, "retry");
  const pre = weekHeroCopy({
    emptyRoster: true,
    draftCompleted: false,
    draftNightLabel: "Sat 7 p.m.",
  });
  assert.match(pre.heading, /Lineups open after the draft/);
  assert.match(pre.heading, /Sat 7 p\.m\./);
  assert.notEqual(weekHeroCopy({ loading: true }).heading, "No swap worth making.");
  assert.notEqual(weekHeroCopy({ error: true }).heading, "No swap worth making.");
  assert.match(formatDraftNightShort("2026-09-05T23:00:00.000Z"), /Sat|Sep/);
});

test("populated week hero reports lineup calls", () => {
  const hero = weekHeroCopy({ decisionCount: 2, weekLabel: "Week 1" });
  assert.equal(hero.heading, "2 lineup calls on the board.");
  const clean = weekHeroCopy({ decisionCount: 0, weekLabel: "Week 1" });
  assert.equal(clean.heading, "No swap worth making.");
});

test("unlinked with a roster still treats the board as live", () => {
  const hero = weekHeroCopy({ emptyRoster: false, unlinked: true, weekLabel: "Week 1" });
  assert.equal(hero.heading, "No swap worth making.");
  const items = weekRailItems({ emptyRoster: false, unlinked: true, counts: { decisions: 0 } });
  assert.equal(items[0].label, "Decisions");
  assert.match(weekRailNote({ emptyRoster: false, unlinked: true }), /league contracts/i);
  assert.equal(weekPrimaryAction({ emptyRoster: false, unlinked: true }).kind, "refresh");
});

test("canEditHubLineup is league-only and unlocked", () => {
  assert.equal(canEditHubLineup({ mode: "league", lineupSource: "hub", lineupLocked: false }), true);
  assert.equal(canEditHubLineup({ mode: "league", lineupSource: "hub", lineupLocked: true }), false);
  assert.equal(canEditHubLineup({ mode: "solo", lineupSource: "hub" }), false);
  assert.equal(canEditHubLineup({ mode: "league", lineupSource: "inferred" }), false);
});

test("decisionSwapIds requires both player ids", () => {
  assert.deepEqual(
    decisionSwapIds({ starter_player_id: "s1", bench_player_id: "b1" }),
    { starter_player_id: "s1", bench_player_id: "b1" },
  );
  assert.equal(decisionSwapIds({ starter_player_id: "s1" }), null);
});

test("trophy strip copy waits until the board is live", () => {
  assert.match(trophyStripCopy({ boardReady: false }), /after the board is live/i);
  assert.match(trophyStripCopy({ boardReady: true }), /one vote per trophy/i);
  assert.equal(boardTitle("Week 1"), "Week 1 board");
  assert.equal(WEEK_BOARD_COPY.seeCalls, "See lineup calls");
  assert.equal(WEEK_BOARD_COPY.emptySlot("K"), "Find K");
});
