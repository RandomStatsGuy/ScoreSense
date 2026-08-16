/**
 * SCORE-13: unit checks for projection coverage gating.
 * Run with: node --test frontend/src/DraftHub/projectionCoverage.test.js
 * (Node ESM; package may need "type":"module" — also importable from vitest if present.)
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  isPoorProjectionCoverage,
  MIN_PROJECTION_COVERAGE,
  MIN_ROSTER_FOR_COVERAGE_GATE,
  projectionCoverageRatio,
} from "./projectionCoverage.js";

test("projectionCoverageRatio handles empty roster", () => {
  assert.equal(projectionCoverageRatio({}), 1);
  assert.equal(projectionCoverageRatio({ roster: 0, missing_projections: 0 }), 1);
});

test("projectionCoverageRatio computes covered share", () => {
  assert.equal(projectionCoverageRatio({ roster: 20, missing_projections: 19 }), 0.05);
  assert.equal(projectionCoverageRatio({ roster: 10, missing_projections: 2 }), 0.8);
});

test("isPoorProjectionCoverage blocks when artifacts missing", () => {
  assert.equal(
    isPoorProjectionCoverage({
      status: { projections_missing: true },
      counts: { roster: 15, missing_projections: 15 },
    }),
    true,
  );
});

test("isPoorProjectionCoverage ignores projections_missing on empty roster", () => {
  assert.equal(
    isPoorProjectionCoverage({
      status: { projections_missing: true, empty_roster: true },
      counts: { roster: 0, missing_projections: 0 },
    }),
    false,
  );
});

test("isPoorProjectionCoverage blocks ticket-style sparse coverage", () => {
  assert.equal(
    isPoorProjectionCoverage({
      status: {},
      counts: { roster: 20, missing_projections: 19 },
    }),
    true,
  );
});

test("isPoorProjectionCoverage allows adequate coverage", () => {
  assert.equal(
    isPoorProjectionCoverage({
      status: {},
      counts: { roster: 20, missing_projections: 2 },
    }),
    false,
  );
  assert.ok(0.8 >= MIN_PROJECTION_COVERAGE);
});

test("isPoorProjectionCoverage skips tiny rosters", () => {
  assert.equal(
    isPoorProjectionCoverage({
      status: {},
      counts: { roster: MIN_ROSTER_FOR_COVERAGE_GATE - 1, missing_projections: 3 },
    }),
    false,
  );
});

test("isPoorProjectionCoverage skips empty roster", () => {
  assert.equal(
    isPoorProjectionCoverage({
      status: { empty_roster: true },
      counts: { roster: 0, missing_projections: 0 },
    }),
    false,
  );
});
