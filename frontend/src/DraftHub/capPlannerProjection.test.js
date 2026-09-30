import test from "node:test";
import assert from "node:assert/strict";
import { capPlannerProjection } from "./capPlannerPresentation.js";
const sheet = {
  planning_rows: [{
    player_id: 'a',
    cap_hits: [33, 33, 0, 0, 0],
    extension_terms: [{
      years: 2,
      start_offset: 2,
      salaries: [38, 43]
    }]
  }, {
    player_id: 'b',
    cap_hits: [0, 0, 28, 0, 0]
  }],
  multi_year_plan: [33, 33, 28, 0, 0].map(total => ({
    total_committed: total,
    cap_remaining: 200 - total
  }))
};
test('extension affects only the added seasons and leaves saved inputs intact', () => {
  const before = JSON.stringify(sheet),
    result = capPlannerProjection(sheet, {
      a: 2
    });
  assert.deepEqual(result.years.map(y => y.cap_remaining), [167, 167, 134, 157]);
  assert.equal(JSON.stringify(sheet), before);
  assert.deepEqual(capPlannerProjection(sheet, {}).years.map(y => y.cap_remaining), [167, 167, 172]);
});
test('unknown terms never change the cap and over-cap preview is not clamped', () => {
  assert.equal(capPlannerProjection(sheet, {
    a: 9
  }).years[2].cap_remaining, 172);
  const tiny = {
    ...sheet,
    multi_year_plan: sheet.multi_year_plan.map(y => ({
      ...y,
      cap_remaining: 10,
      total_committed: 190
    }))
  };
  assert.equal(capPlannerProjection(tiny, {
    a: 2
  }).years[2].cap_remaining, -28);
});
