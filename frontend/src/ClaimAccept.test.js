import test from "node:test";
import assert from "node:assert/strict";
import { claimTokenFromSearch, dropClaimParam } from "./claimSearch.js";

test("claimTokenFromSearch reads the one-shot token", () => {
  assert.equal(claimTokenFromSearch("?claim=abc123&pos=qb"), "abc123");
  assert.equal(claimTokenFromSearch(new URLSearchParams("claim=xyz")), "xyz");
  assert.equal(claimTokenFromSearch(""), "");
});

test("dropClaimParam leaves other query keys", () => {
  const next = dropClaimParam(new URLSearchParams("claim=abc&player=00-1"));
  assert.equal(next.get("claim"), null);
  assert.equal(next.get("player"), "00-1");
});
