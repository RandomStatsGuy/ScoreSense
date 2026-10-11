import test from "node:test";
import assert from "node:assert/strict";
import { exposureCount, exposureRequest, auditGlobalStructure, convertExposureUnits } from "./dfsGlobalExposure.js";

test("T10: 40% of 150 is 60; decimal bounds use ceil/floor without binary drift", () => {
  assert.equal(exposureCount("40", 150, "target"), 60);
  assert.equal(exposureCount("33.333333", 150, "min"), 50);
  assert.equal(exposureCount("33.333333", 150, "max"), 49);
  assert.equal(exposureCount("58", 50, "max"), 29);
  assert.equal(exposureCount("0", 150, "max"), 0);
  assert.equal(exposureCount("", 150, "min"), null);
  assert.equal(exposureCount("60", 150, "target", "count"), 60);
  for (const bad of ["NaN", "-1", "101", "1e2", "0.1234567"]) assert.throws(() => exposureCount(bad, 150, "max"));
});

test("T10/T12: locks and exclusions count; targets do not rewrite forecasts", () => {
  const rules = { p: { unit: "percent", min: "20", target: "40", max: "60" } };
  assert.deepEqual(exposureRequest(rules, 150), { p: { min: "0.2", target: "0.4", max: "0.6" } });
  assert.throws(() => exposureRequest(rules, 150, ["p"]), /locked/);
  assert.throws(() => exposureRequest(rules, 150, [], ["p"]), /skipped/);
  assert.throws(() => exposureRequest({}, 150, ["p"], [], .6), /global lock/);
  assert.throws(() => exposureRequest({ p: { min: "40", max: "30" } }, 150), /minimum/);
  assert.throws(() => exposureRequest({ p: { min: "70", max: "100" } }, 150, [], [], .6), /minimum/);
  assert.throws(() => exposureRequest({ p: { max: "100" } }, 150, ["p"], [], .6), /locked/);
  assert.deepEqual(exposureRequest({ p: { unit: "count", max: "29" } }, 50), { p: { max: { count: 29 } } });
});

test("Switching units preserves hard appearance bounds, including recurring percentages", () => {
  const counts = { p: { unit: "count", min: "50", max: "50", target: "60" } };
  const percents = convertExposureUnits(counts, 150, "percent");
  assert.equal(exposureCount(percents.p.min, 150, "min"), 50);
  assert.equal(exposureCount(percents.p.max, 150, "max"), 50);
  assert.deepEqual(convertExposureUnits(percents, 150, "count"), counts);
  assert.equal(exposureRequest({ p: { unit: "percent", min: "33.3" } }, 150).p.min, "0.333");
});

test("T11/T13: 89 shared RB appearances and 114 TE FLEX remain visible without a ban", () => {
  const lineups = Array.from({ length: 150 }, (_, i) => ({ lineup: [
    { player_id: i < 90 ? "a" : `a${i}`, player: "RB A", position: "RB", slot: "RB1" },
    { player_id: i < 89 || i === 90 ? "b" : `b${i}`, player: "RB B", position: "RB", slot: "RB2" },
    { player_id: `f${i}`, player: "Flex", position: i < 114 ? "TE" : "WR", slot: "FLEX" },
  ] }));
  const audit = auditGlobalStructure(lineups);
  assert.equal(audit.pairs.find(p => p.ids.join() === "a,b").count, 89);
  assert.equal(audit.flex.TE, 114);
  assert.equal(audit.total, 150);
});
