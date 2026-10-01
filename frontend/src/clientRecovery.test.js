import test from "node:test";
import assert from "node:assert/strict";
import { clientRecoveryUrl, recoverClientPage } from "./clientRecovery.js";

test("recovery bypasses the old worker and keeps destination, query and fragment", () => {
  const location = { pathname: "/hub/roster", search: "?team=mine&week=4", hash: "#lineup" };
  const url = new URL(clientRecoveryUrl(location), "https://app.fourthdownlabs.com");
  assert.equal(url.pathname, "/api/client-recovery");
  assert.equal(url.searchParams.get("return_to"), "/hub/roster?team=mine&week=4#lineup");
  assert.equal(clientRecoveryUrl({ pathname: "/hub/home" }), "/api/client-recovery?return_to=%2Fhub%2Fhome");
});

test("explicit recovery replaces the failed document instead of repeating reload", () => {
  let destination;
  recoverClientPage({ pathname: "/hub/home", replace: url => { destination = url; } });
  assert.equal(destination, "/api/client-recovery?return_to=%2Fhub%2Fhome");
});
