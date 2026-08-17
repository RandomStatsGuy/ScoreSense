/**
 * SCORE-28 — media_context states and historical opt-in helpers.
 * SCORE-34 — preseason media modes: outlook | week1_pulse | older.
 *
 * Backend states: current | historical_available | none
 * Historical narrative is never treated as current-week without include_historical=true
 * or media_mode=older.
 *
 * Preseason modes are cheap/cached — UI requests them via media_mode=; never implies
 * older commentary is current.
 */

export const MEDIA_STATE = {
  CURRENT: "current",
  HISTORICAL_AVAILABLE: "historical_available",
  NONE: "none",
};

/** SCORE-34 explicit media mode selectors (query: media_mode=). */
export const MEDIA_MODE = {
  OUTLOOK: "outlook",
  WEEK1_PULSE: "week1_pulse",
  OLDER: "older",
};

export const MEDIA_MODE_LABELS = {
  [MEDIA_MODE.OUTLOOK]: "Preseason outlook",
  [MEDIA_MODE.WEEK1_PULSE]: "Week 1 pulse",
  [MEDIA_MODE.OLDER]: "Older commentary",
};

/** Short control labels for the preseason mode toggle. */
export const MEDIA_MODE_SHORT_LABELS = {
  [MEDIA_MODE.OUTLOOK]: "Outlook",
  [MEDIA_MODE.WEEK1_PULSE]: "Week 1 pulse",
  [MEDIA_MODE.OLDER]: "Older",
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

/** Normalize API media_mode; unknown values → null. */
export function normalizeMediaMode(mode) {
  const cleaned = String(mode || "").trim().toLowerCase();
  if (
    cleaned === MEDIA_MODE.OUTLOOK
    || cleaned === MEDIA_MODE.WEEK1_PULSE
    || cleaned === MEDIA_MODE.OLDER
  ) {
    return cleaned;
  }
  return null;
}

export function mediaModeLabel(mode) {
  const normalized = normalizeMediaMode(mode);
  return normalized ? MEDIA_MODE_LABELS[normalized] : null;
}

export function isPreseasonMediaMode(mode) {
  const normalized = normalizeMediaMode(mode);
  return (
    normalized === MEDIA_MODE.OUTLOOK
    || normalized === MEDIA_MODE.WEEK1_PULSE
  );
}

export function isOlderMediaMode(mode) {
  return normalizeMediaMode(mode) === MEDIA_MODE.OLDER;
}

/**
 * Parse media_context.modes_available flags from a payload fragment.
 */
export function modesAvailable(media) {
  const flags = media?.modes_available;
  if (!flags || typeof flags !== "object") {
    return {
      [MEDIA_MODE.OUTLOOK]: false,
      [MEDIA_MODE.WEEK1_PULSE]: false,
      [MEDIA_MODE.OLDER]: false,
    };
  }
  return {
    [MEDIA_MODE.OUTLOOK]: Boolean(flags[MEDIA_MODE.OUTLOOK]),
    [MEDIA_MODE.WEEK1_PULSE]: Boolean(flags[MEDIA_MODE.WEEK1_PULSE]),
    [MEDIA_MODE.OLDER]: Boolean(flags[MEDIA_MODE.OLDER]),
  };
}

/** True when UI should offer Outlook / Week 1 pulse selectors. */
export function hasPreseasonMediaModes(media) {
  const flags = modesAvailable(media);
  return flags[MEDIA_MODE.OUTLOOK] || flags[MEDIA_MODE.WEEK1_PULSE];
}

/**
 * Show the preseason mode toggle when cached mode buckets exist, or on Week 1
 * so callers can still request outlook / week1_pulse explicitly (SCORE-34 AC).
 */
export function shouldShowPreseasonMediaModeToggle({ media = null, week = null } = {}) {
  if (hasPreseasonMediaModes(media)) return true;
  const w = week != null ? Number(week) : null;
  return Number.isFinite(w) && w === 1;
}

/**
 * Append or clear include_historical on URLSearchParams / query object.
 * Prefer applyMediaQueryParams / setMediaModeParam for SCORE-34 callers.
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
 * Set media_mode= on query params. Clears the param when mode is null/unknown.
 * When mode is older, also sets include_historical=true for alias-compatible endpoints.
 * @param {URLSearchParams} params
 * @param {string|null|undefined} mode
 */
export function setMediaModeParam(params, mode) {
  if (!params) return params;
  const normalized = normalizeMediaMode(mode);
  if (!normalized) {
    params.delete("media_mode");
    return params;
  }
  params.set("media_mode", normalized);
  if (normalized === MEDIA_MODE.OLDER) {
    params.set("include_historical", "true");
  } else {
    params.delete("include_historical");
  }
  return params;
}

/**
 * Apply SCORE-34 media query selection.
 * mediaMode wins; includeHistorical alone maps to media_mode=older.
 */
export function applyMediaQueryParams(
  params,
  { mediaMode = null, includeHistorical = false } = {},
) {
  if (!params) return params;
  const resolved =
    normalizeMediaMode(mediaMode)
    || (includeHistorical ? MEDIA_MODE.OLDER : null);
  if (!resolved) {
    params.delete("media_mode");
    params.delete("include_historical");
    return params;
  }
  return setMediaModeParam(params, resolved);
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
