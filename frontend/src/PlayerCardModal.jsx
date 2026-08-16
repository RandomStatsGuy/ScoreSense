import React, { useEffect, useState } from "react";
import { apiFetch } from "./auth";
import { isAbortError } from "./fetchAbort";
import Chip, { injuryChipTone } from "./Chip";
import PlayerCell from "./PlayerCell";
import SentimentBadge from "./SentimentBadge";
import ProjectionExplanationPanel from "./ProjectionExplanationPanel";
import PlayerContextPanel from "./PlayerContextPanel";
import QuantileBar from "./QuantileBarShared";
import { connectionErrorMessage, parseApiError } from "./format";
import useMobileLayout from "./useMobileLayout";
import MobileBottomSheet from "./layout/MobileBottomSheet";
import {
  formatSeasonPts,
  resolveSeasonBand,
  seasonRangeTooltip,
} from "./seasonQuantiles";
import {
  formatOpportunityAdjustmentPct,
  pickOpportunityAdjustment,
} from "./opportunityAdjustment";

function ProjStat({ label, value, emphasis = false }) {
  return (
    <div className={`player-card-stat${emphasis ? " player-card-stat--primary" : ""}`}>
      <span className="player-card-stat-label">{label}</span>
      <span className="player-card-stat-value">{value ?? "—"}</span>
    </div>
  );
}

/**
 * Range bar scaled with headroom so the P10–P90 band renders proportionally
 * (QuantileBar's scaleMax defaults to 1, which pins everything to the right),
 * with floor/ceiling end labels so the bar reads without hovering.
 */
function ScaledRangeBar({ p10, p50, p90, title, subtitle, formatValue }) {
  if (![p10, p50, p90].every(Number.isFinite)) return null;
  const scaleMax = p90 > 0 ? p90 * 1.12 : 1;
  const fmt = formatValue || ((v) => v.toFixed(1));
  return (
    <div className="player-card-range-wrap">
      <div className="player-card-range">
        <span className="player-card-range-label" aria-hidden="true">{fmt(p10)}</span>
        <QuantileBar p10={p10} p50={p50} p90={p90} scaleMax={scaleMax} title={title} subtitle={subtitle} />
        <span className="player-card-range-label" aria-hidden="true">{fmt(p90)}</span>
      </div>
      <div className="range-scale-legend" aria-hidden="true">
        <span>Floor</span>
        <span>Projection</span>
        <span>Ceiling</span>
      </div>
    </div>
  );
}

function contextLabel(meta, request) {
  const season = meta?.season ?? request?.season;
  const week = meta?.week ?? request?.week;
  if (season == null || week == null) return null;
  return `${season} · Wk ${week}`;
}

