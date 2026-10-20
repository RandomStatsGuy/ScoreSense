import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFaceoffModel,
  buildFaceoffRoster,
  faceoffBeats,
  faceoffBestUpgrade,
  faceoffCompare,
  faceoffLineupTotal,
  faceoffPending,
  faceoffRangeMarks,
  faceoffRosterLimit,
  faceoffSurname,
  faceoffWeakSpots,
  weakestFaceoffStarter,
} from "./freeAgentFaceoff.js";

const rules = {
  roster_size_max: 10,
  roster: { qb: { starter: 1 }, rb: { starter: 2 }, wr: { starter: 2 }, te: { starter: 1 }, flex: { starter: 1 }, k: { starter: 0 }, def: { starter: 0 } },
};
const roster = [
  { player_id: "qb", player_name: "Jalen Hurts", position: "QB", team: "PHI" },
  { player_id: "rb1", player_name: "Breece Hall", position: "RB", team: "NYJ" },
  { player_id: "rb2", player_name: "Chase Brown", position: "RB", team: "CIN" },
  { player_id: "wr1", player_name: "Nico Collins", position: "WR", team: "HOU" },
  { player_id: "wr2", player_name: "Jameson Williams", position: "WR", team: "DET" },
  { player_id: "te", player_name: "Kyle Pitts Sr.", position: "TE", team: "ATL" },
  { player_id: "flex", player_name: "Jaylen Warren", position: "RB", team: "PIT" },
  { player_id: "bn1", player_name: "Bo Nix", position: "QB", team: "DEN" },
  { player_id: "cut", player_name: "Old Cut", position: "WR", team: "NYG", roster_status: "cut" },
];
const pace = { qb: 20.1, rb1: 15.2, rb2: 13.4, wr1: 14.8, wr2: 12.1, te: 9.6, flex: 9.4, bn1: 16.0 };
const rows = [
  ...Object.entries(pace).map(([player_id, per_game_proj]) => ({ player_id, player: player_id, position: roster.find((r) => r.player_id === player_id).position, per_game_proj, status: "taken" })),
  { player_id: "fa-wr", player: "Jauan Jennings", position: "WR", team: "MIN", per_game_proj: 12.4, season_p10: 140, season_p50: 210, season_p90: 260, status: "available" },
  { player_id: "fa-rb", player: "Josh Downs", position: "RB", team: "IND", per_game_proj: 10.6, season_p10: 120, season_p50: 180, season_p90: 230, status: "available" },
  { player_id: "fa-te", player: "Depth Tight End", position: "TE", team: "GB", per_game_proj: 7.1, season_p10: 80, season_p50: 120, season_p90: 150, status: "available" },
  { player_id: "fa-none", player: "No Forecast", position: "WR", team: "SEA", per_game_proj: null, status: "available" },
];
const available = rows.filter((r) => r.status === "available");

test("surname drops suffixes", () => {
  assert.equal(faceoffSurname("Kyle Pitts Sr."), "Pitts");
  assert.equal(faceoffSurname("Marvin Harrison Jr."), "Harrison");
  assert.equal(faceoffSurname("Hurts"), "Hurts");
  assert.equal(faceoffSurname(""), "");
});

test("server-resolved roster IDs connect Sleeper roster slots to GSIS forecasts", () => {
  const roster = [{ player_id: "sleeper-8167", player_name: "Christian Watson", position: "WR" }];
  const rows = [{ player_id: "00-0038124", roster_player_id: "sleeper-8167", position: "WR", per_game_proj: 10.8 }];
  const lineup = buildFaceoffRoster({ roster, rows, rules });
  assert.equal(lineup.starters.find(s => s.player)?.player.pg, 10.8);
  assert.equal(faceoffLineupTotal(lineup.starters).total, 10.8);
  const saved = buildFaceoffRoster({ roster, rows, rules, weekRoster: { starters: [{ player_id: "00-0038124", slot: "FLEX" }] } });
  assert.equal(saved.starters.find(s => s.slot === "FLEX").player.player_id, "sleeper-8167");
  const absent = buildFaceoffRoster({ roster, rows: [], rules });
  assert.equal(absent.starters.find(s => s.player)?.player.pg, null);
  const zero = buildFaceoffRoster({ roster, rows: [{ ...rows[0], per_game_proj: 0 }], rules });
  assert.equal(zero.starters.find(s => s.player)?.player.pg, 0);
});

