import assert from "node:assert/strict";
import test from "node:test";
import {
  findLiveContractTarget,
  liveContractCapHitBlurb,
  liveContractsIntroHint,
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

  assert.match(liveContractsIntroHint(2026, false), /Pre-draft keepers for 2026/);
  assert.match(liveContractsIntroHint(2026, true), /after the draft year tick/);

  assert.match(liveContractCapHitBlurb(2026, false), /upcoming 2026/);
  assert.doesNotMatch(liveContractCapHitBlurb(2026, false), /after the draft year tick/);
  assert.match(liveContractCapHitBlurb(2026, true), /after the draft year tick/);
});
