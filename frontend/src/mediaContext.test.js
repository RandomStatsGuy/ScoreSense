import test from "node:test";
import assert from "node:assert/strict";
import {
  MEDIA_MODE,
  MEDIA_STATE,
  VIEW_OLDER_COMMENTARY_LABEL,
  applyMediaQueryParams,
  canShowCurrentWeekMediaBadge,
  formatHistoricalWeekLabel,
  hasPreseasonMediaModes,
  historicalOptInCopy,
  isCurrentMedia,
  isHistoricalAvailable,
  isOlderMediaMode,
  isPreseasonMediaMode,
  mediaContextState,
  mediaModeLabel,
  mergeMediaMetaFields,
  modesAvailable,
  normalizeMediaMode,
  pickHistoricalWeek,
  setIncludeHistoricalParam,
  setMediaModeParam,
  shouldShowPreseasonMediaModeToggle,
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

test("normalizeMediaMode accepts SCORE-34 modes only", () => {
  assert.equal(normalizeMediaMode("outlook"), MEDIA_MODE.OUTLOOK);
  assert.equal(normalizeMediaMode("WEEK1_PULSE"), MEDIA_MODE.WEEK1_PULSE);
  assert.equal(normalizeMediaMode("older"), MEDIA_MODE.OLDER);
  assert.equal(normalizeMediaMode("nope"), null);
  assert.equal(normalizeMediaMode(null), null);
  assert.equal(isPreseasonMediaMode("outlook"), true);
  assert.equal(isPreseasonMediaMode("older"), false);
  assert.equal(isOlderMediaMode("older"), true);
  assert.equal(mediaModeLabel("week1_pulse"), "Week 1 pulse");
});

test("modesAvailable and hasPreseasonMediaModes read flags", () => {
  assert.deepEqual(modesAvailable(null), {
    outlook: false,
    week1_pulse: false,
    older: false,
  });
  const media = {
    modes_available: { outlook: true, week1_pulse: false, older: true },
  };
  assert.equal(hasPreseasonMediaModes(media), true);
  assert.equal(
    hasPreseasonMediaModes({ modes_available: { older: true } }),
    false,
  );
});

test("shouldShowPreseasonMediaModeToggle includes Week 1 even without buckets", () => {
  assert.equal(
    shouldShowPreseasonMediaModeToggle({
      media: { modes_available: { older: true } },
      week: 1,
    }),
    true,
  );
  assert.equal(
    shouldShowPreseasonMediaModeToggle({
      media: { modes_available: { older: true } },
      week: 5,
    }),
    false,
  );
  assert.equal(
    shouldShowPreseasonMediaModeToggle({
      media: { modes_available: { outlook: true } },
      week: 5,
    }),
    true,
  );
});

test("setMediaModeParam and applyMediaQueryParams prefer media_mode", () => {
  const params = new URLSearchParams();
  setMediaModeParam(params, "outlook");
  assert.equal(params.get("media_mode"), "outlook");
  assert.equal(params.has("include_historical"), false);

  setMediaModeParam(params, "older");
  assert.equal(params.get("media_mode"), "older");
  assert.equal(params.get("include_historical"), "true");

  setMediaModeParam(params, null);
  assert.equal(params.has("media_mode"), false);

  const p2 = new URLSearchParams();
  applyMediaQueryParams(p2, { includeHistorical: true });
  assert.equal(p2.get("media_mode"), "older");
  assert.equal(p2.get("include_historical"), "true");

  const p3 = new URLSearchParams();
  applyMediaQueryParams(p3, { mediaMode: "week1_pulse", includeHistorical: true });
  assert.equal(p3.get("media_mode"), "week1_pulse");
  assert.equal(p3.has("include_historical"), false);
});
