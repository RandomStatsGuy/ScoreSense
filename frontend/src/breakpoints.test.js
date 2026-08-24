import test from "node:test";
import assert from "node:assert/strict";
import { MOBILE_MAX, MOBILE_EXIT_MAX, nextMobileLayout } from "./breakpoints.js";

test("nextMobileLayout uses hysteresis so a scrollbar cannot loop desktop/mobile", () => {
  assert.equal(nextMobileLayout(false, MOBILE_MAX), true);
  assert.equal(nextMobileLayout(false, MOBILE_MAX + 1), false);
  assert.equal(nextMobileLayout(true, MOBILE_EXIT_MAX), true);
  assert.equal(nextMobileLayout(true, MOBILE_EXIT_MAX + 1), false);
  const nearBreakpoint = MOBILE_MAX + 10;
  assert.equal(nextMobileLayout(false, nearBreakpoint), false);
  assert.equal(nextMobileLayout(true, nearBreakpoint), true);
});
