import React, { useEffect, useState } from "react";
import { apiFetch } from "./auth";
import { isAbortError } from "./fetchAbort";
import Chip, { injuryChipTone } from "./Chip";
import PlayerCell from "./PlayerCell";
import SentimentBadge from "./SentimentBadge";
import QuantileBar from "./QuantileBarShared";
import { connectionErrorMessage, parseApiError } from "./format";
import useMobileLayout from "./useMobileLayout";
import MobileBottomSheet from "./layout/MobileBottomSheet";
import {
  formatSeasonPts,
  resolveSeasonBand,
  seasonRangeTooltip,
} from "./seasonQuantiles";

function ProjStat({ label, value }) {
  return (
    <div className="player-card-stat">
      <span className="player-card-stat-label">{label}</span>
      <span className="player-card-stat-value">{value ?? "—"}</span>
    </div>
  );
}

function PlayerCardBody({ data, loading, error, fallbackName }) {
  if (loading) {
    return <p className="player-card-loading chart-note">Loading player…</p>;
  }
  if (error) {
    return <div className="error">{error}</div>;
  }
  if (!data) return null;

  const weekly = data.weekly_projection;
  const season = data.season_projection;
  const narrative = data.narrative;
  const injury = data.injury;
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
  const hasWeeklyBar = [weeklyP10, weeklyP50, weeklyP90].every(Number.isFinite);

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

      {weekly ? (
        <section className="player-card-section">
          <h3>Weekly projection</h3>
          <div className="player-card-stats">
            <ProjStat label="Proj" value={Number(weekly["Projected Points"]).toFixed(1)} />
            <ProjStat label="Floor" value={Number(weekly["Low (P10)"]).toFixed(1)} />
            <ProjStat label="Ceiling" value={Number(weekly["High (P90)"]).toFixed(1)} />
            {weekly["Injury Boost"] ? (
              <ProjStat
                label="Injury boost"
                value={`+${(Number(weekly["Injury Boost"]) * 100).toFixed(0)}%`}
              />
            ) : null}
          </div>
          {hasWeeklyBar ? (
            <QuantileBar
              p10={weeklyP10}
              p50={weeklyP50}
              p90={weeklyP90}
              title="Per-game scoring range"
            />
          ) : null}
        </section>
      ) : null}

      {season ? (
        <section className="player-card-section">
          <h3>Season outlook</h3>
          <div className="player-card-stats">
            <ProjStat
              label="Season P50"
              value={formatSeasonPts(seasonBand?.p50 ?? season["Season Proj"] ?? season["Season P50"], 1)}
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
                  <span className="hub-sleeper-badge season-range-prelim-badge">Preliminary</span>
                ) : null}
              </div>
              <QuantileBar
                p10={seasonBand.p10}
                p50={seasonBand.p50}
                p90={seasonBand.p90}
                title={seasonTip}
                subtitle={`${formatSeasonPts(seasonBand.p10, 1)} · ${formatSeasonPts(seasonBand.p50, 1)} · ${formatSeasonPts(seasonBand.p90, 1)}`}
              />
              {hasWeeklyBar ? (
                <>
                  <div className="player-card-uncertainty-label player-card-uncertainty-label--secondary">
                    Per-game (week volatility)
                  </div>
                  <QuantileBar
                    p10={weeklyP10}
                    p50={weeklyP50}
                    p90={weeklyP90}
                    title="Per-game scoring range"
                    subtitle="Week volatility vs season compression above"
                  />
                </>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="player-card-section">
        <h3>Analyst context</h3>
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
          <p className="state-empty-text player-card-empty">No analyst context for this player yet.</p>
        )}
      </section>
    </div>
  );
}

export default function PlayerCardModal({ request, onClose }) {
  const mobileLayout = useMobileLayout();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
        <div className="player-card-dialog-head">
          <h2>{title}</h2>
          <button type="button" className="btn-ghost player-card-close" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
        {body}
      </div>
    </div>
  );
}
