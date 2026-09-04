import assert from "node:assert/strict";
import test from "node:test";
import { ACCURACY_COPY } from "./accuracyPresentation.js";

test("accuracy copy names the miss, not a trust slogan", () => {
  assert.match(ACCURACY_COPY.heading, /miss/i);
  assert.match(ACCURACY_COPY.support("2018–2025"), /sit you would have gotten wrong/i);
  assert.doesNotMatch(ACCURACY_COPY.heading, /Why trust|Draft Hub|Submit/i);
  assert.doesNotMatch(ACCURACY_COPY.lead, /built for fantasy football decisions/i);
});
