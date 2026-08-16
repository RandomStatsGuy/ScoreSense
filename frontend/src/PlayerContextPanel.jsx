import React, { useEffect, useState } from "react";
import Chip, { injuryChipTone } from "./Chip";
import { apiFetch } from "./auth";
import { isAbortError } from "./fetchAbort";
import { connectionErrorMessage, formatRelativeTime, parseApiError } from "./format";
import HistoricalMediaOptIn from "./HistoricalMediaOptIn";
import ProjectionTrustLabel from "./ProjectionTrustLabel";
import {
  canLabelIncludedInProjection,
  formatOppPoints,
  formatProjPts,
  mediaSignalLabel,
  mediaSignalTone,
  shouldShowProjectionAssumesActive,
} from "./playerContextDisplay";
import {
  formatHistoricalWeekLabel,
  isCurrentMedia,
  isHistoricalAvailable,
  pickHistoricalWeek,
  setIncludeHistoricalParam,
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
 * GET /api/player/{id}/context — artifact only (zero live work on page view).
 */
export default function PlayerContextPanel({
  playerId,
  season,
  week,
  active = true,
  className = "",
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cold, setCold] = useState(false);
  const [includeHistorical, setIncludeHistorical] = useState(false);

  useEffect(() => {
    setIncludeHistorical(false);
  }, [playerId, season, week]);

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
    setIncludeHistoricalParam(params, includeHistorical);
    const q = params.toString() ? `?${params.toString()}` : "";

    (async () => {
      try {
        const res = await apiFetch(
          `/api/player/${encodeURIComponent(playerId)}/context${q}`,
          { signal: controller.signal },
        );
        if (res.status === 503) {
          setData(null);
          setCold(true);
          setError("");
          return;
        }
        if (res.status === 404) {
          setData(null);
          setCold(false);
          setError("No cached context for this player.");
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
  }, [active, playerId, season, week, includeHistorical]);

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
  const mediaUpdated = formatRelativeTime(media?.updated_at);
  const availUpdated = formatRelativeTime(avail?.updated_at);
  const builtAt = formatRelativeTime(meta?.artifact_built_at || meta?.context_built_at);
  const showIncluded = data ? canLabelIncludedInProjection(data) : false;
  const showAssumesActive = data ? shouldShowProjectionAssumesActive(data) : false;
  const historical = pickHistoricalWeek(media);
  const historicalLabel = formatHistoricalWeekLabel(historical);
  const showCurrentMedia = isCurrentMedia(media) && (mediaLabel || media?.summary);
  const showHistoricalOptIn =
    isHistoricalAvailable(media) && !includeHistorical && !media?.summary;
  const showHistoricalContent =
    isHistoricalAvailable(media) && includeHistorical && (media?.summary || mediaLabel);

  return (
    <section
      className={`player-context-panel ${className}`.trim()}
      aria-label="Cached player context"
    >
      <header className="player-context-panel-head">
        <div className="player-context-panel-title-row">
          <h3 className="player-context-panel-title">Week context</h3>
          {weekLabel ? (
            <span className="player-context-panel-week muted">{weekLabel}</span>
          ) : null}
        </div>
        <p className="player-context-panel-sub muted">
          Cached read model — no live YouTube, LLM, or projection recompute
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
          Loading cached context…
        </p>
      ) : null}

      {cold ? (
        <p className="state-empty-text player-context-empty" role="status">
          Context cache is warming for this slate. Projections still load from the weekly sheet.
        </p>
      ) : null}

      {error ? <div className="error">{error}</div> : null}

      {data ? (
        <div className="player-context-grid">
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
              <p className="chart-note">{availUpdated}</p>
            ) : null}
          </div>

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

          <div className="player-context-block player-context-block--media">
            <div className="player-context-media-head">
              <h4 className="player-context-block-title">Media context</h4>
              {showCurrentMedia || showHistoricalContent ? (
                <ProjectionTrustLabel kind="commentary" />
              ) : null}
            </div>
            {showCurrentMedia ? (
              <div className="player-context-media-body">
                {mediaLabel ? (
                  <Chip tone={mediaSignalTone(media.signal)}>
                    {mediaLabel}
                    {Number(media.source_count) > 0
                      ? ` · ${media.source_count} source${media.source_count === 1 ? "" : "s"}`
                      : ""}
                  </Chip>
                ) : null}
                {media.summary ? (
                  <p className="player-context-media-summary">{media.summary}</p>
                ) : (
                  <p className="chart-note">Signal present; no digest summary.</p>
                )}
                {mediaUpdated ? (
                  <p className="chart-note">{mediaUpdated}</p>
                ) : null}
              </div>
            ) : showHistoricalOptIn ? (
              <HistoricalMediaOptIn
                requestedWeek={meta?.week ?? week}
                media={media}
                loading={loading}
                onViewOlder={() => setIncludeHistorical(true)}
              />
            ) : showHistoricalContent ? (
              <div className="player-context-media-body">
                {historicalLabel ? (
                  <p className="sentiment-fallback-banner player-context-historical-banner" role="status">
                    Older commentary from <strong>{historicalLabel}</strong>
                    {" — not current-week coverage."}
                  </p>
                ) : null}
                {mediaLabel ? (
                  <Chip tone={mediaSignalTone(media.signal)}>
                    {mediaLabel}
                    {Number(media.source_count) > 0
                      ? ` · ${media.source_count} source${media.source_count === 1 ? "" : "s"}`
                      : ""}
                  </Chip>
                ) : null}
                {media.summary ? (
                  <p className="player-context-media-summary">{media.summary}</p>
                ) : (
                  <p className="chart-note">Older coverage present; no digest summary.</p>
                )}
                {mediaUpdated ? (
                  <p className="chart-note">{mediaUpdated}</p>
                ) : null}
              </div>
            ) : (
              <p className="state-empty-text player-context-empty">
                No media context for this player yet.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
