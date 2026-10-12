import test from "node:test";
import assert from "node:assert/strict";
import { groupExposureRequest, exposureRuleFromRequest, exposureRequest, convertExposureUnits } from "./dfsGlobalExposure.js";
const pool = ["a", "b", "c"].map(player_id => ({ player_id, salary: 5000 }));
const core = { id: "stable:1", label: "My pair", player_ids: ["b", "a"], unit: "percent", min: "10.1", target: "20", max: "30.1" };

test("T10/T11 group bounds retain exact requested-N rounding and canonical member IDs", () => {
  const [rule] = groupExposureRequest([core], 150, [], [], {}, 1, pool);
  assert.deepEqual(rule, { id: "stable:1", player_ids: ["a", "b"], min: "0.101", target: "0.2", max: "0.301" });
  assert.deepEqual(exposureRuleFromRequest(rule, 150), { unit: "count", min: "16", target: "30", max: "45" });
});
test("T10 locks, exclusions and tighter member maxima block contradictory core bounds", () => {
  assert.throws(() => groupExposureRequest([core], 150, ["a", "b"], [], {}, 1, pool), /every member is locked/);
  assert.throws(() => groupExposureRequest([core], 150, [], ["b"], {}, 1, pool), /skipped member/);
  assert.throws(() => groupExposureRequest([core], 150, [], [], { a: { unit: "count", max: "15" } }, 1, pool), /member's maximum/);
  assert.throws(() => groupExposureRequest([core], 150, [], [], {}, 0.1, pool), /member's maximum/);
});
test("T11 labels do not identify a core and duplicate memberships cannot create competing controls", () => {
  assert.throws(() => groupExposureRequest([core, { ...core, id: "other", label: "Renamed" }], 150, [], [], {}, 1, pool), /already has a control/);
  assert.throws(() => groupExposureRequest([{ ...core, player_ids: ["a", "unknown"] }], 150, [], [], {}, 1, pool), /eligible players/);
  assert.throws(() => groupExposureRequest([{ ...core, player_ids: ["a", "a"] }], 150, [], [], {}, 1, pool), /distinct eligible/);
});
test("T14 fraction imports retain recurring hard bounds and full fractional target precision", () => {
  const rule = exposureRuleFromRequest({ min: "0.33333333", max: "0.33333334", target: "0.33333333" }, 149);
  assert.equal(rule.min, "50"); assert.equal(rule.max, "49");
  assert.throws(() => exposureRequest({ a: rule }, 149), /minimum 50 exceeds maximum 49/);
  const soft = exposureRuleFromRequest({ target: "0.33333333" }, 149);
  assert.equal(exposureRequest({ a: soft }, 149).a.target.count, 49.66666617);
  const again = convertExposureUnits({ a: { unit: "count", min: "50", max: "50" } }, 149, "percent");
  assert.deepEqual(exposureRuleFromRequest(exposureRequest(again, 149).a, 149), { unit: "count", min: "50", max: "50" });
});

test("T14 switching units preserves a plan's exact soft target even when its displayed percent repeats", () => {
  const countRule = { a: { unit: "count", target: "20" } };
  const percent = convertExposureUnits(countRule, 149, "percent");
  assert.equal(percent.a.target, "13.422819");
  assert.deepEqual(exposureRequest(percent, 149), { a: { target: { count: 20 } } });
  assert.equal(convertExposureUnits(percent, 149, "count").a.target, "20");
  assert.equal(exposureRequest(percent, 150).a.target, "0.13422819");
  const tiny = convertExposureUnits({ a: { unit: "count", target: "1e-20" } }, 149, "percent");
  assert.equal(exposureRequest(tiny, 149).a.target.count, 1e-20);
});
