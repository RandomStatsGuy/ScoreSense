import test from "node:test";
import assert from "node:assert/strict";
import { bottomActionClearance, focusClearanceDelta } from "./useBottomClearance.js";

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


test("focus reveals the composer action group between measured bars", () => {
  assert.equal(focusClearanceDelta({top:440,bottom:486},{top:420,bottom:532},306,489),43);
  assert.equal(focusClearanceDelta({top:280,bottom:324},{top:260,bottom:372},306,489),-46);
  assert.equal(focusClearanceDelta({top:350,bottom:396},{top:330,bottom:442},306,489),0);
});

test("oversized groups preserve the focused control without chasing the whole card", () => {
  assert.equal(focusClearanceDelta({top:450,bottom:494},{top:100,bottom:600},306,489),5);
  assert.equal(focusClearanceDelta({top:350,bottom:394},{top:100,bottom:600},306,489),0);
  assert.equal(focusClearanceDelta({top:350,bottom:394},{top:100,bottom:600},500,400),0);
});
