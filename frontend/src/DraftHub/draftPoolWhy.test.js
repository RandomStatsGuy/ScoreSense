import assert from "node:assert/strict";
import test from "node:test";
import { draftPoolWhy, rangeBarPercents } from "./draftPoolWhy.js";

test("pool why names a need and a range", () => {
  const line = draftPoolWhy(
    { position: "WR", fair_value: 22, min_sal: 16, max_sal: 30 },
    { isNeed: true },
  );
  assert.match(line, /Need WR/);
  assert.match(line, /\$16/);
});

test("range bar marks fair between min and max", () => {
  const bar = rangeBarPercents(10, 20, 30);
  assert.equal(bar.mark, 50);
  assert.equal(rangeBarPercents(10, 10, 10), null);
});
