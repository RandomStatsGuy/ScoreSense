import assert from "node:assert/strict";
import test from "node:test";
import {
  canManagerRookieExtend,
  hasPendingExtension,
  isRookieExtendSuccessMessage,
  rookieExtendCancelSuccessMessage,
  rookieExtendSuccessMessage,
} from "./rookieExtend.js";

test("final-year vet deals can extend unless Rules turns it off", () => {
  const vet = { contract: { contract_type: "veteran", years_remaining: 1 } };
  assert.equal(canManagerRookieExtend(vet, { draftCompleted: false }).ok, true);
  assert.equal(
    canManagerRookieExtend(vet, {
      draftCompleted: false,
      rules: { contracts: { allow_veteran_renewal: false } },
    }).ok,
    false,
  );
});

test("queued extension is detected and blocks a second queue", () => {
  const queued = {
    contract: { contract_type: "rookie", years_remaining: 1, pending_extension: { years: 2 } },
  };
  assert.equal(hasPendingExtension(queued), true);
  const gate = canManagerRookieExtend(queued, { draftCompleted: false, rules: { contracts: { max_years: 3 } } });
  assert.equal(gate.ok, false);
  assert.match(gate.reason, /queued/i);
});

test("undo copy names the expire cost and skips slogan voice", () => {
  const msg = rookieExtendCancelSuccessMessage();
  assert.match(msg, /undone/i);
  assert.match(msg, /expire/i);
  assert.doesNotMatch(msg, /Submit|Draft Hub|permission/i);
});

test("queue success still names activation at draft complete", () => {
  const msg = rookieExtendSuccessMessage({ pending_extension: true, extension_years: 2, start_salary: 15 });
  assert.match(msg, /queued/i);
  assert.match(msg, /draft is marked complete/i);
});

test("Cap and My team tone only the known success prefixes as notices", () => {
  const queued = rookieExtendSuccessMessage({ pending_extension: true, extension_years: 2, start_salary: 15 });
  const already = rookieExtendSuccessMessage({ already_applied: true, extension_years: 2, start_salary: 15 });
  assert.equal(isRookieExtendSuccessMessage(queued), true);
  assert.equal(isRookieExtendSuccessMessage(already), true);
  assert.equal(isRookieExtendSuccessMessage("Contract extended."), true);
  assert.equal(isRookieExtendSuccessMessage(rookieExtendCancelSuccessMessage()), true);

  assert.equal(isRookieExtendSuccessMessage("Pick a player to undo."), false);
  assert.equal(isRookieExtendSuccessMessage("Join a league team to undo extensions"), false);
  assert.equal(isRookieExtendSuccessMessage("No extension is queued on this contract."), false);
  assert.equal(isRookieExtendSuccessMessage("Could not undo the extension"), false);
  assert.equal(
    isRookieExtendSuccessMessage("Extension already queued for 2 year(s). Undo it first to pick a different term."),
    false,
  );
  assert.equal(isRookieExtendSuccessMessage("Extension years must be between 1 and 3."), false);
});
