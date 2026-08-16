import test from "node:test";
import assert from "node:assert/strict";
import {
  MEDIA_STATE,
  VIEW_OLDER_COMMENTARY_LABEL,
  canShowCurrentWeekMediaBadge,
  formatHistoricalWeekLabel,
  historicalOptInCopy,
  isCurrentMedia,
  isHistoricalAvailable,
  mediaContextState,
  mergeMediaMetaFields,
  pickHistoricalWeek,
  setIncludeHistoricalParam,
} from "./mediaContext.js";

test("mediaContextState normalizes known and unknown states", () => {
  assert.equal(mediaContextState({ state: "current" }), MEDIA_STATE.CURRENT);
  assert.equal(
    mediaContextState({ state: "historical_available" }),
    MEDIA_STATE.HISTORICAL_AVAILABLE,
  );
  assert.equal(mediaContextState({ state: "none" }), MEDIA_STATE.NONE);
  assert.equal(mediaContextState(null), MEDIA_STATE.NONE);
  assert.equal(mediaContextState({ state: "legacy" }), MEDIA_STATE.NONE);
});

test("pickHistoricalWeek reads nested season/week", () => {
  assert.deepEqual(
    pickHistoricalWeek({ historical: { season: 2025, week: 18 } }),
    { season: 2025, week: 18 },
  );
  assert.equal(pickHistoricalWeek({ historical: { season: 2025 } }), null);
  assert.equal(pickHistoricalWeek({ state: "none" }), null);
});

test("historicalOptInCopy matches ticket wording", () => {
  const copy = historicalOptInCopy({
    requestedWeek: 1,
    historical: { season: 2025, week: 18 },
  });
  assert.match(copy, /No current Week 1 media coverage/);
  assert.match(copy, /Older discussion is available from 2025 Week 18/);
  assert.equal(formatHistoricalWeekLabel({ season: 2025, week: 18 }), "2025 Week 18");
  assert.equal(VIEW_OLDER_COMMENTARY_LABEL, "View older commentary");
});

test("canShowCurrentWeekMediaBadge only for current + signal", () => {
  assert.equal(
    canShowCurrentWeekMediaBadge({ state: "current", signal: "role_up" }),
    true,
  );
  assert.equal(
    canShowCurrentWeekMediaBadge({
      state: "historical_available",
      signal: "role_up",
      historical: { season: 2025, week: 18 },
    }),
    false,
    "historical must never produce a current-week badge",
  );
  assert.equal(
    canShowCurrentWeekMediaBadge({
      state: "historical_available",
      signal: "mentioned",
      summary: "Older blurb",
    }),
    false,
  );
  assert.equal(canShowCurrentWeekMediaBadge({ state: "current", signal: null }), false);
  assert.equal(isCurrentMedia({ state: "current" }), true);
  assert.equal(isHistoricalAvailable({ state: "historical_available" }), true);
});

test("setIncludeHistoricalParam toggles query flag", () => {
  const params = new URLSearchParams();
  setIncludeHistoricalParam(params, true);
  assert.equal(params.get("include_historical"), "true");
  setIncludeHistoricalParam(params, false);
  assert.equal(params.has("include_historical"), false);
});

test("mergeMediaMetaFields lifts media_context from API payload", () => {
  const merged = mergeMediaMetaFields({
    season: 2026,
    week: 1,
    requested_season: 2026,
    requested_week: 1,
    context_fallback: false,
    media_context: {
      state: "historical_available",
      historical: { season: 2025, week: 18 },
    },
  });
  assert.equal(merged.media_context.state, "historical_available");
  assert.equal(merged.context_fallback, false);
  assert.equal(mergeMediaMetaFields(null), null);
});