test("bench selection compares same-position waivers without changing the lineup", () => {
  const benchReceiver = { player_id: "bench-wr", player_name: "Bench Receiver", position: "WR" };
  const model = buildFaceoffModel({ roster: [...roster, benchReceiver], rows: [...rows, { player_id: "bench-wr", per_game_proj: 6.2 }], availableRows: available, rules, target: "bench:bench-wr" });
  assert.equal(model.targetSlot.bench, true);
  assert.equal(model.targetSlot.player.name, "Bench Receiver");
  assert.equal(model.eligible(available[0]), true);
  assert.equal(model.eligible(available[1]), false);
  assert.equal(model.compare(available[0]).delta, 6.2);
  assert.equal(model.compare(available[3]).delta, null);
  assert.equal(model.beats.get("bench:bench-wr"), 1);
  assert.equal(model.total.total, 94.6);
  assert.equal(model.pending.swaps.size, 0);
  const qb = buildFaceoffModel({ roster, rows, availableRows: available, rules, target: "bench:bn1" });
  assert.equal(qb.targetSlot.player.name, "Bo Nix");
  assert.equal(qb.eligible(available[0]), false);
});

test("roster limit reads the explicit max, then the sum of position maxes", () => {
  assert.equal(faceoffRosterLimit(rules), 10);
  assert.equal(faceoffRosterLimit({ roster: { QB: { max: 2 }, RB: { max: 4 } } }), 6);
  assert.equal(faceoffRosterLimit({}), null);
});

test("saved weekly slots win; empty slots fill by pace; cuts never count", () => {
  const week = { starters: [{ player_id: "rb2", slot: "FLEX" }, { player_id: "flex", slot: "RB2" }] };
  const lineup = buildFaceoffRoster({ roster, rows, rules, weekRoster: week });
  const bySlot = Object.fromEntries(lineup.starters.map((s) => [s.slot, s.player?.player_id]));
  assert.equal(bySlot.FLEX, "rb2");
  assert.equal(bySlot.RB2, "flex");
  assert.equal(bySlot.RB1, "rb1");
  assert.equal(bySlot.QB, "qb");
  assert.deepEqual(lineup.bench.map((p) => p.player_id), ["bn1"]);
  assert.equal(lineup.openSpots, 2);
  assert.equal(lineup.savedLineup, true);
});

test("without a saved lineup the best pace starts and FLEX fills last", () => {
  const lineup = buildFaceoffRoster({ roster, rows, rules });
  const bySlot = Object.fromEntries(lineup.starters.map((s) => [s.slot, s.player?.player_id]));
  assert.equal(bySlot.QB, "qb");
  assert.equal(bySlot.RB1, "rb1");
  assert.equal(bySlot.RB2, "rb2");
  assert.equal(bySlot.FLEX, "flex");
  assert.equal(lineup.savedLineup, false);
});

test("weakest starter is the lowest eligible pace, and an empty slot first", () => {
  const lineup = buildFaceoffRoster({ roster, rows, rules });
  assert.equal(weakestFaceoffStarter("WR", lineup.starters, rules).player.player_id, "flex");
  assert.equal(weakestFaceoffStarter("QB", lineup.starters, rules).player.player_id, "qb");
  assert.equal(weakestFaceoffStarter("K", lineup.starters, rules), null);
  const thin = buildFaceoffRoster({ roster: roster.slice(0, 2), rows, rules });
  assert.equal(weakestFaceoffStarter("RB", thin.starters, rules).player, null);
});

test("compare reads against the target slot when eligible, else the weakest starter", () => {
  const lineup = buildFaceoffRoster({ roster, rows, rules });
  const wr2 = lineup.starters.find((s) => s.slot === "WR2");
  assert.deepEqual(faceoffCompare(available[0], { starters: lineup.starters, rules }).delta, 3.0);
  assert.equal(faceoffCompare(available[0], { starters: lineup.starters, target: wr2, rules }).delta, 0.3);
  const qb = lineup.starters.find((s) => s.slot === "QB");
  assert.equal(faceoffCompare(available[0], { starters: lineup.starters, target: qb, rules }).against.slot, "FLEX");
  assert.equal(faceoffCompare(available[3], { starters: lineup.starters, rules }).delta, null);
});

