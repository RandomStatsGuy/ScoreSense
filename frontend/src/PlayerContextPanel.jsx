import React, { useEffect, useState } from "react";
import Chip, { injuryChipTone } from "./Chip";
import { apiFetch } from "./auth";
import { isAbortError } from "./fetchAbort";
import { connectionErrorMessage, formatRelativeTime, parseApiError } from "./format";
import HistoricalMediaOptIn from "./HistoricalMediaOptIn";
import PreseasonMediaModeToggle from "./PreseasonMediaModeToggle";
import ProjectionTrustLabel from "./ProjectionTrustLabel";
import {
  canLabelIncludedInProjection,
  formatInjuryAgeHours,
  formatOppPoints,
  formatProjPts,
  mediaSignalLabel,
  mediaSignalTone,
  shouldShowProjectionAssumesActive,
} from "./playerContextDisplay";
import { CONTEXT_COPY } from "./projectionsPresentation";
import {
  MEDIA_MODE,
  applyMediaQueryParams,
  formatHistoricalWeekLabel,
  isCurrentMedia,
  isHistoricalAvailable,
  isOlderMediaMode,
  mediaModeLabel,
  pickHistoricalWeek,
  shouldShowPreseasonMediaModeToggle,
} from "./mediaContext";

function ContextStat({ label, value, emphasis = false, hint }) {
  return (
    <div className={`player-context-stat${emphasis ? " player-context-stat--primary" : ""}`}>
      <span className="player-context-stat-label">{label}</span>
      <span className="player-context-stat-value">{value ?? "—"}</span>
      {hint ? <span className="player-context-stat-hint muted">{hint}</span> : null}
    </div>
  );
}

/**
 * Detail panel for SCORE-23 cached player-context read model.
 * SCORE-24: explicit Included / Commentary / Assumes-active trust labels.
 * SCORE-28: historical media requires View older commentary opt-in.
 * SCORE-30: lazy-loads full detail (excerpts/sources/drivers) via
 * GET /api/player/{id}/context — artifact only (zero live work on expand).
 * SCORE-34: preseason media_mode=outlook|week1_pulse; older stays opt-in.
 */
