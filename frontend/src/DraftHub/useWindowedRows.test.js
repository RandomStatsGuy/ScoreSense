import assert from "node:assert/strict";
import test from "node:test";

import { AVAILABLE_ROW_HEIGHT, windowRange } from "./useWindowedRows.js";

test("windowRange keeps about 40 visible rows plus overscan", () => {
  const range = windowRange(702, 0, 800, 44, 12);
  assert.equal(range.start, 0);
  assert.ok(range.end < 80, `expected a window, got end=${range.end}`);
  assert.ok(range.end > 20);
});

test("windowRange scrolls into the middle of a 702-row board", () => {
  const range = windowRange(702, 44 * 200, 800, 44, 12);
  assert.ok(range.start >= 180);
  assert.ok(range.end <= 250);
  assert.ok(range.end - range.start < 60);
});

test("page-board window keeps a short slice at 52px rows", () => {
  const range = windowRange(702, 0, 900, AVAILABLE_ROW_HEIGHT, 12);
  assert.equal(range.start, 0);
  assert.ok(range.end < 50, `expected a window, got end=${range.end}`);
  assert.ok(AVAILABLE_ROW_HEIGHT < 60);
});
