import test from "node:test";
import assert from "node:assert/strict";
import { formatListedProj, formatSeasonPts } from "./seasonQuantiles.js";

test("formatListedProj hides missing and zero draft projections", () => {
  assert.equal(formatListedProj(141), "141");
  assert.equal(formatListedProj(0), "—");
  assert.equal(formatListedProj(null), "—");
  assert.equal(formatListedProj(undefined), "—");
  assert.equal(formatSeasonPts(0), "0");
});
