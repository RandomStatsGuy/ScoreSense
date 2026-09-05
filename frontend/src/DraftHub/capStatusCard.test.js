import test from "node:test";
import assert from "node:assert/strict";
import { buildCapStatusCard } from "./capStatusCard.js";

test("buildCapStatusCard returns null without finite remaining", () => {
  assert.equal(buildCapStatusCard({}), null);
  assert.equal(buildCapStatusCard({ remaining: null }), null);
  assert.equal(buildCapStatusCard({ remaining: "x" }), null);
});

test("buildCapStatusCard headlines over / under / at and closes the equation", () => {
  const over = buildCapStatusCard({
    remaining: -70,
    spent: 240,
    salaryCap: 200,
    rosterSize: 15,
    deadCap: 30,
  });
  assert.equal(over.tone, "over");
  assert.equal(over.headline, "You are $70 over cap");
  assert.equal(over.against, 270);
  assert.match(over.meta, /\$270 of \$200 against cap · \$70 over/);
  assert.match(over.meta, /15 players/);

  const under = buildCapStatusCard({ remaining: 40, spent: 160, salaryCap: 200, rosterSize: 1 });
  assert.equal(under.tone, "under");
  assert.equal(under.headline, "You are $40 under cap");
  assert.match(under.meta, /\$160 of \$200 against cap · \$40 leftover/);
  assert.match(under.meta, /1 player/);

  const at = buildCapStatusCard({ remaining: 0, spent: 200, salaryCap: 200 });
  assert.equal(at.tone, "at");
  assert.equal(at.headline, "You are at the cap");
});

test("buildCapStatusCard labels keep-past-draft vs sheet counts", () => {
  const card = buildCapStatusCard({
    remaining: 114,
    spent: 81,
    salaryCap: 200,
    rosterSize: 7,
    sheetSize: 15,
    deadCap: 5,
    preDraft: true,
  });
  assert.equal(card.against, 86);
  assert.match(card.meta, /\$86 of \$200 against cap · \$114 leftover/);
  assert.match(card.meta, /7 keep past this draft/);
  assert.match(card.meta, /15 on this sheet/);
  assert.doesNotMatch(card.meta, /\$81 of \$200 committed/);
});
