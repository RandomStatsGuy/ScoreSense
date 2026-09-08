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
  assert.match(MY_TEAM_COPY.removeConfirm, /No dead cap/);
  assert.match(MY_TEAM_COPY.removeConfirm, /Cut if you meant a penalty/);
  assert.doesNotMatch(MY_TEAM_COPY.removeConfirm, /Staff only|permission|refund/i);
  assert.equal(MY_TEAM_COPY.dropLabel, "Drop");
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
