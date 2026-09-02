import assert from "node:assert/strict";
import test from "node:test";
import { LEGAL_PRIVACY, LEGAL_TERMS, SMS_OPT_IN } from "./legalPresentation.js";

test("privacy names Twilio and the A2P required disclosures", () => {
  assert.match(LEGAL_PRIVACY.smsBody, /Twilio/);
  assert.match(LEGAL_PRIVACY.smsBody, /do not share mobile numbers/i);
  assert.match(LEGAL_PRIVACY.smsBody, /Message frequency varies/);
  assert.match(LEGAL_PRIVACY.smsBody, /Message and data rates may apply/);
  assert.doesNotMatch(LEGAL_PRIVACY.smsBody, /Draft Hub|Submit|permission/i);
});

test("SMS opt-in card has every A2P web-form line", () => {
  assert.match(SMS_OPT_IN.phoneLabel, /phone/i);
  assert.match(SMS_OPT_IN.consent, /lobby open/i);
  assert.match(SMS_OPT_IN.consent, /Consent is not required/);
  assert.match(SMS_OPT_IN.frequency, /up to 3 messages/);
  assert.match(SMS_OPT_IN.rates, /Message and data rates may apply/);
  assert.match(SMS_OPT_IN.helpStop, /HELP/);
  assert.match(SMS_OPT_IN.helpStop, /STOP/);
  assert.equal(SMS_OPT_IN.termsLabel, "Terms of Service");
  assert.equal(SMS_OPT_IN.privacyLabel, "Privacy Policy");
  assert.match(SMS_OPT_IN.submit, /Yes, text me/);
  assert.doesNotMatch(SMS_OPT_IN.submit, /Submit|Draft Hub/i);
  assert.match(SMS_OPT_IN.needConsent, /starts empty/);
});

test("terms say SMS is optional and name the vendor", () => {
  assert.match(LEGAL_TERMS.smsBody, /optional/i);
  assert.match(LEGAL_TERMS.smsBody, /Twilio/);
  assert.match(LEGAL_TERMS.smsBody, /Reply STOP/);
  assert.match(LEGAL_TERMS.smsBody, /Message and data rates may apply/);
  assert.doesNotMatch(LEGAL_TERMS.smsBody, /Draft Hub|Submit|permission/i);
});