export default function PlayerContextPanel({
  playerId,
  season,
  week,
  active = true,
  mediaMode: mediaModeProp,
  onMediaModeChange,
  className = "",
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cold, setCold] = useState(false);
  const [mediaModeLocal, setMediaModeLocal] = useState(null);

  const controlled = mediaModeProp !== undefined;
  const mediaMode = controlled ? mediaModeProp ?? null : mediaModeLocal;

  useEffect(() => {
    if (!controlled) setMediaModeLocal(null);
  }, [controlled, playerId, season, week]);

  const setMediaMode = (next) => {
    if (controlled) {
      onMediaModeChange?.(next);
      return;
    }
    setMediaModeLocal(next);
  };

  useEffect(() => {
    if (!active || !playerId) {
      setData(null);
      setError("");
      setCold(false);
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setLoading(true);
    setError("");
    setCold(false);

    const params = new URLSearchParams();
    if (season != null) params.set("season", String(season));
    if (week != null) params.set("week", String(week));
    applyMediaQueryParams(params, { mediaMode });
    const q = params.toString() ? `?${params.toString()}` : "";

    (async () => {
      try {
        const res = await apiFetch(
          `/api/player/${encodeURIComponent(playerId)}/context${q}`,
          { signal: controller.signal },
        );
        if (res.status === 503) {
          const latestParams = new URLSearchParams();
          if (season != null) latestParams.set("season", String(season));
          if (week != null) latestParams.set("week", String(week));
          const latestQ = latestParams.toString() ? `?${latestParams.toString()}` : "";
          const latestRes = await apiFetch(
            `/api/player/${encodeURIComponent(playerId)}/latest${latestQ}`,
            { signal: controller.signal },
          );
          if (latestRes.ok) {
            const latest = await latestRes.json();
            setData({
              this_week: latest.this_week || latest.latest,
              media_context: { state: "none", affects_projection: false },
              meta: latest.meta || {},
            });
            setCold(false);
            setError("");
            return;
          }
          setData(null);
          setCold(true);
          setError("");
          return;
        }
        if (res.status === 404) {
          setData(null);
          setCold(false);
          setError(CONTEXT_COPY.missing);
          return;
        }
        if (!res.ok) {
          throw new Error(await parseApiError(res, "Failed to load player context"));
        }
        setData(await res.json());
        setCold(false);
      } catch (err) {
        if (isAbortError(err)) return;
        setData(null);
        setError(connectionErrorMessage(err, "Failed to load player context"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [active, playerId, season, week, mediaMode]);

  if (!active || !playerId) return null;

  const proj = data?.projection;
  const avail = data?.availability;
  const opp = data?.opportunity_adjustment;
  const media = data?.media_context;
  const meta = data?.meta;
  const weekLabel =
    meta?.season != null && meta?.week != null
      ? `${meta.season} · Wk ${meta.week}`
      : season != null && week != null
        ? `${season} · Wk ${week}`
        : null;
  const deltaLabel = formatOppPoints(proj?.injury_delta);
  const oppPts = formatOppPoints(opp?.points);
  const mediaLabel = mediaSignalLabel(media?.signal);
  const availUpdated = formatRelativeTime(avail?.updated_at);
  const builtAt = formatRelativeTime(meta?.artifact_built_at || meta?.context_built_at);
  const showIncluded = data ? canLabelIncludedInProjection(data) : false;
  const showAssumesActive = data ? shouldShowProjectionAssumesActive(data) : false;
  const historical = pickHistoricalWeek(media);
  const historicalLabel = formatHistoricalWeekLabel(historical);
  const thisWeek = data?.this_week;
  const mediaBody = media?.summary || media?.excerpt;
  const optedIntoOlder = isOlderMediaMode(mediaMode);
  const showCurrentMedia = Boolean(mediaMode) && isCurrentMedia(media) && (mediaLabel || mediaBody);
  const showHistoricalOptIn =
    isHistoricalAvailable(media) && !optedIntoOlder && !mediaBody;
  const showHistoricalContent =
    isHistoricalAvailable(media) && optedIntoOlder && (mediaBody || mediaLabel);
  const modeBannerLabel = mediaModeLabel(media?.mode || mediaMode);
  const showModeToggle = shouldShowPreseasonMediaModeToggle({
    media,
    week: meta?.week ?? week,
  });

  function renderMediaBody(bodyMedia, { emptyNote = "Signal present; no digest summary." } = {}) {
    const label = mediaSignalLabel(bodyMedia?.signal);
    const summary = bodyMedia?.summary;
    const excerpt = bodyMedia?.excerpt;
    const sources = Array.isArray(bodyMedia?.sources) ? bodyMedia.sources : [];
    const updated = formatRelativeTime(bodyMedia?.updated_at);
    return (
      <div className="player-context-media-body">
        {label ? (
          <Chip tone={mediaSignalTone(bodyMedia.signal)}>
            {label}
            {Number(bodyMedia.source_count) > 0
              ? ` · ${bodyMedia.source_count} source${bodyMedia.source_count === 1 ? "" : "s"}`
              : ""}
          </Chip>
        ) : null}
        {summary ? (
          <p className="player-context-media-summary">{summary}</p>
        ) : null}
        {excerpt && excerpt !== summary ? (
          <p className="player-context-media-excerpt">{excerpt}</p>
        ) : null}
        {!summary && !excerpt ? (
          <p className="chart-note">{emptyNote}</p>
        ) : null}
        {sources.length ? (
          <ul className="player-context-media-sources" aria-label="Media sources">
            {sources.slice(0, 6).map((src, i) => {
              const text = src?.label || src?.network_label || src?.network || "Source";
              return (
                <li key={`${text}-${i}`}>
                  <Chip tone="neutral" className="player-context-source-chip">
                    {text}
                  </Chip>
                </li>
              );
            })}
          </ul>
        ) : null}
        {updated ? <p className="chart-note">{updated}</p> : null}
      </div>
    );
  }

  return (
    <section
      className={`player-context-panel ${className}`.trim()}
      aria-label={CONTEXT_COPY.title}
    >
      <header className="player-context-panel-head">
        <div className="player-context-panel-title-row">
          <h3 className="player-context-panel-title">{CONTEXT_COPY.title}</h3>
          {weekLabel ? (
            <span className="player-context-panel-week muted">{weekLabel}</span>
          ) : null}
        </div>
        <p className="player-context-panel-sub muted">
          {CONTEXT_COPY.support}
        </p>
        {meta?.stale ? (
          <p className="player-context-stale-banner" role="status">
            Snapshot may be stale relative to newer weekly inputs.
          </p>
        ) : null}
        {builtAt ? (
          <p className="player-context-built muted" role="status">
            {builtAt}
            {meta?.injury_snapshot_id
              ? ` · snap ${String(meta.injury_snapshot_id).slice(0, 18)}`
              : ""}
          </p>
        ) : null}
      </header>

      {loading && !data ? (
        <p className="chart-note" role="status">
          {CONTEXT_COPY.loading}
        </p>
      ) : null}

      {cold ? (
        <p className="state-empty-text player-context-empty" role="status">
          {CONTEXT_COPY.cold}
        </p>
      ) : null}

      {error ? <div className="error">{error}</div> : null}

      {data ? (
        <div className="player-context-grid">
          <div className="player-context-block">
            <h4 className="player-context-block-title">{CONTEXT_COPY.title}</h4>
            {thisWeek?.headline || thisWeek?.detail || thisWeek?.projection_line ? (
              <div className="player-context-this-week">
                {thisWeek.headline ? (
                  <p className="player-context-media-news-head">{thisWeek.headline}</p>
                ) : null}
                {thisWeek.detail ? (
                  <p className="player-context-media-summary">{thisWeek.detail}</p>
                ) : null}
                {thisWeek.projection_line ? (
                  <p className="player-context-stat-hint">{thisWeek.projection_line}</p>
                ) : null}
                {thisWeek.source ? (
                  <p className="chart-note">{thisWeek.source}</p>
                ) : null}
              </div>
            ) : (
              <p className="state-empty-text player-context-empty">{CONTEXT_COPY.empty}</p>
            )}
          </div>

          {proj ? (
          <div className="player-context-block">
            <h4 className="player-context-block-title">Projection</h4>
            <div className="player-context-stats">
              <ContextStat label="Base" value={formatProjPts(proj?.base)} />
              <ContextStat
                label="Final"
                value={formatProjPts(proj?.final)}
                emphasis
                hint={deltaLabel ? `${deltaLabel} vs base` : null}
              />
              <ContextStat
                label="Injury Δ"
                value={deltaLabel || "0.0"}
              />
            </div>
          </div>
          ) : null}

          {avail ? (
          <div className="player-context-block">
            <h4 className="player-context-block-title">Availability</h4>
            {avail?.status || avail?.practice ? (
              <div className="player-context-avail-stack">
                <div className="player-context-avail-row">
                  {avail.status ? (
                    <Chip tone={injuryChipTone(avail.status)}>{avail.status}</Chip>
                  ) : (
                    <span className="muted">No designation</span>
                  )}
                  {avail.practice ? (
                    <span className="player-context-practice muted">
                      Practice: {avail.practice}
                    </span>
                  ) : null}
                </div>
                {showAssumesActive ? (
                  <ProjectionTrustLabel kind="assumes_active" />
                ) : null}
              </div>
            ) : (
              <p className="state-empty-text player-context-empty">No availability flags.</p>
            )}
            {availUpdated ? (
              <p className="chart-note">
                {availUpdated}
                {formatInjuryAgeHours(avail?.age_hours)
                  ? ` · ${formatInjuryAgeHours(avail.age_hours)} old`
                  : ""}
              </p>
            ) : formatInjuryAgeHours(avail?.age_hours) ? (
              <p className="chart-note">{formatInjuryAgeHours(avail.age_hours)} old</p>
            ) : null}
          </div>
          ) : null}

          {opp ? (
          <div className="player-context-block">
            <h4 className="player-context-block-title">Opportunity</h4>
            {opp?.included ? (
              <div className="player-context-opp-stack">
                <div className="player-context-stats">
                  <ContextStat
                    label="Adj"
                    value={oppPts || "—"}
                    emphasis
                    hint={oppPts ? "opportunity adjustment" : null}
                  />
                </div>
                {showIncluded ? (
                  <ProjectionTrustLabel kind="included" />
                ) : null}
                {Array.isArray(opp.drivers) && opp.drivers.length ? (
                  <p className="player-context-drivers">
                    Drivers:{" "}
                    {opp.drivers.slice(0, 4).map((d, i) => (
                      <Chip key={`${d}-${i}`} tone="neutral" className="player-context-driver-chip">
                        {d}
                      </Chip>
                    ))}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="state-empty-text player-context-empty">
                No opportunity adjustment this week.
              </p>
            )}
          </div>
          ) : null}

          <div className="player-context-block player-context-block--media">
            <div className="player-context-media-head">
              <h4 className="player-context-block-title">{CONTEXT_COPY.media}</h4>
              {showCurrentMedia || showHistoricalContent ? (
                <ProjectionTrustLabel kind="commentary" />
              ) : null}
              {showModeToggle ? (
                <div className="player-context-media-mode-row">
                  <PreseasonMediaModeToggle
                    value={mediaMode}
                    media={media}
                    week={meta?.week ?? week}
                    disabled={loading}
                    onChange={(mode) => setMediaMode(mode)}
                  />
                  {modeBannerLabel && !isOlderMediaMode(mediaMode) ? (
                    <span className="player-context-media-mode-label muted">
                      {modeBannerLabel}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            {showCurrentMedia ? (
              renderMediaBody(media)
            ) : showHistoricalOptIn ? (
              <HistoricalMediaOptIn
                requestedWeek={meta?.week ?? week}
                media={media}
                loading={loading}
                onViewOlder={() => setMediaMode(MEDIA_MODE.OLDER)}
              />
            ) : showHistoricalContent ? (
              <>
                {historicalLabel ? (
                  <p className="sentiment-fallback-banner player-context-historical-banner" role="status">
                    Older commentary from <strong>{historicalLabel}</strong>
                    {" — not current-week coverage."}
                  </p>
                ) : null}
                {renderMediaBody(media, {
                  emptyNote: "Older coverage present; no digest summary.",
                })}
              </>
            ) : (
              <p className="state-empty-text player-context-empty">
                {CONTEXT_COPY.mediaEmpty}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
