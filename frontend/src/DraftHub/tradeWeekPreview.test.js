import assert from "node:assert/strict";
import test from "node:test";
import { partyTradeBundle, projectTradeWeekLineup } from "./tradeWeekPreview.js";

const RULES = {
  roster: {
    qb: { starter: 1 },
    rb: { starter: 2 },
    wr: { starter: 2 },
    te: { starter: 1 },
    flex: { starter: 1, eligible: ["RB", "WR", "TE"] },
    k: { starter: 0 },
    def: { starter: 0 },
  },
};

const MY = "team-a";
const THEIRS = "team-b";

function roster() {
  return {
    [MY]: [
      { player_id: "rb-start", player_name: "CMC", position: "RB", p50: 18 },
      { player_id: "rb-two", player_name: "RB Two", position: "RB", p50: 12 },
      { player_id: "wr-start", player_name: "WR Ace", position: "WR", p50: 16 },
      { player_id: "wr-two", player_name: "WR Two", position: "WR", p50: 11 },
      { player_id: "te-start", player_name: "TE One", position: "TE", p50: 9 },
      { player_id: "qb-start", player_name: "QB One", position: "QB", p50: 20 },
      { player_id: "rb-bench", player_name: "RB Bench", position: "RB", p50: 8 },
    ],
    [THEIRS]: [
      { player_id: "wr-star", player_name: "Puka Nacua", position: "WR", p50: 22 },
      { player_id: "rb-meh", player_name: "RB Meh", position: "RB", p50: 6 },
    ],
  };
}

function cardsFromRoster(byTeam) {
  const cards = {};
  for (const rows of Object.values(byTeam)) {
    for (const row of rows) {
      cards[row.player_id] = {
        player_id: row.player_id,
        player_name: row.player_name,
        position: row.position,
        p50: row.p50,
      };
    }
  }
  return cards;
}

function startersFromMine(byTeam) {
  const mine = byTeam[MY];
  return [
    { ...mine.find((r) => r.player_id === "qb-start"), slot: "QB", lineup_role: "starter" },
    { ...mine.find((r) => r.player_id === "rb-start"), slot: "RB1", lineup_role: "starter" },
    { ...mine.find((r) => r.player_id === "rb-two"), slot: "RB2", lineup_role: "starter" },
    { ...mine.find((r) => r.player_id === "wr-start"), slot: "WR1", lineup_role: "starter" },
    { ...mine.find((r) => r.player_id === "wr-two"), slot: "WR2", lineup_role: "starter" },
    { ...mine.find((r) => r.player_id === "te-start"), slot: "TE", lineup_role: "starter" },
    { ...mine.find((r) => r.player_id === "rb-bench"), slot: "FLEX", lineup_role: "starter" },
  ];
}

test("incoming star WR raises after P50 and names the bump", () => {
  const byTeam = roster();
  const preview = projectTradeWeekLineup({
    rosterByTeam: byTeam,
    parties: [
      { team_id: MY, sends: [], drops: [] },
      { team_id: THEIRS, sends: [{ player_id: "wr-star", to_team_id: MY }], drops: [] },
    ],
    myTeamId: MY,
    weekCards: cardsFromRoster(byTeam),
    weekStarters: startersFromMine(byTeam),
    rules: RULES,
  });
  assert.equal(preview.available, true);
  assert.ok(preview.after_p50 > preview.before_p50);
  assert.ok(preview.delta > 0);
  assert.equal(preview.bumped_starters[0]?.player_id, "wr-star");
});

test("sending a starter names the lost starter and drops after P50", () => {
  const byTeam = roster();
  const preview = projectTradeWeekLineup({
    rosterByTeam: byTeam,
    parties: [
      { team_id: MY, sends: [{ player_id: "rb-start", to_team_id: THEIRS }], drops: [] },
      { team_id: THEIRS, sends: [], drops: [] },
    ],
    myTeamId: MY,
    weekCards: cardsFromRoster(byTeam),
    weekStarters: startersFromMine(byTeam),
    rules: RULES,
  });
  assert.equal(preview.available, true);
  assert.ok(preview.after_p50 < preview.before_p50);
  assert.equal(preview.lost_starters[0]?.player_id, "rb-start");
});

test("missing week projections hide the strip instead of a zero lineup", () => {
  const preview = projectTradeWeekLineup({
    rosterByTeam: roster(),
    parties: [{ team_id: MY, sends: [], drops: [] }],
    myTeamId: MY,
    weekCards: {},
    weekStarters: [],
    rules: RULES,
    projectionsAvailable: false,
  });
  assert.equal(preview.available, false);
  assert.equal(preview.before_p50, null);
  assert.equal(preview.after_p50, null);
  assert.equal(preview.delta, null);
});

test("empty roster hides the strip", () => {
  const preview = projectTradeWeekLineup({
    rosterByTeam: { [MY]: [] },
    parties: [{ team_id: MY, sends: [], drops: [] }],
    myTeamId: MY,
    weekCards: {},
    rules: RULES,
    emptyRoster: true,
  });
  assert.equal(preview.available, false);
});

test("incoming numeric roster ids still resolve against string trade ids", () => {
  const byTeam = roster();
  byTeam[THEIRS] = [
    { player_id: 4034, player_name: "Puka Nacua", position: "WR", p50: 22 },
  ];
  const preview = projectTradeWeekLineup({
    rosterByTeam: byTeam,
    parties: [
      { team_id: MY, sends: [], drops: [] },
      { team_id: THEIRS, sends: [{ player_id: "4034", to_team_id: MY }], drops: [] },
    ],
    myTeamId: MY,
    weekCards: {
      ...cardsFromRoster(roster()),
      4034: { player_id: "4034", player_name: "Puka Nacua", position: "WR", p50: 22 },
    },
    weekStarters: startersFromMine(roster()),
    rules: RULES,
  });
  assert.equal(preview.available, true);
  assert.equal(preview.bumped_starters[0]?.player_id, "4034");
});

test("party bundle reads receives from the other seat", () => {
  const bundle = partyTradeBundle(
    [
      { team_id: MY, sends: [{ player_id: "a", to_team_id: THEIRS }], drops: ["cut-1"] },
      { team_id: THEIRS, sends: [{ player_id: "b", to_team_id: MY }], drops: [] },
    ],
    MY,
  );
  assert.deepEqual([...bundle.sendIds], ["a"]);
  assert.deepEqual([...bundle.dropIds], ["cut-1"]);
  assert.deepEqual(bundle.receiveIds, ["b"]);
});
