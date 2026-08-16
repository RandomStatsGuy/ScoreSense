/**
 * SCORE-13: gate lineup decisions on usable weekly projection coverage.
 * When too many roster players lack projections, the decision list is noise.
 */

/** Minimum share of roster with weekly projections before decisions are shown. */
export const MIN_PROJECTION_COVERAGE = 0.6;

/** Skip the coverage gate on tiny / mid-import rosters. */
export const MIN_ROSTER_FOR_COVERAGE_GATE = 4;

export function projectionCoverageRatio(counts = {}) {
  const roster = Number(counts.roster) || 0;
  if (roster <= 0) return 1;
  const missing = Number(counts.missing_projections) || 0;
  const covered = Math.max(0, roster - missing);
  return covered / roster;
}

export function isPoorProjectionCoverage({ counts = {}, status = {} } = {}) {
  if (status.empty_roster) return false;
  const roster = Number(counts.roster) || 0;
  if (roster <= 0) return false;
  // Full artifact outage with a real roster — block before decision noise.
  if (status.projections_missing) return true;
  if (roster < MIN_ROSTER_FOR_COVERAGE_GATE) return false;
  return projectionCoverageRatio(counts) < MIN_PROJECTION_COVERAGE;
}
