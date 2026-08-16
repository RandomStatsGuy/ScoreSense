/**
 * SCORE-28 — media_context states and historical opt-in helpers.
 *
 * Backend states: current | historical_available | none
 * Historical narrative is never treated as current-week without include_historical=true.
 */

export const MEDIA_STATE = {
  CURRENT: "current",
  HISTORICAL_AVAILABLE: "historical_available",
  NONE: "none",
};

export const VIEW_OLDER_COMMENTARY_LABEL = "View older commentary";

/** Normalize media_context.state from a payload fragment. */
export function mediaContextState(media) {
  const raw = media?.state != null ? String(media.state) : MEDIA_STATE.NONE;
  if (
    raw === MEDIA_STATE.CURRENT
    || raw === MEDIA_STATE.HISTORICAL_AVAILABLE
    || raw === MEDIA_STATE.NONE
  ) {
    return raw;
  }
  return MEDIA_STATE.NONE;
}

export function isCurrentMedia(media) {
  return mediaContextState(media) === MEDIA_STATE.CURRENT;
}

export function isHistoricalAvailable(media) {
  return mediaContextState(media) === MEDIA_STATE.HISTORICAL_AVAILABLE;
}

/** Nested historical {season, week} when older coverage exists. */
export function pickHistoricalWeek(media) {
  const hist = media?.historical;
  if (!hist || typeof hist !== "object") return null;
  const season = hist.season != null ? Number(hist.season) : null;
  const week = hist.week != null ? Number(hist.week) : null;
  if (!Number.isFinite(season) || !Number.isFinite(week)) return null;
  return { season, week };
}

export function formatHistoricalWeekLabel(historical) {
  if (!historical) return null;
  const season = historical.season ?? historical?.season;
  const week = historical.week ?? historical?.week;
  if (season == null || week == null) return null;
  return `${season} Week ${week}`;
}

/**
 * Copy for empty current-week media when older coverage exists.
 * Matches ticket UI example.
 */
export function historicalOptInCopy({ requestedWeek, historical } = {}) {
  const weekPart =
    requestedWeek != null && Number.isFinite(Number(requestedWeek))
      ? ` Week ${Number(requestedWeek)}`
      : "";
  const histLabel = formatHistoricalWeekLabel(historical);
  const lines = [`No current${weekPart} media coverage.`];
  if (histLabel) {
    lines.push(`Older discussion is available from ${histLabel}.`);
  }
  return lines.join(" ");
}

/** True only for current-week media signal badges (never historical). */
export function canShowCurrentWeekMediaBadge(media) {
  return isCurrentMedia(media) && Boolean(media?.signal);
}

/**
 * Append or clear include_historical on URLSearchParams / query object.
 * @param {URLSearchParams} params
 * @param {boolean} include
 */
export function setIncludeHistoricalParam(params, include) {
  if (!params) return params;
  if (include) params.set("include_historical", "true");
  else params.delete("include_historical");
  return params;
}

/**
 * Merge list/narrative API top-level media fields into panel meta.
 */
export function mergeMediaMetaFields(data) {
  if (!data) return null;
  return {
    media_context: data.media_context || null,
    context_fallback: Boolean(data.context_fallback),
    requested_season: data.requested_season,
    requested_week: data.requested_week,
    season: data.season,
    week: data.week,
  };
}
