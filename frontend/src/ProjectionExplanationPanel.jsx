import React, { useEffect, useState } from "react";
import Chip, { sentimentChipTone } from "./Chip";
import { apiFetch } from "./auth";
import { connectionErrorMessage, parseApiError } from "./format";
import { isAbortError } from "./fetchAbort";
import HistoricalMediaOptIn from "./HistoricalMediaOptIn";
import {
  formatHistoricalWeekLabel,
  isHistoricalAvailable,
  pickHistoricalWeek,
  setIncludeHistoricalParam,
} from "./mediaContext";

function directionGlyph(direction) {
  if (direction === "up") return "↑";
  if (direction === "down") return "↓";
  return "·";
}

function SignalRow({ signal }) {
  const dir = signal?.direction || "neutral";
  return (
    <li
      className={`projection-explanation-signal projection-explanation-signal--${dir} projection-explanation-signal--${signal?.strength || "low"}`}
    >
      <span className="projection-explanation-signal-dir" aria-hidden="true">
        {directionGlyph(dir)}
      </span>
      <div className="projection-explanation-signal-body">
        <span className="projection-explanation-signal-label">{signal.label}</span>
        {signal.detail ? (
          <p className="projection-explanation-signal-detail">{signal.detail}</p>
        ) : null}
      </div>
      <span className="sr-only">
        {dir === "up" ? "Positive" : dir === "down" ? "Negative" : "Neutral"} signal
      </span>
    </li>
  );
}

/**
 * Structured "Why this projection?" panel — GET /api/player/{id}/explanation (SCORE-5).
 * Model signals and narrative/sentiment overlay are visually separated.
 * SCORE-28: historical narrative requires explicit opt-in.
 */
export default function ProjectionExplanationPanel({
  playerId,
  season,
  week,
  position,
  applyInjuryAdjustments = true,
  active = true,
  className = "",
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [includeHistorical, setIncludeHistorical] = useState(false);

  useEffect(() => {
    setIncludeHistorical(false);
  }, [playerId, season, week]);

  useEffect(() => {
    if (!active || !playerId) {
      setData(null);
      setError("");
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setLoading(true);
    setError("");

    const params = new URLSearchParams();
    if (season != null) params.set("season", String(season));
    if (week != null) params.set("week", String(week));
    if (position) params.set("position", String(position));
    params.set("apply_injury_adjustments", applyInjuryAdjustments ? "true" : "false");
    setIncludeHistoricalParam(params, includeHistorical);
    const q = params.toString() ? `?${params.toString()}` : "";

    (async () => {
      try {
        const res = await apiFetch(
          `/api/player/${encodeURIComponent(playerId)}/explanation${q}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          throw new Error(await parseApiError(res, "Failed to load projection explanation"));
        }
        setData(await res.json());
      } catch (err) {
        if (isAbortError(err)) return;
        setData(null);
        setError(connectionErrorMessage(err, "Failed to load projection explanation"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [active, playerId, season, week, position, applyInjuryAdjustments, includeHistorical]);

  if (!active || !playerId) return null;

  const signals = data?.projection_signals || [];
  const narrative = data?.narrative_context;
  const movement = data?.movement;
  const narrativeAvailable = Boolean(narrative?.available);
  const media = narrative?.media_context;
  const historical = pickHistoricalWeek(media);
  const historicalLabel = formatHistoricalWeekLabel(historical);
  const showHistoricalOptIn =
    !narrativeAvailable && isHistoricalAvailable(media) && !includeHistorical;

  return (
    <section
      className={`projection-explanation ${className}`.trim()}
      aria-label="Why this projection"
    >
      <header className="projection-explanation-head">
        <h3 className="projection-explanation-title">Why this projection?</h3>
        {data?.note ? (
          <p className="projection-explanation-note muted">{data.note}</p>
        ) : null}
      </header>

      {loading && !data ? (
        <p className="chart-note" role="status">
          Loading explanation…
        </p>
      ) : null}

      {error ? <div className="error">{error}</div> : null}

      {data ? (
        <>
          <div className="projection-explanation-block projection-explanation-block--signals">
            <h4 className="projection-explanation-block-title">Projection signals</h4>
            <p className="projection-explanation-block-sub muted">
              From ScoreSense weekly artifacts and usage features
            </p>
            {signals.length ? (
              <ul className="projection-explanation-signal-list">
                {signals.map((signal) => (
                  <SignalRow key={signal.id || signal.label} signal={signal} />
                ))}
              </ul>
            ) : (
              <p className="state-empty-text projection-explanation-empty">
                No standout model-context signals for this slate.
              </p>
            )}
          </div>

          <div className="projection-explanation-block projection-explanation-block--narrative">
            <div className="projection-explanation-narrative-head">
              <h4 className="projection-explanation-block-title">
                {narrative?.label || "Narrative context"}
              </h4>
              <Chip tone="neutral" className="projection-explanation-overlay-chip">
                Context overlay · not a model input
              </Chip>
            </div>
            {narrative?.disclaimer ? (
              <p className="projection-explanation-disclaimer muted">{narrative.disclaimer}</p>
            ) : (
              <p className="projection-explanation-disclaimer muted">
                Sentiment and fantasy media digests are contextual overlays — they are not
                ScoreSense projection drivers.
              </p>
            )}
            {narrativeAvailable ? (
              <div className="projection-explanation-narrative-body">
                {narrative.context_fallback || isHistoricalAvailable(media) ? (
                  <p className="sentiment-fallback-banner" role="status">
                    Older commentary
                    {historicalLabel || (narrative.season != null && narrative.week != null)
                      ? ` from ${historicalLabel || `${narrative.season} Week ${narrative.week}`}`
                      : ""}
                    {" — not current-week coverage."}
                  </p>
                ) : null}
                {narrative.sentiment_label ? (
                  <Chip
                    tone={sentimentChipTone(narrative.sentiment_label)}
                    className="projection-explanation-sentiment-chip"
                  >
                    {narrative.sentiment_label_text
                      || narrative.sentiment_label
                      || "Neutral"}
                    {Number.isFinite(Number(narrative.mention_count))
                      ? ` · ${narrative.mention_count}m`
                      : ""}
                  </Chip>
                ) : null}
                <p className="projection-explanation-digest">
                  {narrative.digest
                    || narrative.sentiment_summary
                    || narrative.snippet
                    || "Narrative available but no digest text."}
                </p>
              </div>
            ) : showHistoricalOptIn ? (
              <HistoricalMediaOptIn
                requestedWeek={week}
                media={media}
                loading={loading}
                onViewOlder={() => setIncludeHistorical(true)}
              />
            ) : (
              <p className="state-empty-text projection-explanation-empty">
                No narrative context for this player yet.
              </p>
            )}
          </div>

          {movement?.available ? (
            <div className="projection-explanation-block projection-explanation-block--movement">
              <h4 className="projection-explanation-block-title">Projection movement</h4>
              <p className="projection-explanation-digest">
                {movement.delta_p50 != null
                  ? `Median moved ${Number(movement.delta_p50) > 0 ? "+" : ""}${Number(movement.delta_p50).toFixed(1)} vs prior.`
                  : movement.note || "Movement available."}
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