function PlayerCardBody({ data, loading, error, fallbackName, request }) {
  const [whyOpen, setWhyOpen] = useState(false);
  const explainPlayerId = data?.player_id || request?.playerId || "";
  const applyInjury = request?.applyInjuryAdjustments ?? true;

  useEffect(() => {
    setWhyOpen(false);
  }, [explainPlayerId]);

  const contextPanel = explainPlayerId ? (
    <section className="player-card-section player-card-section--context">
      <PlayerContextPanel
        playerId={explainPlayerId}
        season={request?.season}
        week={request?.week}
        active
        className="player-context-panel--card"
      />
    </section>
  ) : null;

  if (loading) {
    return (
      <>
        <p className="player-card-loading chart-note">Loading player…</p>
        {contextPanel}
      </>
    );
  }
  if (error) {
    return (
      <>
        <div className="error">{error}</div>
        {contextPanel}
      </>
    );
  }
  if (!data) return contextPanel;

  const weekly = data.weekly_projection;
  const season = data.season_projection;
  const narrative = data.narrative;
  const narrativeMeta = data.narrative_meta || {};
  const injury = data.injury;
  const canExplain = Boolean(data.player_id && weekly);
  const weekLabel = contextLabel(data.meta, request);
  const seasonBand = season
    ? resolveSeasonBand({
      ...season,
      season_p10: season["Season P10"] ?? season["Season Floor"] ?? season["Season Low"],
      season_p50: season["Season P50"] ?? season["Season Proj"],
      season_p90: season["Season P90"] ?? season["Season Ceiling"] ?? season["Season High"],
      season_quantile_method: season.season_quantile_method,
    })
    : null;
  const seasonTip = seasonBand
    ? seasonRangeTooltip(seasonBand.method, { preliminary: seasonBand.preliminary })
    : null;
  const weeklyP10 = weekly ? Number(weekly["Low (P10)"]) : null;
  const weeklyP50 = weekly ? Number(weekly["Projected Points"]) : null;
  const weeklyP90 = weekly ? Number(weekly["High (P90)"]) : null;
  const narrativeFallback = Boolean(narrativeMeta.context_fallback);
  const narrativeShown =
    narrativeMeta.season != null && narrativeMeta.week != null
      ? `${narrativeMeta.season} · W${narrativeMeta.week}`
      : null;
  const narrativeRequested =
    narrativeMeta.requested_season != null && narrativeMeta.requested_week != null
      ? `${narrativeMeta.requested_season} · W${narrativeMeta.requested_week}`
      : weekLabel;

  return (
    <div className="player-card-body">
      <div className="player-card-head">
        <PlayerCell
          name={data.player_name || fallbackName}
          team={data.team}
          playerId={data.player_id}
          media={data.media ? { [data.player_id]: data.media } : null}
          size="lg"
        />
        {injury?.injury_status ? (
          <Chip tone={injuryChipTone(injury.injury_status)}>{injury.injury_status}</Chip>
        ) : null}
      </div>
      {weekLabel ? (
        <p className="player-card-context muted" role="status">
          {weekLabel}
          {data.meta?.apply_injury_adjustments === false || !applyInjury
            ? " · base projections (no live opportunity adjustments)"
            : " · live injury adjustments"}
        </p>
      ) : null}

      {weekly ? (
        <section className="player-card-section">
          <h3>Weekly projection{weekLabel ? ` · ${weekLabel}` : ""}</h3>
          <div className="player-card-stats">
            <ProjStat label="Proj" value={Number(weekly["Projected Points"]).toFixed(1)} emphasis />
            <ProjStat label="Floor" value={Number(weekly["Low (P10)"]).toFixed(1)} />
            <ProjStat label="Ceiling" value={Number(weekly["High (P90)"]).toFixed(1)} />
            {pickOpportunityAdjustment(weekly) ? (
              <ProjStat
                label="Opportunity adjustment"
                value={formatOpportunityAdjustmentPct(weekly)}
              />
            ) : null}
          </div>
          <ScaledRangeBar
            p10={weeklyP10}
            p50={weeklyP50}
            p90={weeklyP90}
            title="Per-game scoring range"
          />
        </section>
      ) : null}

      {season ? (
        <section className="player-card-section">
          <h3>Season outlook</h3>
          <div className="player-card-stats">
            <ProjStat
              label="Season P50"
              value={formatSeasonPts(seasonBand?.p50 ?? season["Season Proj"] ?? season["Season P50"], 1)}
              emphasis
            />
            <ProjStat
              label="Floor"
              value={seasonBand?.p10 != null ? formatSeasonPts(seasonBand.p10, 1) : "—"}
            />
            <ProjStat
              label="Ceiling"
              value={seasonBand?.p90 != null ? formatSeasonPts(seasonBand.p90, 1) : "—"}
            />
            <ProjStat
              label="ROS"
              value={Number(season["ROS Proj"] ?? season["ROS P50"]).toFixed(1)}
            />
          </div>
          {seasonBand?.p10 != null && seasonBand?.p50 != null && seasonBand?.p90 != null ? (
            <div className="player-card-uncertainty">
              <div className="player-card-uncertainty-label">
                Season total
                {seasonBand.preliminary ? (
                  <span className="season-range-prelim-note" title={seasonTip}>
                    Preseason estimate
                  </span>
                ) : null}
              </div>
              <ScaledRangeBar
                p10={seasonBand.p10}
                p50={seasonBand.p50}
                p90={seasonBand.p90}
                title={seasonTip}
                subtitle={`${formatSeasonPts(seasonBand.p10, 1)} · ${formatSeasonPts(seasonBand.p50, 1)} · ${formatSeasonPts(seasonBand.p90, 1)}`}
                formatValue={(v) => formatSeasonPts(v, 0)}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      {contextPanel}

      <section className="player-card-section">
        <h3>Analyst context</h3>
        {narrativeFallback && narrativeShown ? (
          <div className="sentiment-fallback-banner player-card-narrative-fallback" role="status">
            Historical context from <strong>{narrativeShown}</strong>
            {narrativeRequested && narrativeRequested !== narrativeShown
              ? ` (none for ${narrativeRequested})`
              : ""}
            .
          </div>
        ) : null}
        {narrative ? (
          <>
            <div className="player-card-narrative-head">
              <SentimentBadge sentiment={narrative} compact />
            </div>
            <p className="player-card-narrative">
              {narrative.fantasy_digest || narrative.beat_digest || narrative.snippet || "—"}
            </p>
          </>
        ) : (
          <p className="state-empty-text player-card-empty">
            {narrativeFallback
              ? "No matching-week analyst context for this player."
              : "No analyst context for this player yet."}
          </p>
        )}
      </section>

      {canExplain ? (
        <section className="player-card-section player-card-section--why">
          <button
            type="button"
            className={`btn-ghost btn-sm why-toggle${whyOpen ? " why-toggle--open" : ""}`}
            onClick={() => setWhyOpen((v) => !v)}
            aria-expanded={whyOpen}
          >
            Why this projection?
          </button>
          {whyOpen ? (
            <ProjectionExplanationPanel
              playerId={data.player_id}
              season={request?.season}
              week={request?.week}
              position={request?.position || data.position}
              applyInjuryAdjustments={applyInjury}
              active
              className="projection-explanation--card"
            />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export default function PlayerCardModal({ request, onClose }) {
  const mobileLayout = useMobileLayout();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Escape closes the desktop dialog (the mobile sheet handles its own).
  useEffect(() => {
    if (!request || mobileLayout) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [request, mobileLayout, onClose]);

  useEffect(() => {
    if (!request?.playerId) {
      setData(null);
      setError("");
      return undefined;
    }
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (request.season != null) params.set("season", String(request.season));
        if (request.week != null) params.set("week", String(request.week));
        if (request.scope) params.set("scope", request.scope);
        if (request.position) params.set("position", request.position);
        const applyInjury = request.applyInjuryAdjustments ?? true;
        params.set("apply_injury_adjustments", applyInjury ? "true" : "false");
        const q = params.toString() ? `?${params.toString()}` : "";
        const res = await apiFetch(
          `/api/player/${encodeURIComponent(request.playerId)}/card${q}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error(await parseApiError(res, "Failed to load player card"));
        setData(await res.json());
      } catch (err) {
        if (isAbortError(err)) return;
        setData(null);
        setError(connectionErrorMessage(err, "Failed to load player card"));
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [request]);

  if (!request) return null;

  const title = data?.player_name || request.playerName || "Player";
  const body = (
    <PlayerCardBody
      data={data}
      loading={loading}
      error={error}
      fallbackName={request.playerName}
      request={request}
    />
  );

  if (mobileLayout) {
    return (
      <MobileBottomSheet open onClose={onClose} title={title} className="player-card-sheet">
        {body}
      </MobileBottomSheet>
    );
  }

  return (
    <div className="player-card-overlay" role="presentation" onClick={onClose}>
      <div
        className="player-card-dialog panel"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Player identity in the body doubles as the dialog heading. */}
        <button type="button" className="btn-ghost player-card-close" onClick={onClose} aria-label="Close">
          Close
        </button>
        {loading && !data ? <h2 className="player-card-dialog-title">{title}</h2> : null}
        {body}
      </div>
    </div>
  );
}
