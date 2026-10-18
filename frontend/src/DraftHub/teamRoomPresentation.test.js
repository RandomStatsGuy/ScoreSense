import { test } from "node:test";
import assert from "node:assert/strict";
import { roomNumber, roomDelta, roomResult } from "./rosterPresentation.js";
import { roomProjectionTotal, canPreviewRoomSwap, roomPreviewLineup, roomPreviewScope, roomSavesLineup, canMoveRoomPlayer, canPlaceRoomPlayer, roomHeldState, roomBenchEdge, roomAfterSwap, roomOpponentGap } from "./teamRoomPresentation.js";
test("missing scores stay distinct from zero and negatives", () => {
  assert.equal(roomNumber(null), "—");
  assert.equal(roomNumber(0), "0.0");
  assert.equal(roomNumber(-2.4), "-2.4");
});
test("only final scores can be compared to a known projection", () => {
  assert.equal(roomDelta({ points: 0, projection: 12 }, "live"), null);
  assert.equal(roomDelta({ points: 0, projection: 12 }, "final"), -12);
  assert.equal(roomDelta({ points: 20, projection: null }, "final"), null);
});
test("matchup result includes wins losses ties and unknown scores", () => {
  assert.equal(
    roomResult({ state: "final", score: 154.4, opponent: { score: 139.1 } }),
    "Won by 15.3",
  );
  assert.equal(
    roomResult({ state: "live", score: 0, opponent: { score: 3 } }),
    "Trailing by 3.0",
  );
  assert.equal(
    roomResult({ state: "final", score: 0, opponent: { score: 0 } }),
    "Finished tied",
  );
  assert.equal(roomResult({ score: null, opponent: { score: 0 } }), "");
});

function previewRoom() {
  const p = (id, projection, slot, preview_slots) => ({ player_id: id, projection, slot, preview_slots, lineup_locked: false, can_manage: true });
  return { team: { id: "mine" }, season: 2026, week: 6, current_week: 6, state: "pregame", can_edit: true,
    starters: [p("wr", 12.2, "WR", [0, 1]), p("flex", 2.4, "FLEX", [1])],
    bench: [p("downs", 11.6, null, [0, 1]), p("missing", null, null, [0, 1])] };
}

test("a preview moves jerseys and projections together without mutating the saved lineup", () => {
  const data = previewRoom(), saved = structuredClone(data);
  const preview = roomPreviewLineup(data, { 1: "downs" });
  assert.deepEqual(data, saved);
  assert.equal(preview.starters[1].player_id, "downs");
  assert.equal(preview.starters[1].slot, "FLEX");
  assert.ok(preview.bench.some((p) => p.player_id === "flex" && p.slot === null));
  assert.equal(roomProjectionTotal(preview.starters).toFixed(1), "23.8");
  assert.equal(preview.count, 1);
  // The outgoing starter can enter another eligible slot, independent of replay order.
  const next = roomPreviewLineup(data, { 1: "wr", 0: "downs" });
  assert.deepEqual(next.starters.map((p) => p.player_id), ["downs", "wr"]);
  assert.equal(next.count, 2);
});

test("preview eligibility respects owner scope, kickoff, host metadata, and missing forecasts", () => {
  const data = previewRoom(), starter = data.starters[1], bench = data.bench[0];
  assert.equal(canPreviewRoomSwap(data, starter, bench, 1), true);
  for (const changed of [{ ...data, can_edit: false }, { ...data, state: "final" }, { ...data, state: "unknown" }, { ...data, current_week: 7 }]) {
    assert.equal(roomPreviewLineup(changed, { 1: "downs" }).count, 0);
  }
  for (const changed of [{ ...bench, lineup_locked: true }, { ...bench, lineup_locked: undefined }, { ...bench, preview_slots: [0] }, { ...bench, projection: null }, { ...bench, can_manage: false }]) {
    assert.equal(canPreviewRoomSwap(data, starter, changed, 1), false);
  }
  assert.equal(canPreviewRoomSwap(data, { ...starter, lineup_locked: true }, bench, 1), false);
  assert.equal(roomPreviewLineup(data, { 0: "downs", 1: "downs" }).count, 0);
  assert.equal(roomPreviewLineup(data, { 1: "other-team-player" }).count, 0);
  const locked = { ...data, bench: [{ ...bench, lineup_locked: true }] };
  assert.equal(roomPreviewLineup(locked, { 1: "downs" }).count, 0);
});

