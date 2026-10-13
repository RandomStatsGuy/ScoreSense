import assert from "node:assert/strict";
import test from "node:test";
import { ACCURACY_COPY, typicalMissLine } from "./accuracyPresentation.js";

test("accuracy copy names the miss, not a trust slogan", () => {
  assert.match(ACCURACY_COPY.heading, /miss/i);
  assert.match(ACCURACY_COPY.support("2018–2025"), /sit you would have gotten wrong/i);
  assert.doesNotMatch(ACCURACY_COPY.heading, /Why trust|Draft Hub|Submit/i);
  assert.doesNotMatch(ACCURACY_COPY.lead, /built for fantasy football decisions/i);
  assert.equal(typicalMissLine({ position: "qb", miss: 4.9 }), "QB typical miss · 4.9 pts");
  assert.equal(typicalMissLine({ miss: null }), "");
});

test("typical miss hides unavailable values but preserves a measured zero", () => {
  for (const miss of [null, undefined, "", "  ", NaN, Infinity, -Infinity, "unavailable", false, true, [], {}]) {
    assert.equal(typicalMissLine({ position: "wr", miss }), "");
  }
  assert.equal(typicalMissLine(), "");
  assert.equal(typicalMissLine({ position: "wr", miss: 0 }), "WR typical miss · 0.0 pts");
  assert.equal(typicalMissLine({ position: "rb", miss: "3.2" }), "RB typical miss · 3.2 pts");
});
