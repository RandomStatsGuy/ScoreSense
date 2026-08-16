import test from "node:test";
import assert from "node:assert/strict";
import {
  TRUST_LABEL,
  INJURY_STALE_SAFEGUARD_MESSAGE,
  canLabelIncludedInProjection,
  commentaryOnlyLabel,
  formatInjuryAgeHours,
  formatOppPoints,
  injuryStaleSafeguardMessage,
  isDetailAvailable,
  isStaleVsProjection,
  shouldShowProjectionAssumesActive,
  parseContextTime,
} from "./playerContextDisplay.js";

function baseContext(overrides = {}) {
  return {
    projection: { base: 16.8, final: 16.8, injury_delta: 0 },
    availability: { status: null, practice: null, updated_at: null },
    opportunity_adjustment: { points: 0, drivers: [], included: false },
    media_context: {
      state: "none",
      signal: null,
      source_count: 0,
      summary: null,
      updated_at: null,
      affects_projection: false,
    },
    meta: {
      season: 2026,
      week: 1,
      context_built_at: "2026-08-14T12:00:00+00:00",
      stale: false,
    },
    ...overrides,
  };
}

test("formatOppPoints formats signed tenths", () => {
  assert.equal(formatOppPoints(2.1), "+2.1");
  assert.equal(formatOppPoints(-1.25), "−1.3");
  assert.equal(formatOppPoints(0), null);
});

test("isDetailAvailable respects SCORE-30 compact flag", () => {
  assert.equal(isDetailAvailable(null), false);
  assert.equal(isDetailAvailable({ detail_available: false }), false);
  assert.equal(isDetailAvailable({ detail_available: true }), true);
  assert.equal(
    isDetailAvailable(baseContext()),
    true,
    "detail payloads without flag still expand",
  );
});

test("formatInjuryAgeHours formats compact badge ages", () => {
  assert.equal(formatInjuryAgeHours(null), null);
  assert.equal(formatInjuryAgeHours(-1), null);
  assert.equal(formatInjuryAgeHours(0.4), "<1h");
  assert.equal(formatInjuryAgeHours(6.2), "6h");
  assert.equal(formatInjuryAgeHours(72), "3d");
});

test("canLabelIncludedInProjection requires included + freshness", () => {
  const included = baseContext({
    opportunity_adjustment: { points: 2.1, drivers: [], included: true },
    projection: { base: 14.7, final: 16.8, injury_delta: 2.1 },
    availability: {
      status: null,
      practice: null,
      updated_at: "2026-08-14T10:00:00+00:00",
    },
    meta: {
      context_built_at: "2026-08-14T12:00:00+00:00",
      stale: false,
    },
  });
  assert.equal(canLabelIncludedInProjection(included), true);

  assert.equal(
    canLabelIncludedInProjection(baseContext()),
    false,
  );

  const stale = {
    ...included,
    meta: { ...included.meta, stale: true },
  };
  assert.equal(canLabelIncludedInProjection(stale), false);

  const injuryNewer = {
    ...included,
    availability: {
      ...included.availability,
      updated_at: "2026-08-14T18:00:00+00:00",
    },
  };
  assert.equal(canLabelIncludedInProjection(injuryNewer), false);

  assert.equal(
    canLabelIncludedInProjection(included, { stale: true }),
    false,
  );
});

