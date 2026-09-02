/** Copy for /privacy and /terms. Goal + consequence. Used by A2P campaign review. */

export const LEGAL_PRIVACY = Object.freeze({
  lastUpdated: "September 2026",
  phoneCollect:
    "Mobile number, only if you opt in to draft alert texts. Stored on your account.",
  smsTitle: "Draft alert texts",
  smsBody:
    "If you opt in, we store your mobile number on your ScoreSense account and use it only to send draft alerts: lobby open, 15 minutes before the draft, and draft is live. Message frequency varies and is typically a few texts around your league draft. Message and data rates may apply. We do not share mobile numbers with third parties or affiliates for marketing or promotional purposes. Texts are sent through Twilio. You can turn SMS off in Account or reply STOP.",
  twilioThirdParty:
    "Twilio processes your mobile number when you opt in to draft alert texts, only to deliver those messages.",
  smsChoice:
    "Draft alert texts are optional. Turn them off in Account or reply STOP. The app and your draft seat still work.",
});

export const LEGAL_TERMS = Object.freeze({
  lastUpdated: "September 2026",
  smsTitle: "Draft alert texts",
  smsBody:
    "Draft alert texts are optional. They are not required to use ScoreSense or to hold a draft seat. If you opt in, you agree to receive SMS from ScoreSense about your league draft (lobby open, 15 minutes before start, and draft is live). Message frequency varies. Message and data rates may apply. Reply STOP to cancel, HELP for help. We send texts through Twilio.",
});

/** Public / Account opt-in card. Content matches A2P web-form requirements. */
export const SMS_OPT_IN = Object.freeze({
  title: "Draft alert texts",
  support:
    "Optional texts when your league draft is about to start. Not required to keep your seat.",
  phoneLabel: "Mobile phone number",
  phonePlaceholder: "(555) 123-4567",
  consent:
    "Yes, I want ScoreSense to send automated texts about my league draft: lobby open, 15 minutes before start, and when the draft goes live. I understand I will receive up to 3 messages per draft. Consent is not required to use ScoreSense or keep a draft seat.",
  frequency:
    "Message frequency: up to 3 messages per league draft (lobby open, 15 minutes before start, and draft is live).",
  rates: "Message and data rates may apply.",
  helpStop: "Reply HELP for help or STOP to cancel any time.",
  termsLabel: "Terms of Service",
  privacyLabel: "Privacy Policy",
  submit: "Yes, text me",
  needPhone: "Enter a mobile number.",
  needConsent: "Check the box to opt in. It starts empty on purpose.",
  saved: "You will get draft alert texts at this number. Reply STOP to cancel.",
});
