import assert from "node:assert/strict";
import test from "node:test";
import { LANDING_INTENTS, landingAction, landingAuthHref, landingContent, landingForPath, landingIntent } from "./landingPresentation.js";

test("landing signup and sign-in carry each intent to its actual app destination", () => {
  for (const intent of LANDING_INTENTS) for (const mode of ["register", "login"]) {
    const link = new URL(landingAuthHref(intent.id, mode), "https://example.invalid");
    assert.equal(link.pathname, `/${mode}`);
    assert.equal(link.searchParams.get("next"), intent.path);
    assert.equal(link.searchParams.get("from"), "landing");
    assert.equal(link.searchParams.get("intent"), intent.id);
  }
});

test("unknown intent and mode cannot introduce an external destination", () => {
  assert.equal(landingIntent("https://evil.invalid").id, "weekly");
  assert.equal(landingIntent("__proto__").id, "weekly");
  const link = new URL(landingAuthHref("//evil.invalid", "//evil.invalid"), "https://example.invalid");
  assert.equal(link.pathname, "/register");
  assert.equal(link.searchParams.get("next"), "/projections/weekly");
});

test("each public product page leads from its sample to the correct access boundary", () => {
  for (const product of LANDING_INTENTS) {
    assert.equal(landingForPath(product.landing)?.id, product.id);
    assert.equal(landingForPath(`${product.landing}/`)?.id, product.id);
    assert.equal(landingAction(product.id, { overview: true }).href, product.landing);
    assert.equal(landingAction(product.id, { authenticated: true }).href, product.path);
    const anonymous = landingAction(product.id);
    if (product.id === "weekly") {
      assert.equal(anonymous.href, product.path);
      assert.match(anonymous.note, /free.*no account/i);
    } else {
      const auth = new URL(anonymous.href, "https://example.invalid");
      assert.equal(auth.pathname, "/register");
      assert.equal(auth.searchParams.get("next"), product.path);
      assert.match(anonymous.note, /account.*required/i);
    }
    assert.equal(landingContent(product.id).eyebrow, product.area);
  }
  assert.equal(landingForPath("/projections/weekly"), null);
  assert.equal(landingForPath("/tools/dfs"), null);
  assert.equal(landingForPath("//evil.invalid"), null);
});


test("focused landing lookup follows case-insensitive product routes", () => {
  assert.equal(landingForPath("/FANTASY/").id, "fantasy");
  assert.equal(landingForPath("/PROJECTIONS").id, "weekly");
  assert.equal(landingForPath("/%54OOLS").id, "tools");
});
