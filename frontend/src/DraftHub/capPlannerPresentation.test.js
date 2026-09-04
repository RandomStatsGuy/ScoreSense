import assert from "node:assert/strict";
import test from "node:test";
import { capHeroCopy } from "./capPlannerPresentation.js";

test("Cap hero asks if you can afford the bid", () => {
  const live = capHeroCopy();
  assert.match(live.heading, /afford/i);
  assert.match(live.support, /leftover|bid/i);
  const empty = capHeroCopy({ empty: true });
  assert.match(empty.support, /guess/i);
  const pre = capHeroCopy({ preDraft: true });
  assert.match(pre.support, /dead cap/i);
  assert.doesNotMatch(JSON.stringify(live), /three seasons before you spend|Draft Hub|Submit/i);
});
