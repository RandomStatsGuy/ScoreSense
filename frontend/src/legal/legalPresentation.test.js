import assert from "node:assert/strict";
import test from "node:test";
import { LEGAL_PRIVACY, LEGAL_TERMS } from "./legalPresentation.js";

test("privacy names Twilio and the A2P required disclosures", () => {
  assert.match(LEGAL_PRIVACY.smsBody, /Twilio/);
  assert.match(LEGAL_PRIVACY.smsBody, /do not share mobile numbers/i);
  assert.match(LEGAL_PRIVACY.smsBody, /Message frequency varies/);
  assert.match(LEGAL_PRIVACY.smsBody, /Message and data rates may apply/);
  assert.doesNotMatch(LEGAL_PRIVACY.smsBody, /Draft Hub|Submit|permission/i);
});

test("terms say SMS is optional and name the vendor", () => {
  assert.match(LEGAL_TERMS.smsBody, /optional/i);
  assert.match(LEGAL_TERMS.smsBody, /Twilio/);
  assert.match(LEGAL_TERMS.smsBody, /Reply STOP/);
  assert.match(LEGAL_TERMS.smsBody, /Message and data rates may apply/);
  assert.doesNotMatch(LEGAL_TERMS.smsBody, /Draft Hub|Submit|permission/i);
});
