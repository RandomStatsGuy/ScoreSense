import assert from "node:assert/strict";
import test from "node:test";
import { expireChipLabel, stepBlockedReason, TRADES_COPY, tradesCopyForFormat, tradesFreeLabel } from "./leagueTradesPresentation.js";

test("trade desk names its cap metric and review action without banned verbs", () => {
  assert.match(TRADES_COPY.heading, /trade/i);
  assert.match(TRADES_COPY.yourCap, /cap room/i);
  assert.match(TRADES_COPY.reviewTrade, /review trade/i);
  assert.doesNotMatch(TRADES_COPY.inviteManagers, /Submit|Draft Hub|permission/i);
  assert.doesNotMatch(TRADES_COPY.valid, /constraint/i);
  assert.doesNotMatch(TRADES_COPY.ideasEmptyHeading, /import salaries/i);
});

test("pick draft trades use roster language and omit salary concepts", () => {
  const copy = tradesCopyForFormat(true);
  const visible = [copy.support, copy.pickPartnerSupport, copy.choosePlayersSupport, copy.playerMetaKey, copy.reviewTitle, copy.reviewSupport, copy.valid].join(" ");
  assert.match(visible, /roster/i);
  assert.doesNotMatch(visible, /cap|salary|contract|dead|points per dollar/i);
  assert.equal(copy.cutVerb, "Drop");
});

test("step blockers explain partner vs package", () => {
  assert.equal(
    stepBlockedReason("players", { hasPartner: false, hasPackage: false }),
    TRADES_COPY.stepNeedPartner,
  );
  assert.equal(
    stepBlockedReason("propose", { hasPartner: true, hasPackage: false }),
    TRADES_COPY.stepNeedPackage,
  );
  assert.equal(stepBlockedReason("review", { hasPartner: true, hasPackage: true }), "");
});

test("free label qualifies the cap", () => {
  assert.equal(tradesFreeLabel(200, (n) => `$${n}`), "cap room / $200");
  assert.equal(tradesFreeLabel(null, (n) => `$${n}`), "cap room");
});

test("expire chips match Rosters and never name FA", () => {
  assert.equal(expireChipLabel("extend"), "Extendable");
  assert.equal(expireChipLabel("fa"), "Expiring");
  assert.doesNotMatch(expireChipLabel("extend"), /\?/);
  assert.doesNotMatch(expireChipLabel("fa"), /FA|Expires/);
});

test("send and get names include the player and destination", () => {
  assert.equal(
    TRADES_COPY.sendTo("Jayden Daniels", "Disappointment"),
    "Send Jayden Daniels to Disappointment",
  );
  assert.equal(
    TRADES_COPY.getFrom("Jayden Daniels", "Disappointment"),
    "Get Jayden Daniels from Disappointment",
  );
});


test("package headline prioritizes cap and lost positional coverage over a projected starter", async () => {
  const { tradePackageHeadline } = await import("./leagueTradesPresentation.js");
  const args = { myTeamId: "mine", parties: [{ team_id: "mine", sends: [{ player_id: "rb", to_team_id: "other" }] },
    { team_id: "other", sends: [{ player_id: "wr", to_team_id: "mine" }] }],
    weekPreview: { available: true, bumped_starters: [{ player_name: "Incoming WR" }] },
    projected: { unspent: -7, base: { unspent: 10, by_position_count: { RB: 2 } }, by_position_count: { RB: 1 } },
    rules: { roster: { rb: { starter: 2 } } } };
  assert.equal(tradePackageHeadline(args).text, "Needs $7 more cap room");
  args.projected.unspent = 10;
  assert.equal(tradePackageHeadline(args).text, "Leaves 1 RB for 2 starting slots");
  args.projected.by_position_count.RB = 2;
  assert.equal(tradePackageHeadline(args).text, "Incoming WR enters your projected starters");
  args.weekPreview.available = false;
  assert.doesNotMatch(tradePackageHeadline(args).text, /starter|win|fair|chance/i);
});

test("pick-league headlines and comparisons omit money; missing forecasts remain unranked", async () => {
  const { tradePackageHeadline, tradeVersionComparison } = await import("./leagueTradesPresentation.js");
  const current = { unspent: -7, base: { unspent: 20 }, by_position_count: { QB: 1, WR: 3 } };
  const headline = tradePackageHeadline({ myTeamId: "mine", salaryLeague: false, projected: current,
    parties: [{ team_id: "other", sends: [{ player_id: "wr", to_team_id: "mine" }] }], weekPreview: { available: false } });
  assert.doesNotMatch(headline.text, /cap|salary|contract|dead|\$/i);
  const rows = tradeVersionComparison({ current, other: { by_position_count: { QB: 1, WR: 2 } },
    currentWeek: { available: false, after_p50: null }, otherWeek: { available: true, after_p50: 70 }, salaryLeague: false });
  assert.deepEqual(rows, [{ text: "1 more player", tone: "neutral" }]);
});

test("version comparisons use after totals and preserve genuine zero projections", async () => {
  const { tradeVersionComparison } = await import("./leagueTradesPresentation.js");
  assert.deepEqual(tradeVersionComparison({ current: { unspent: 18 }, other: { unspent: 25 },
    currentWeek: { available: true, after_p50: 0 }, otherWeek: { available: true, after_p50: 5 } }),
  [{ text: "-5.0 starter PPR", tone: "down" }, { text: "$7 less cap room", tone: "down" }]);
  assert.deepEqual(tradeVersionComparison({ current: { unspent: null }, other: { unspent: 25 } }), []);
});


test("cap change gives the direction before the money and keeps missing values unknown", async () => {
  const { tradeCapChangeText } = await import("./leagueTradesPresentation.js");
  assert.equal(tradeCapChangeText(20, 26), "+$6");
  assert.equal(tradeCapChangeText(20, 14), "−$6");
  assert.equal(tradeCapChangeText(null, 14), null);
  assert.equal(tradeCapChangeText(20, 20), null);
});


test("phone consequence names the position without filling the band with a long player name", async () => {
  const { tradePackageHeadline } = await import("./leagueTradesPresentation.js");
  const headline = tradePackageHeadline({ myTeamId: "mine", parties: [{ team_id: "other", sends: [{ player_id: "qb", to_team_id: "mine" }] }],
    weekPreview: { available: true, bumped_starters: [{ player_name: "A very long player name with several surnames", position: "QB" }] } });
  assert.equal(headline.compactText, "Adds a projected QB starter");
  assert.match(headline.text, /several surnames/);
});