test("weak spots skip K/DEF and repeat positions", () => {
  const lineup = buildFaceoffRoster({ roster, rows, rules });
  assert.deepEqual(faceoffWeakSpots(lineup.starters).map((s) => s.slot), ["FLEX", "TE", "WR2"]);
});

test("beats counts eligible free agents above the starter and skips pending ones", () => {
  const lineup = buildFaceoffRoster({ roster, rows, rules });
  const flex = lineup.starters.find((s) => s.slot === "FLEX");
  assert.equal(faceoffBeats(flex, available, { rules }), 2);
  assert.equal(faceoffBeats(flex, available, { rules, exclude: new Set(["fa-wr"]) }), 1);
});

test("lineup total is unknown when a filled starter has no forecast", () => {
  const lineup = buildFaceoffRoster({ roster, rows, rules });
  assert.equal(faceoffLineupTotal(lineup.starters).total, 94.6);
  const missing = buildFaceoffRoster({ roster, rows: rows.filter((r) => r.player_id !== "te"), rules });
  assert.equal(faceoffLineupTotal(missing.starters).total, null);
  assert.equal(faceoffLineupTotal(missing.starters).missing, 1);
});

test("pending moves swap one starter each and report the lineup change", () => {
  const lineup = buildFaceoffRoster({ roster, rows, rules });
  const secondWr = { player_id: "fa-wr2", player: "Second Receiver", position: "WR", per_game_proj: 12.3 };
  const pending = faceoffPending(lineup.starters, [available[0], available[1], available[2], secondWr], rules);
  assert.equal(pending.swaps.size, 2);
  const flexSwap = pending.swaps.get("FLEX");
  assert.equal(flexSwap.row.player_id, "fa-wr");
  assert.equal(flexSwap.from.player_id, "flex");
  assert.equal(pending.swaps.get("WR2").row.player_id, "fa-wr2");
  assert.equal(pending.before, 94.6);
  assert.equal(pending.after, 97.8);
  assert.equal(pending.delta, 3.2);
});

test("best upgrade respects the target and excludes pending", () => {
  const lineup = buildFaceoffRoster({ roster, rows, rules });
  assert.equal(faceoffBestUpgrade(available, { starters: lineup.starters, rules }).row.player_id, "fa-wr");
  assert.equal(faceoffBestUpgrade(available, { starters: lineup.starters, rules, exclude: new Set(["fa-wr"]) }).row.player_id, "fa-rb");
  const te = lineup.starters.find((s) => s.slot === "TE");
  assert.equal(faceoffBestUpgrade(available, { starters: lineup.starters, target: te, rules }), null);
});

test("range marks place the starter tick and the amber beat region", () => {
  const against = { slot: "FLEX", player: { pg: 9.4 } };
  const marks = faceoffRangeMarks({ p10: 140, p50: 210, p90: 260 }, against, 300);
  assert.equal(marks.season, 160);
  assert.ok(Math.abs(marks.tick - 53.27) < 0.1);
  assert.ok(Math.abs(marks.beat - 53.27) < 0.1);
  assert.equal(faceoffRangeMarks({ p10: 10, p50: 20, p90: 30 }, against, 300).beat, null);
  assert.equal(faceoffRangeMarks(null, { player: null }, 300), null);
});

test("model picks the target slot, filters eligibility and keeps K/DEF out of beats", () => {
  const model = buildFaceoffModel({ roster, rows, availableRows: available, rules, pendingRows: [], target: "FLEX" });
  assert.equal(model.targetSlot.slot, "FLEX");
  assert.equal(model.eligible(available[0]), true);
  assert.equal(model.eligible({ position: "QB" }), false);
  assert.equal(model.beats.get("FLEX"), 2);
  assert.equal(model.best.row.player_id, "fa-wr");
  assert.equal(model.total.total, 94.6);
  const open = buildFaceoffModel({ roster, rows, availableRows: available, rules, target: "open" });
  assert.equal(open.target, "open");
  assert.equal(open.targetSlot, null);
  const none = buildFaceoffModel({ roster: [], rows, availableRows: available, rules });
  assert.equal(none.hasStarters, false);
  assert.equal(none.compare(available[0]).against.player, null);
  assert.equal(none.compare(available[0]).delta, 12.4);
});
