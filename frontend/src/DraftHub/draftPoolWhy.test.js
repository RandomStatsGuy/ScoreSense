import assert from "node:assert/strict";
import test from "node:test";
import { draftPoolWhy, rangeBarCopy, rangeBarPercents, showPoolNeedChip } from "./draftPoolWhy.js";

test("pool why names a need and a range once a player is owned", () => {
  const line = draftPoolWhy(
    { position: "WR", fair_value: 22, min_sal: 16, max_sal: 30 },
    { isNeed: true, rosterCount: 1 },
  );
  assert.match(line, /Need WR/);
  assert.match(line, /\$16/);
});

test("empty roster does not stamp Need on every why line", () => {
  const line = draftPoolWhy(
    { position: "WR", fair_value: 39, min_sal: 27, max_sal: 51 },
    { isNeed: true, rosterCount: 0 },
  );
  assert.doesNotMatch(line, /Need WR/);
  assert.equal(showPoolNeedChip({ isNeed: true, rosterCount: 0 }), false);
  assert.equal(showPoolNeedChip({ isNeed: true, rosterCount: 2 }), true);
});

test("range bar marks fair between min and max", () => {
  const bar = rangeBarPercents(10, 20, 30);
  assert.equal(bar.mark, 50);
  assert.equal(rangeBarPercents(10, 10, 10), null);
});

test("range copy labels floor suggested and ceiling", () => {
  const copy = rangeBarCopy(27, 39, 51);
  assert.match(copy.floor, /27/);
  assert.match(copy.suggested, /39/);
  assert.match(copy.ceiling, /51/);
});
