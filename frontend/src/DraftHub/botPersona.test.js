import assert from "node:assert/strict";
import test from "node:test";
import {
  BOT_PERSONAS,
  botIdentityLook,
  displayBotName,
  looksLikeNatoBotName,
  resolveBotPersona,
} from "./botPersona.js";

test("NATO bot names resolve to locker personas", () => {
  assert.equal(looksLikeNatoBotName("Bot Bravo"), true);
  const whale = resolveBotPersona({ name: "Bot Bravo", is_bot: true });
  assert.equal(whale.name, "Whale");
  assert.equal(whale.hint, "Jumps +$10");
  assert.equal(displayBotName("Bot Bravo"), "Whale");
  assert.equal(displayBotName("The Auditor"), "The Auditor");
});

test("human teams do not get a persona from a coincidental name", () => {
  assert.equal(resolveBotPersona({ name: "Alpha Dogs", is_bot: false }), null);
  assert.equal(displayBotName("Alpha Dogs", { name: "Alpha Dogs" }), "Alpha Dogs");
});

test("eleven seats cover the NATO roster without emoji", () => {
  assert.equal(BOT_PERSONAS.length, 11);
  for (const persona of BOT_PERSONAS) {
    assert.doesNotMatch(persona.name, /🤖|Bot /);
    const look = botIdentityLook({ name: persona.nato, is_bot: true });
    assert.ok(look.banner_preset);
    assert.ok(look.photo_preset);
  }
});
