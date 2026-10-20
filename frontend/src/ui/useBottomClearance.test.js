import test from "node:test";
import assert from "node:assert/strict";
import { bottomActionClearance } from "./useBottomClearance.js";

test("detached actions reserve their measured extent above navigation", () => {
  const bar = (top) => ({ top, fixed: true, visible: true });
  assert.equal(bottomActionClearance(844, 76, [bar(708)]), 60);
  assert.equal(bottomActionClearance(844, 100, [bar(648)]), 96);
  assert.equal(bottomActionClearance(900, 0, [bar(804), bar(840)]), 96);
});

test("in-flow, hidden and removed actions release their reserved space", () => {
  assert.equal(bottomActionClearance(844, 76, [{top:600,fixed:false,visible:true},{top:400,fixed:true,visible:false}]), 0);
  assert.equal(bottomActionClearance(844, 76, []), 0);
});