test("incomplete totals remain unknown and preview scope changes with team, week, and synced lineup", () => {
  const data = previewRoom();
  assert.equal(roomProjectionTotal([]), null);
  assert.equal(roomProjectionTotal([{ player_id: "zero", projection: 0 }]), 0);
  assert.equal(roomProjectionTotal([{ player_id: "missing", projection: null }]), null);
  assert.equal(roomProjectionTotal([{ player_id: "empty", projection: NaN }]), null);
  assert.equal(roomProjectionTotal([{ player_id: "", projection: 0 }]), null);
  const scope = roomPreviewScope(data);
  for (const changed of [{ ...data, team: { id: "other" } }, { ...data, week: 7 }, { ...data, starters: [data.bench[0], data.starters[1]] }]) assert.notEqual(roomPreviewScope(changed), scope);
  assert.equal(roomPreviewScope({ ...data, starters: data.starters.map((p) => ({ ...p, nickname: "New nickname" })) }), scope);
});

test("native rooms save moves and allow a starter without a forecast; Sleeper rooms only preview", () => {
  const data = previewRoom(), starter = data.starters[1], missing = data.bench[1];
  assert.equal(roomSavesLineup(data), true);
  assert.equal(roomSavesLineup({ ...data, lineup_host: "sleeper" }), false);
  assert.equal(roomSavesLineup({ ...data, can_edit: false }), false);
  assert.equal(canMoveRoomPlayer(data, starter, missing, 1), true);
  assert.equal(canPreviewRoomSwap(data, starter, missing, 1), false);
  assert.equal(canPlaceRoomPlayer(data, starter, missing, 1), true);
  assert.equal(canPlaceRoomPlayer({ ...data, lineup_host: "sleeper" }, starter, missing, 1), false);
  assert.equal(canPlaceRoomPlayer(data, { ...starter, lineup_locked: true }, data.bench[0], 1), false);
});

test("a held bench jersey lights eligible lockers with the signed change, names locked slots, and dims the rest", () => {
  const data = previewRoom(), held = data.bench[0];
  assert.deepEqual(roomHeldState(data, data.starters[1], held, 1), { fit: true, locked: false, delta: 11.6 - 2.4 });
  assert.deepEqual(roomHeldState(data, data.starters[0], held, 0), { fit: true, locked: false, delta: 11.6 - 12.2 });
  assert.deepEqual(roomHeldState(data, { ...data.starters[1], projection: null }, held, 1), { fit: true, locked: false, delta: null });
  assert.deepEqual(roomHeldState(data, { ...data.starters[1], lineup_locked: true }, held, 1), { fit: false, locked: true, delta: null });
  assert.deepEqual(roomHeldState(data, data.starters[1], { ...held, preview_slots: [0] }, 1), { fit: false, locked: false, delta: null });
  assert.equal(roomHeldState(data, data.starters[1], null, 1), null);
});

test("bench captions name the weakest eligible starter beaten by at least a point", () => {
  const data = previewRoom();
  const edge = roomBenchEdge(data, data.bench[0], data.starters);
  assert.equal(edge.index, 1);
  assert.equal(edge.delta.toFixed(1), "9.2");
  assert.equal(roomBenchEdge(data, data.bench[1], data.starters), null);
  assert.equal(roomBenchEdge(data, { ...data.bench[0], projection: 12.9 }, data.starters).index, 1);
  assert.equal(roomBenchEdge(data, { ...data.bench[0], projection: 3.0 }, data.starters), null);
});

test("a saved swap moves the players locally without touching eligibility metadata", () => {
  const data = previewRoom(), next = roomAfterSwap(data, "flex", "downs");
  assert.deepEqual(next.starters.map((p) => [p.player_id, p.slot]), [["wr", "WR"], ["downs", "FLEX"]]);
  assert.deepEqual(next.bench.map((p) => [p.player_id, p.slot]), [["flex", null], ["missing", null]]);
  assert.deepEqual(next.starters[1].preview_slots, [0, 1]);
  assert.equal(roomAfterSwap(data, "nobody", "downs"), data);
});

test("the opponent margin needs both projected totals", () => {
  assert.equal(roomOpponentGap(130.5, { projection: 127.9 }).toFixed(1), "2.6");
  assert.equal(roomOpponentGap(null, { projection: 127.9 }), null);
  assert.equal(roomOpponentGap(130.5, { projection: null }), null);
  assert.equal(roomOpponentGap(130.5, null), null);
});
