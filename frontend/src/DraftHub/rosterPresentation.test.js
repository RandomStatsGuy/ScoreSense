import assert from "node:assert/strict";
import test from "node:test";
import { MY_TEAM_COPY, rosterStatusInfo } from "./rosterPresentation.js";

test("My team copy names the decision and skips Draft Hub / permission voice", () => {
  assert.match(MY_TEAM_COPY.purpose, /cut|extend|cap/i);
  assert.doesNotMatch(MY_TEAM_COPY.purpose, /Submit|Draft Hub|permission/i);
  assert.equal(MY_TEAM_COPY.title, "My team");
  assert.equal(MY_TEAM_COPY.reviewExtensions, "Review extensions");
  assert.doesNotMatch(MY_TEAM_COPY.removeConfirm, /Staff only|permission/i);
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
  assert.equal(rookie.label, "Extension eligible");
  assert.equal(rookie.tone, "extend");
  assert.equal(veteran.label, "Expiring");
  assert.equal(veteran.tone, "expire");
  assert.notEqual(rookie.tone, veteran.tone);
});
