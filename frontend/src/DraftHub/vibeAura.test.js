import assert from "node:assert/strict";
import test from "node:test";
import {
  AURA_BASE,
  applyVibe,
  auraTone,
  calendarDay,
  clearDayVote,
  fillSlotsByScore,
  formatAura,
  formatPtsDelta,
  normalizeDayVotes,
  playersLeftToday,
  readAura,
  recordDayVote,
  todayRatedCount,
  vibeDivergences,
  vibeScore,
} from "./vibeAura.js";

const bijan = { player_id: "bijan", player_name: "Bijan Robinson", position: "RB", p50: 17 };
const gibbs = { player_id: "gibbs", player_name: "Jahmyr Gibbs", position: "RB", p50: 16 };
const saquon = { player_id: "saquon", player_name: "Saquon Barkley", position: "RB", p50: 15 };
const puka = { player_id: "puka", player_name: "Puka Nacua", position: "WR", p50: 15.8 };

test("start raises aura and sit lowers it, clamped 0–99", () => {
  let aura = {};
  aura = applyVibe(aura, "bijan", "start");
  assert.equal(readAura(aura, "bijan"), AURA_BASE + 14);
  aura = applyVibe(aura, "bijan", "sit");
  aura = applyVibe(aura, "bijan", "sit");
  assert.equal(readAura(aura, "bijan"), AURA_BASE + 14 - 28);
  let hot = { x: 90 };
  hot = applyVibe(hot, "x", "start");
  assert.equal(readAura(hot, "x"), 99);
});

test("aura 50 leaves projection unchanged; hot aura lifts the week", () => {
  assert.equal(vibeScore(bijan, 50), 17);
  assert.ok(vibeScore(bijan, 99) > vibeScore(bijan, 50));
  assert.ok(vibeScore(bijan, 0) < vibeScore(bijan, 50));
});

test("high personal aura can start a lower projection over the model pick", () => {
  const plan = [
    { key: "RB1", slot: "RB1", position: "RB", index: 0 },
    { key: "RB2", slot: "RB2", position: "RB", index: 1 },
  ];
  const aura = { saquon: 99, bijan: 20, gibbs: 50 };
  const slots = fillSlotsByScore(plan, [bijan, gibbs, saquon], (player) => (
    vibeScore(player, readAura(aura, player.player_id))
  ));
  assert.equal(slots[0].player.player_id, "saquon");
  assert.ok(["bijan", "gibbs"].includes(slots[1].player.player_id));
});

test("divergences name who your vibes start over the model", () => {
  const proj = [{ player: bijan }, { player: puka }];
  const vibe = [{ player: saquon }, { player: puka }];
  const { pairs } = vibeDivergences(proj, vibe);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].start.player_name, "Saquon Barkley");
  assert.equal(pairs[0].sit.player_name, "Bijan Robinson");
});

test("copy helpers stay numeric and never mention Draft Hub", () => {
  assert.equal(formatAura(72.4), "72");
  assert.equal(auraTone(80), "hot");
  assert.equal(auraTone(20), "cold");
  assert.equal(formatPtsDelta(2.3), "+2.3");
  assert.equal(formatPtsDelta(-1.4), "−1.4");
  assert.equal(formatPtsDelta(0), "0.0");
});

test("one swipe per player per calendar day, then the card leaves the deck", () => {
  const now = new Date("2026-09-02T15:00:00");
  const later = new Date("2026-09-02T22:00:00");
  const tomorrow = new Date("2026-09-03T09:00:00");
  let day = recordDayVote(null, "bijan", "start", now);
  assert.equal(day.date, "2026-09-02");
  assert.equal(day.votes.bijan, "start");
  day = recordDayVote(day, "puka", "sit", later);
  const left = playersLeftToday([bijan, puka, saquon], day.votes);
  assert.deepEqual(left.map((row) => row.player_id), ["saquon"]);
  assert.equal(todayRatedCount([bijan, puka, saquon], day.votes), 2);
  day = clearDayVote(day, "puka", later);
  assert.equal(playersLeftToday([bijan, puka], day.votes).length, 1);
  const nextDay = normalizeDayVotes(day, tomorrow);
  assert.equal(nextDay.date, calendarDay(tomorrow));
  assert.deepEqual(nextDay.votes, {});
});
