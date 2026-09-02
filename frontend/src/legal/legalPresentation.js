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
