import assert from "node:assert/strict";
import test from "node:test";
import { MY_TEAM_COPY, rosterStatusInfo } from "./rosterPresentation.js";

test("My team copy names the decision and skips Draft Hub / permission voice", () => {
  assert.match(MY_TEAM_COPY.purpose, /cut|extend|cap/i);
  assert.doesNotMatch(MY_TEAM_COPY.purpose, /Submit|Draft Hub|permission/i);
  assert.equal(MY_TEAM_COPY.title, "My team");
  assert.equal(MY_TEAM_COPY.reviewExtensions, "Review extensions");
  assert.equal(MY_TEAM_COPY.undoExtension, "Undo extension");
  assert.match(MY_TEAM_COPY.queuedNote, /undo/i);
  assert.match(MY_TEAM_COPY.undoExtensionHint, /expire/i);
  assert.match(MY_TEAM_COPY.removeConfirm, /no dead cap/i);
  assert.match(MY_TEAM_COPY.removeConfirm, /refunds the full cap charge/);
  assert.doesNotMatch(MY_TEAM_COPY.removeConfirm, /Staff only|permission/i);
  assert.equal(MY_TEAM_COPY.dropLabel, "Remove without penalty");
  assert.equal(MY_TEAM_COPY.cutLabel, "Cut");
  assert.equal(MY_TEAM_COPY.undoCut, "Undo cut");
  assert.equal(MY_TEAM_COPY.undoCutClosed, "Undo cut is closed");
  assert.match(MY_TEAM_COPY.undoCutClosedDetail("Bravo"), /Bravo's roster/);
  assert.match(MY_TEAM_COPY.undoCutClosedSupport("Bravo"), /Bravo's roster/);
  assert.equal(MY_TEAM_COPY.cutConfirmTitle("Veteran"), "Cut Veteran?");
  assert.match(MY_TEAM_COPY.cutConfirm("$4", "$4"), /Frees \$4 in cap room/);
  assert.match(MY_TEAM_COPY.cutConfirm("$4", "$4"), /\$4 in dead cap/);
});

test("cut status chip says Cut, not Cut before draft", () => {
  const cut = rosterStatusInfo(
    { roster_status: "cut_before_draft", contract: { years_remaining: 3 } },
    { draftCompleted: true },
  );
  assert.equal(cut.label, "Cut");
  assert.equal(cut.tone, "cut");
});

test("My team qualifies committed as the season year", () => {
  assert.equal(MY_TEAM_COPY.committedLabel(2026), "2026 committed");
  assert.doesNotMatch(MY_TEAM_COPY.committedLabel(2026), /current roster/i);
});

test("pre-draft status splits extension eligible from expiring", () => {
  const rookie = rosterStatusInfo(
    { contract: { years_remaining: 1, contract_type: "rookie" } },
    { draftCompleted: false, ctype: "rookie" },
  );
  const veteran = rosterStatusInfo(
    { contract: { years_remaining: 1, contract_type: "veteran" } },
    { draftCompleted: false, ctype: "veteran" },
  );
  const blockedVet = rosterStatusInfo(
    { contract: { years_remaining: 1, contract_type: "veteran" } },
    {
      draftCompleted: false,
      ctype: "veteran",
      rules: { contracts: { allow_veteran_renewal: false } },
    },
  );
  const extension = rosterStatusInfo(
    { contract: { years_remaining: 1, contract_type: "extension" } },
    { draftCompleted: false, ctype: "extension" },
  );
  assert.equal(rookie.label, "Extension eligible");
  assert.equal(rookie.tone, "extend");
  assert.equal(veteran.label, "Extension eligible");
  assert.equal(veteran.tone, "extend");
  assert.equal(blockedVet.label, "Expiring");
  assert.equal(extension.label, "Expiring");
  assert.doesNotMatch(blockedVet.label, /FA|Expires/);
});