test("canLabelIncludedInProjection prefers SCORE-33 inclusion_trust", () => {
  const trusted = baseContext({
    opportunity_adjustment: { points: 2.1, included: true },
    inclusion_trust: {
      included: true,
      can_label_included: true,
      stale_vs_projection: false,
      message: null,
    },
  });
  assert.equal(canLabelIncludedInProjection(trusted), true);

  const blocked = baseContext({
    opportunity_adjustment: {
      points: 2.1,
      included: true,
      can_label_included: false,
      stale_vs_projection: true,
      safeguard_message: INJURY_STALE_SAFEGUARD_MESSAGE,
    },
    inclusion_trust: {
      included: true,
      can_label_included: false,
      stale_vs_projection: true,
      message: INJURY_STALE_SAFEGUARD_MESSAGE,
    },
    availability: {
      status: "Out",
      practice: null,
      updated_at: "2026-08-14T20:00:00+00:00",
    },
    meta: {
      context_built_at: "2026-08-14T12:00:00+00:00",
      stale: false,
    },
  });
  assert.equal(canLabelIncludedInProjection(blocked), false);
  assert.equal(isStaleVsProjection(blocked), true);
  assert.equal(
    injuryStaleSafeguardMessage(blocked),
    INJURY_STALE_SAFEGUARD_MESSAGE,
  );

  const oppOnly = baseContext({
    opportunity_adjustment: {
      points: 1.2,
      included: true,
      can_label_included: false,
      stale_vs_projection: true,
    },
  });
  assert.equal(canLabelIncludedInProjection(oppOnly), false);
  assert.equal(isStaleVsProjection(oppOnly), true);
});

test("shouldShowProjectionAssumesActive for Q/D without own reduction", () => {
  const q = baseContext({
    availability: { status: "Questionable", practice: "Limited", updated_at: null },
    projection: { base: 17.4, final: 17.4, injury_delta: 0 },
  });
  assert.equal(shouldShowProjectionAssumesActive(q), true);

  const doubtful = baseContext({
    availability: { status: "Doubtful", practice: "DNP", updated_at: null },
    projection: { base: 12, final: 12, injury_delta: 0 },
  });
  assert.equal(shouldShowProjectionAssumesActive(doubtful), true);

  const reduced = baseContext({
    availability: { status: "Questionable", practice: null, updated_at: null },
    projection: { base: 17.4, final: 10.0, injury_delta: -7.4 },
  });
  assert.equal(shouldShowProjectionAssumesActive(reduced), false);

  const healthy = baseContext({
    availability: { status: null, practice: null, updated_at: null },
  });
  assert.equal(shouldShowProjectionAssumesActive(healthy), false);

  const out = baseContext({
    availability: { status: "Out", practice: null, updated_at: null },
    projection: { base: 17.4, final: 17.4, injury_delta: 0 },
  });
  assert.equal(shouldShowProjectionAssumesActive(out), false);
});

test("commentaryOnlyLabel always labels non-affecting media", () => {
  assert.equal(
    commentaryOnlyLabel({ affects_projection: false, state: "current" }),
    TRUST_LABEL.COMMENTARY,
  );
  assert.equal(
    commentaryOnlyLabel({ affects_projection: true, state: "current" }),
    null,
  );
  assert.equal(commentaryOnlyLabel(null), null);
});

test("parseContextTime handles ISO and unix", () => {
  assert.ok(parseContextTime("2026-08-14T12:00:00+00:00"));
  assert.ok(parseContextTime(1_700_000_000_000));
  assert.equal(parseContextTime(null), null);
  assert.equal(parseContextTime("not-a-date"), null);
});

test("compact list opportunity has points/included without drivers", () => {
  const compact = {
    opportunity_adjustment: { points: 2.1, included: true },
    media_context: {
      state: "current",
      signal: "role_up",
      source_count: 3,
      affects_projection: false,
    },
    availability: { status: "Questionable", age_hours: 5.5 },
    detail_available: true,
    meta: { view: "compact", stale: false },
  };
  assert.equal(isDetailAvailable(compact), true);
  assert.equal(formatOppPoints(compact.opportunity_adjustment.points), "+2.1");
  assert.equal(formatInjuryAgeHours(compact.availability.age_hours), "6h");
  assert.equal(
    compact.opportunity_adjustment.drivers,
    undefined,
    "compact rows omit drivers",
  );
  assert.equal(compact.media_context.summary, undefined);
});
