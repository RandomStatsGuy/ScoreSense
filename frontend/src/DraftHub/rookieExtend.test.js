import assert from "node:assert/strict";
import test from "node:test";
import {
  canManagerRookieExtend,
  hasPendingExtension,
  rookieExtendCancelSuccessMessage,
  rookieExtendSuccessMessage,
} from "./rookieExtend.js";

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
