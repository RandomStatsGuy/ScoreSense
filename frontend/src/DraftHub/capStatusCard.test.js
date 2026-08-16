import test from "node:test";
import assert from "node:assert/strict";
import { buildCapStatusCard } from "./capStatusCard.js";

test("buildCapStatusCard returns null without finite remaining", () => {
  assert.equal(buildCapStatusCard({}), null);
  assert.equal(buildCapStatusCard({ remaining: null }), null);
  assert.equal(buildCapStatusCard({ remaining: "x" }), null);
});

test("buildCapStatusCard headlines over / under / at", () => {
  const over = buildCapStatusCard({
    remaining: -70,
    spent: 270,
    salaryCap: 200,
    rosterSize: 15,
  });
  assert.equal(over.tone, "over");
  assert.equal(over.headline, "You are $70 over cap");
  assert.match(over.meta, /\$270 of \$200 committed/);
  assert.match(over.meta, /15 players/);

  const under = buildCapStatusCard({ remaining: 40, spent: 160, salaryCap: 200, rosterSize: 1 });
  assert.equal(under.tone, "under");
  assert.equal(under.headline, "You are $40 under cap");
  assert.match(under.meta, /1 player$/);

  const at = buildCapStatusCard({ remaining: 0, spent: 200, salaryCap: 200 });
  assert.equal(at.tone, "at");
  assert.equal(at.headline, "You are at the cap");
});

test("buildCapStatusCard includes dead cap in meta when present", () => {
  const card = buildCapStatusCard({
    remaining: -10,
    spent: 180,
    salaryCap: 200,
    deadCap: 30,
  });
  assert.match(card.meta, /\$30 dead cap/);
});
