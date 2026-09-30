import assert from "node:assert/strict";
import test from "node:test";
import { applySavedLineup } from "./weekBoard.js";

test("committed slots retain projection context and clear advice for the previous lineup", () => {
  const before = { meta: { week: 4 }, roster: {
    starters: [{ player_id: "a", slot: "WR", p50: 12, player_name: "Starter", team: "PHI" }],
    bench: [{ player_id: "b", slot: "BN", p50: 18, player_name: "Bench", team: "SEA" }],
    on_bye: [{ player_id: "a", slot: "WR" }], injured: [],
  }, decisions: [{ starter_player_id: "a", bench_player_id: "b" }], counts: {}, summary: {} };
  const next = applySavedLineup(before, { lineup: [
    { player_id: "b", slot: "WR", lineup_role: "starter", locked: false },
    { player_id: "a", slot: "BN", lineup_role: "bench", locked: true },
  ], locked: true });
  assert.equal(next.roster.starters[0].player_name, "Bench");
  assert.equal(next.roster.starters[0].p50, 18);
  assert.equal(next.roster.bench[0].lineup_locked, true);
  assert.equal(next.roster.on_bye[0].slot, "BN");
  assert.equal(next.meta.lineup_locked, true);
  assert.deepEqual(next.decisions, []);
  assert.equal(before.roster.starters[0].slot, "WR");
});

test("empty server lineup clears the board; unrecognised replies cannot invent a saved lineup", () => {
  const before = { roster: { starters: [{ player_id: "a" }], bench: [] }, counts: {} };
  assert.equal(applySavedLineup(before, { saved: true }), before);
  assert.deepEqual(applySavedLineup(before, { lineup: [] }).roster.starters, []);
});
