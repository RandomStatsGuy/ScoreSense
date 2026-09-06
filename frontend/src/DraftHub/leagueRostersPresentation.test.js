import assert from "node:assert/strict";
import test from "node:test";
import {
  DEALS_VIEW,
  ROSTERS_COPY,
  activeRoster,
  contractGradeLabel,
  contractGradeText,
  dealCounts,
  expireChipLabel,
  formatDealsRailFacts,
  formatManagerRailFacts,
  joinFacts,
  leagueDealRows,
  managerDealFacts,
  managerPickerOptions,
  positionSpendNote,
  tradeActionLabel,
  tradeLockReason,
  yearsLeftLabel,
} from "./leagueRostersPresentation.js";

test("hero names the deal and the cost of getting it wrong", () => {
  assert.match(ROSTERS_COPY.heading, /deal/i);
  assert.match(ROSTERS_COPY.support, /cheap year|overpay/i);
  assert.doesNotMatch(ROSTERS_COPY.support, /Draft Hub|Submit|permission/i);
  assert.equal(ROSTERS_COPY.exportExcel, "Download Excel");
  assert.match(ROSTERS_COPY.exportTitle, /Excel/i);
  assert.doesNotMatch(ROSTERS_COPY.exportTitle, /Draft Hub|Submit|permission/i);
  assert.equal(DEALS_VIEW, "deals");
});

test("Fair with a zero delta is the word alone", () => {
  assert.equal(contractGradeLabel("fair"), "Fair");
  assert.equal(
    contractGradeText({ contract_grade: "fair", value_delta: 0, fair_value: 11 }),
    "Fair",
  );
  assert.equal(
    contractGradeText({ contract_grade: "fair", value_delta: null, fair_value: 11 }),
    "Fair",
  );
});

test("Overpay and Bargain keep the vs-fair phrasing", () => {
  assert.equal(contractGradeLabel("bad"), "Overpay");
  assert.equal(contractGradeLabel("good"), "Bargain");
  assert.equal(
    contractGradeText({ contract_grade: "bad", value_delta: 6, fair_value: 11 }),
    "Overpay (+$6) vs $11 fair",
  );
  assert.equal(
    contractGradeText({ contract_grade: "good", value_delta: -4, fair_value: 15 }),
    "Bargain (−$4) vs $15 fair",
  );
});

test("expire chips are status, never a question", () => {
  assert.equal(expireChipLabel("extend"), "Extendable");
  assert.equal(expireChipLabel("fa"), "Expires — FA");
  assert.doesNotMatch(expireChipLabel("extend"), /\?/);
});

test("joinFacts drops empty sides so a middot cannot float", () => {
  assert.equal(joinFacts(["$13 free", "", "2 expiring"]), "$13 free · 2 expiring");
  assert.equal(joinFacts([null, "Fair"]), "Fair");
});

test("active roster and deal rows skip null entries so windowing cannot crash", () => {
  const roster = [
    null,
    { player_id: "1", player_name: "Metcalf", contract_grade: "bad", value_delta: 6 },
    undefined,
    { player_id: "2", player_name: "Taxi", roster_status: "taxi", contract_grade: "good", value_delta: -2 },
  ];
  assert.deepEqual(
    activeRoster({ roster }).map((r) => r.player_id),
    ["1"],
  );
  const rows = leagueDealRows([{ team: { id: "a", owner_name: "Ada" }, roster }]);
  assert.deepEqual(rows.map((r) => r.player_name), ["Metcalf"]);
});

test("league deal list is Overpay and Bargain sorted by absolute delta", () => {
  const rows = leagueDealRows([
    {
      team: { id: "a", owner_name: "Ada" },
      roster: [
        { player_id: "1", player_name: "Metcalf", contract_grade: "bad", value_delta: 6 },
        { player_id: "2", player_name: "Fair Guy", contract_grade: "fair", value_delta: 0 },
        { player_id: "3", player_name: "Cheap Year", contract_grade: "good", value_delta: -3 },
      ],
    },
    {
      team: { id: "b", owner_name: "Bea" },
      roster: [
        { player_id: "4", player_name: "Bigger Overpay", contract_grade: "bad", value_delta: 12 },
      ],
    },
  ]);
  assert.deepEqual(
    rows.map((r) => r.player_name),
    ["Bigger Overpay", "Metcalf", "Cheap Year"],
  );
  assert.equal(rows[0].ownerTeamId, "b");
  assert.deepEqual(dealCounts(rows), { overpays: 2, bargains: 1 });
  assert.equal(formatDealsRailFacts(rows), "2 overpays · 1 bargain");
});

test("manager rail facts name free cap, expiring, and worst overpay", () => {
  const facts = managerDealFacts({
    stats: { unspent: 13 },
    roster: [
      { expire_chip: "fa", contract_grade: "fair", value_delta: 0 },
      { expire_chip: "fa", contract_grade: "bad", value_delta: 6, player_name: "DK" },
      { expire_chip: "extend", contract_grade: "bad", value_delta: 2, player_name: "Small" },
    ],
  });
  assert.equal(facts.free, 13);
  assert.equal(facts.expiring, 2);
  assert.equal(facts.worstOverpay, 6);
  assert.equal(formatManagerRailFacts(facts), "$13 free · 2 expiring · +$6 overpay");
});

test("offseason trade lock names the surviving-contract rule", () => {
  const window = { trade_scope: "surviving_contracts" };
  assert.equal(tradeLockReason({ years_remaining: 2 }, window), "");
  assert.match(tradeLockReason({ years_remaining: 1 }, window), /survive the next draft/i);
  assert.equal(tradeActionLabel({ isOwnTeam: true }), "Add to trade");
  assert.equal(tradeActionLabel({ isOwnTeam: false }), "Trade for");
});

test("years left stays a short label", () => {
  assert.equal(yearsLeftLabel({ years_remaining: 1 }), "1 yr");
  assert.equal(yearsLeftLabel({ contract_years: 3 }), "3 yrs");
});

test("position spend keeps count on the money, not a floating middot", () => {
  assert.equal(
    positionSpendNote({
      by_position_spend: { QB: 11, RB: 58, WR: 0 },
      by_position_count: { QB: 1, RB: 3, WR: 0 },
    }),
    "QB $11 (1) · RB $58 (3)",
  );
});

test("phone picker options carry deal facts under the owner name", () => {
  const options = managerPickerOptions(
    [
      {
        team: { id: "a", owner_name: "Caleb K" },
        stats: { unspent: 65 },
        roster: [{ expire_chip: "fa", contract_grade: "bad", value_delta: 6 }],
      },
    ],
    [{ contract_grade: "bad" }, { contract_grade: "good" }],
  );
  assert.equal(options[0].label, "Deals");
  assert.equal(options[0].detail, "1 overpay · 1 bargain");
  assert.equal(options[1].label, "Caleb K");
  assert.equal(options[1].detail, "$65 free · 1 expiring · +$6 overpay");
});
