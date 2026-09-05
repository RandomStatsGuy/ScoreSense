import assert from "node:assert/strict";
import test from "node:test";
import {
  findLiveContractTarget,
  LIVE_CONTRACT_PHASE,
  liveContractCapHitBlurb,
  liveContractPhase,
  liveContractsIntroHint,
  liveContractStage,
  liveRosterSalaryHint,
  matchLiveRosterPlayer,
} from "./officeCurrentContracts.js";

const GIBBS = {
  player_id: "00-0039139",
  sleeper_player_id: "9224",
  player_name: "Jahmyr Gibbs",
  salary: 12,
  contract: { years_remaining: 2 },
};

test("matchLiveRosterPlayer accepts GSIS and Sleeper ids", () => {
  assert.equal(matchLiveRosterPlayer(GIBBS, "00-0039139"), true);
  assert.equal(matchLiveRosterPlayer(GIBBS, "9224"), true);
  assert.equal(matchLiveRosterPlayer(GIBBS, "sleeper-9224"), true);
  assert.equal(matchLiveRosterPlayer(GIBBS, "00-0039138"), false);
});

test("matchLiveRosterPlayer ignores short suffix collisions", () => {
  assert.equal(matchLiveRosterPlayer(GIBBS, "9"), false);
  assert.equal(matchLiveRosterPlayer(GIBBS, "39"), false);
});

test("findLiveContractTarget opens the owning team", () => {
  const teams = [
    { team: { id: "a", name: "Alpha" }, roster: [{ player_id: "other" }] },
    { team: { id: "b", name: "Beta" }, roster: [GIBBS] },
  ];
  const hit = findLiveContractTarget(teams, "00-0039139");
  assert.equal(hit.teamId, "b");
  assert.equal(hit.row.player_name, "Jahmyr Gibbs");
  assert.equal(findLiveContractTarget(teams, "sleeper-9224").teamId, "b");
  assert.equal(findLiveContractTarget(teams, "missing"), null);
});

test("live roster copy is pre-draft until draft complete", () => {
  assert.match(liveRosterSalaryHint(2026, false), /pre-draft/i);
  assert.match(liveRosterSalaryHint(2026, false), /include 2026/);
  assert.doesNotMatch(liveRosterSalaryHint(2026, false), /after the 2026 draft year tick/);
  assert.match(liveRosterSalaryHint(2026, true), /after the 2026 draft year tick/);

  assert.match(liveContractsIntroHint(2026, false), /Editing 2026 keeper contracts/);
  assert.match(liveContractsIntroHint(2026, true), /draft year tick already ran/);

  assert.match(liveContractCapHitBlurb(2026, false), /upcoming 2026/);
  assert.doesNotMatch(liveContractCapHitBlurb(2026, false), /after the draft year tick/);
  assert.match(liveContractCapHitBlurb(2026, true), /after the draft year tick/);
});

test("liveContractPhase maps setup, live auction, and after draft", () => {
  assert.equal(liveContractPhase({}), LIVE_CONTRACT_PHASE.PRE_DRAFT);
  assert.equal(liveContractPhase({ leagueStatus: "setup" }), LIVE_CONTRACT_PHASE.PRE_DRAFT);
  assert.equal(liveContractPhase({ leagueStatus: "live" }), LIVE_CONTRACT_PHASE.LIVE_DRAFT);
  assert.equal(liveContractPhase({ draftCompleted: true }), LIVE_CONTRACT_PHASE.AFTER_DRAFT);
  assert.equal(
    liveContractPhase({ leagueStatus: "LIVE", draftCompleted: true }),
    LIVE_CONTRACT_PHASE.LIVE_DRAFT,
  );
});

test("liveContractStage shows year, phase, and draft impact", () => {
  const pre = liveContractStage(2026, { draftCompleted: false, leagueStatus: "setup" });
  assert.equal(pre.phase, LIVE_CONTRACT_PHASE.PRE_DRAFT);
  assert.equal(pre.yearLabel, "2026 season");
  assert.equal(pre.phaseLabel, "Pre-draft");
  assert.equal(pre.capColumn, "2026 cap");
  assert.equal(pre.capColumnSub, "pre-draft");
  assert.equal(pre.yearsColumnSub, "incl. 2026");
  assert.equal(pre.draftRules.length, 3);
  assert.match(pre.draftRules[0], /committed before the auction/);
  assert.match(pre.draftRules[1], /1 year left expires to FA/);
  assert.match(pre.draftRules[2], /burns 1 year/);
  assert.match(pre.draftImpact, /committed before the auction/);
  assert.match(pre.draftImpact, /1 year left expires to FA/);
  assert.match(pre.draftImpact, /burns 1 year/);

  const live = liveContractStage(2026, { leagueStatus: "live" });
  assert.equal(live.phase, LIVE_CONTRACT_PHASE.LIVE_DRAFT);
  assert.match(live.headline, /auction is live/);
  assert.match(live.draftImpact, /reduces remaining draft budget/);
  assert.equal(live.capColumnSub, "in the auction");

  const after = liveContractStage(2026, { draftCompleted: true, leagueStatus: "completed" });
  assert.equal(after.phase, LIVE_CONTRACT_PHASE.AFTER_DRAFT);
  assert.match(after.headline, /year tick already ran/);
  assert.match(after.draftImpact, /do not rewind keepers/);
  assert.equal(after.capColumnSub, "after year tick");
});
