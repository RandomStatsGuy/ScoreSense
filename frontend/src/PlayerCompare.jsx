import React, { useEffect, useMemo, useState } from "react";
import Chip from "./Chip";
import PlayerCell, { usePlayerMedia } from "./PlayerCell";
import QuantileBar from "./QuantileBarShared";
import { apiFetch } from "./auth";
import { connectionErrorMessage, fmtNum, parseApiError } from "./format";
import { isAbortError } from "./fetchAbort";

const MAX_COMPARE = 4;
const MIN_COMPARE = 2;

function leaderId(leader) {
  return leader?.player_id || null;
}

function metricClass(playerId, leader, tieBreak = null) {
  if (!leader || leader.player_id !== playerId) return "";
  if (tieBreak && tieBreak !== playerId) return "player-compare-metric--tied";
  return "player-compare-metric--best";
}

function fmtVol(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

/**
 * Start/sit comparison view — consumes GET /api/predict/compare (SCORE-4).
 * Recommendation text is deterministic from the API (no LLM).
 */
export default function PlayerCompare({
  playerIds,
  season,
  week,
  applyInjuryAdjustments = true,
  onClose,
  onClear,
  onRemovePlayer,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const idsKey = useMemo(
    () => (playerIds || []).map(String).filter(Boolean).join(","),
    [playerIds],
  );

  useEffect(() => {
    const ids = idsKey.split(",").filter(Boolean);
    if (ids.length < MIN_COMPARE || ids.length > MAX_COMPARE) {
      setData(null);
      setLoading(false);
      setError(`Select ${MIN_COMPARE}–${MAX_COMPARE} players to compare.`);
      return undefined;
    }

    const controller = new AbortController();
    setLoading(true);
    setError("");

    const params = new URLSearchParams({ ids: idsKey });
    if (season != null) params.set("season", String(season));
    if (week != null) params.set("week", String(week));
    params.set("apply_injury_adjustments", applyInjuryAdjustments ? "true" : "false");

    (async () => {
      try {
        const res = await apiFetch(`/api/predict/compare?${params}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(await parseApiError(res, "Failed to load comparison"));
        const payload = await res.json();
        setData(payload);
      } catch (err) {
        if (isAbortError(err)) return;
        setData(null);
        setError(connectionErrorMessage(err, "Failed to load comparison"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [idsKey, season, week, applyInjuryAdjustments]);

  const players = data?.players || [];
  const comparison = data?.comparison || null;
  const mediaIds = useMemo(() => players.map((p) => p.player_id).filter(Boolean), [players]);
  const playerMedia = usePlayerMedia(mediaIds);

  const scaleMax = useMemo(() => {
    if (!players.length) return 1;
    const maxP90 = Math.max(...players.map((p) => Number(p.p90) || 0));
    return maxP90 > 0 ? maxP90 : 1;
  }, [players]);

  const medianLeader = comparison?.highest_median;
  const floorLeader = comparison?.highest_floor;
  const ceilingLeader = comparison?.highest_ceiling;

  const deltaByOther = useMemo(() => {
    const map = new Map();
    for (const d of comparison?.deltas || []) {
      map.set(d.other_id, d);
    }
    return map;
  }, [comparison]);

  return (
    <section className="panel wide panel-player-compare" aria-labelledby="player-compare-title">
      <div className="panel-head panel-head-mobile-compact player-compare-head">
        <div>
          <h2 id="player-compare-title">Compare players</h2>
          <p className="panel-subtitle">
            Side-by-side weekly Floor / Projection / Ceiling
            {data?.meta?.season != null || season != null
              ? ` · ${data?.meta?.season ?? season}`
              : ""}
            {data?.meta?.week != null || week != null
              ? ` · Wk ${data?.meta?.week ?? week}`
              : ""}
            {applyInjuryAdjustments === false ? " · base projections" : " · live injury adjustments"}
          </p>
        </div>
        <div className="player-compare-head-actions">
          {onClear ? (
            <button type="button" className="btn-ghost btn-sm" onClick={onClear}>
              Clear
            </button>
          ) : null}
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            Back to projections
          </button>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}

      {loading && !data ? (
        <p className="chart-note" role="status">
          Loading comparison…
        </p>
      ) : null}

      {data && comparison ? (
        <>
          <div className="player-compare-summary" aria-live="polite">
            <div className="player-compare-badges">
              {medianLeader ? (
                <Chip tone="positive" title="Highest median (P50) projection">
                  Median: {medianLeader.player_name || medianLeader.player_id}
                </Chip>
              ) : null}
              {floorLeader ? (
                <Chip tone="team" title="Highest floor (P10)">
                  Floor: {floorLeader.player_name || floorLeader.player_id}
                </Chip>
              ) : null}
              {ceilingLeader ? (
                <Chip tone="caution" title="Highest ceiling (P90)">
                  Ceiling: {ceilingLeader.player_name || ceilingLeader.player_id}
                </Chip>
              ) : null}
              <Chip
                tone={comparison.flex_compatible ? "neutral" : "mixed"}
                title={
                  comparison.flex_compatible
                    ? "Players share a compatible FLEX (or same) slot"
                    : "Positions may not share a FLEX slot (e.g. QB vs skill)"
                }
              >
                {comparison.flex_compatible ? "FLEX compatible" : "Not FLEX compatible"}
              </Chip>
            </div>

            {(comparison.recommendation || []).length > 0 ? (
              <div className="player-compare-reco info-callout" role="region" aria-label="Model recommendation">
                <strong className="player-compare-reco-label">Recommendation</strong>
                <ul className="player-compare-reco-list">
                  {comparison.recommendation.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="player-compare-reco-note muted">
                  Deterministic from ScoreSense projections — not AI-generated.
                </p>
              </div>
            ) : null}
          </div>

          {(data.missing_player_ids || []).length > 0 ? (
            <div className="info-callout info-callout-compact" role="status">
              Missing projections for: {data.missing_player_ids.join(", ")}
            </div>
          ) : null}

          <div
            className={`player-compare-grid player-compare-grid--${Math.min(players.length, MAX_COMPARE)}`}
          >
            {players.map((player, rowIndex) => {
              const p10 = Number(player.p10) || 0;
              const p50 = Number(player.p50) || 0;
              const p90 = Number(player.p90) || 0;
              const delta = deltaByOther.get(player.player_id);
              const isMedian = leaderId(medianLeader) === player.player_id;

              return (
                <article
                  key={player.player_id}
                  className={`player-compare-card${isMedian ? " player-compare-card--leader" : ""}`}
                >
                  <header className="player-compare-card-head">
                    <PlayerCell
                      name={player.player_name || player.player_id}
                      team={player.team}
                      playerId={player.player_id}
                      media={playerMedia}
                      size="md"
                      showTeam
                      clickable={Boolean(player.player_id)}
                      position={player.position_key || String(player.position || "").toLowerCase()}
                      season={data.meta?.season ?? season}
                      week={data.meta?.week ?? week}
                    />
                    {onRemovePlayer && players.length > MIN_COMPARE ? (
                      <button
                        type="button"
                        className="btn-ghost btn-sm player-compare-remove"
                        onClick={() => onRemovePlayer(player.player_id)}
                        aria-label={`Remove ${player.player_name || player.player_id} from compare`}
                      >
                        Remove
                      </button>
                    ) : null}
                  </header>

                  <div className="player-compare-card-meta">
                    <Chip tone="team">{player.position || "—"}</Chip>
                    {player.position_rank != null ? (
                      <span className="muted">#{player.position_rank} {player.position}</span>
                    ) : null}
                    <span className="muted">
                      {player.opponent ? `vs ${player.opponent}` : "Opp —"}
                    </span>
                    {player.injury_status ? (
                      <Chip tone="questionable">{player.injury_status}</Chip>
                    ) : null}
                  </div>

                  <div className="player-compare-metrics">
                    <div className={`player-compare-metric ${metricClass(player.player_id, floorLeader)}`}>
                      <span className="player-compare-metric-label">P10</span>
                      <span className="player-compare-metric-value">{fmtNum(player.p10, 1)}</span>
                    </div>
                    <div className={`player-compare-metric player-compare-metric--p50 ${metricClass(player.player_id, medianLeader)}`}>
                      <span className="player-compare-metric-label">P50</span>
                      <span className="player-compare-metric-value">{fmtNum(player.p50, 1)}</span>
                    </div>
                    <div className={`player-compare-metric ${metricClass(player.player_id, ceilingLeader)}`}>
                      <span className="player-compare-metric-label">P90</span>
                      <span className="player-compare-metric-value">{fmtNum(player.p90, 1)}</span>
                    </div>
                  </div>

                  <div className="range-cell player-compare-range">
                    <QuantileBar
                      p10={p10}
                      p50={p50}
                      p90={p90}
                      scaleMax={scaleMax}
                      rowIndex={rowIndex}
                      showVolatility
                    />
                  </div>

                  <dl className="player-compare-stats">
                    <div>
                      <dt>Spread</dt>
                      <dd>{fmtNum(player.spread, 1)}</dd>
                    </div>
                    <div>
                      <dt>Volatility</dt>
                      <dd>{fmtVol(player.volatility)}</dd>
                    </div>
                    <div>
                      <dt>vs median</dt>
                      <dd>
                        {isMedian
                          ? "Leader"
                          : delta
                            ? `−${fmtNum(delta.diff, 1)}`
                            : "—"}
                      </dd>
                    </div>
                  </dl>
                </article>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
  );
}

export { MIN_COMPARE, MAX_COMPARE };
