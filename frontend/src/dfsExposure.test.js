import test from "node:test";
import assert from "node:assert/strict";
import { appearanceMaximum, remainingAppearanceCounts, exposureRows } from "./dfsExposure.js";
import { allocateMatchupWeights } from "./dfsToolPresentation.js";

const batch = (id, count) => ({ id, lineups: Array.from({length: count}, () => ({ lineup: [
  { player_id: "qb", player: "Quarterback", slot: "QB" }, { player_id: "wr", player: "Receiver", slot: "WR1" },
] })) });

test("percent maximums round down, count entry is exact, blank clears and zero excludes", () => {
  assert.equal(appearanceMaximum("30"), 45);
  assert.equal(appearanceMaximum("1"), 1);
  assert.equal(appearanceMaximum("0.66"), 0);
  assert.equal(appearanceMaximum("100"), 150);
  assert.equal(appearanceMaximum("17", "count"), 17);
  assert.equal(appearanceMaximum(""), "");
  for (const invalid of ["-1", "101", "NaN", "Infinity"]) assert.throws(() => appearanceMaximum(invalid));
  assert.throws(() => appearanceMaximum("1.5", "count"));
});

test("remaining budget counts every batch and lock; removal recomputes without mutating inputs", () => {
  const batches = [batch("a", 20), batch("b", 8)], limits = { qb: 45, wr: 30, extra: 0 };
  const before = structuredClone(batches);
  assert.deepEqual(remainingAppearanceCounts(batches, limits, 50), { qb: 17, wr: 2, extra: 0 });
  assert.deepEqual(remainingAppearanceCounts(batches.slice(0, 1), limits, 50), { qb: 25, wr: 10, extra: 0 });
  assert.throws(() => remainingAppearanceCounts(batches, limits, 20, ["qb"]), /locked.*17/);
  assert.deepEqual(batches, before);
  assert.throws(() => remainingAppearanceCounts(batches, { qb: 27 }, 20), /exceeds/);
});

test("exposure rows include unused players and limits before collecting a batch", () => {
  const pool = [{ player_id: "qb", Player: "Quarterback", Position: "QB", Team: "KC" }, { player_id: "new", Player: "New player", Position: "WR" }];
  const rows = exposureRows(pool, [batch("a", 20)], { qb: 45, absent: 3 });
  assert.equal(rows.find(p => p.id === "qb").max, 45);
  assert.equal(rows.find(p => p.id === "qb").percent, 100);
  assert.equal(rows.find(p => p.id === "new").count, 0);
  assert.equal(rows.find(p => p.id === "absent").max, 3);
});

test("remaining allowances cannot be applied to another slate or salary catalog", () => {
  const original = { ...batch("a", 2), context: { site: "draftkings", season: 2026, week: 5, source: "live", slateId: "main" },
    salarySnapshot: { id: "salary" }, salaryCatalog: [{ player_id: "qb", dfs_id: "1", salary: 4000, Position: "QB", Team: "KC" }] };
  assert.deepEqual(remainingAppearanceCounts([original], { qb: 45 }, 3, [], original), { qb: 3 });
  for (const change of [b => { b.context.slateId = "other"; }, b => { b.salaryCatalog[0].salary = 4500; }]) {
    const current = structuredClone(original); change(current);
    assert.throws(() => remainingAppearanceCounts([original], { qb: 45 }, 3, [], current), /different site, slate, week or salary catalog/);
  }
});

test("preview matches smooth weighted builder allocation including unequal weights and ties", () => {
  assert.deepEqual(allocateMatchupWeights({ a: 1, b: 1, c: 4 }, 2).map(p => p.count), [1, 0, 1]);
  assert.deepEqual(allocateMatchupWeights({ a: 3, b: 1 }, 150).map(p => p.count), [113, 37]);
});
