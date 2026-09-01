import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "./auth";
import { isAbortError } from "./fetchAbort";
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
  isScheduleAwareMethod,
  resolveSeasonBand,
  seasonRangeTooltip,
} from "./seasonQuantiles";
import {
  formatOpportunityAdjustmentPct,
  pickOpportunityAdjustment,
} from "./opportunityAdjustment";
import HistoricalMediaOptIn from "./HistoricalMediaOptIn";
import {
  formatHistoricalWeekLabel,
  isHistoricalAvailable,
  pickHistoricalWeek,
  setIncludeHistoricalParam,
} from "./mediaContext";
import { fantasyMediaNarrative } from "./fantasyMediaDigest";
import {
  BOARD_COPY,
  analystInsight,
  filterInspectorCandidates,
  methodInsight,
  positionShort,
  rangeInsight,
  roleOutlook,
  weeklyQuantiles,
  weeklyWhyNow,
  seasonRead,
} from "./projectionsPresentation";

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
        <span>Median</span>
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

function InspectorTile({ kicker, title, detail }) {
  return (
    <div className="player-inspector-tile">
      <p className="player-inspector-tile-kicker">{kicker}</p>
      <p className="player-inspector-tile-title">{title}</p>
      {detail ? <p className="player-inspector-tile-detail">{detail}</p> : null}
    </div>
  );
}

function PlayerCardBody({
  data,
  loading,
  error,
  fallbackName,
  request,
  includeHistorical = false,
  onViewOlderCommentary,
}) {
  const [whyOpen, setWhyOpen] = useState(false);
  const explainPlayerId = data?.player_id || request?.playerId || "";

  useEffect(() => {
    setWhyOpen(false);
  }, [explainPlayerId]);

  const applyInjury = request?.applyInjuryAdjustments ?? true;
  const seasonScope = request?.scope === "season";

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

  if (loading && !data) {
    return (
      <>
        <p className="player-card-loading chart-note">Loading player…</p>
        {contextPanel}
      </>
    );
  }
  if (error && !data) {
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
  const weeklyBand = weekly ? weeklyQuantiles({
    "Low (P10)": weekly["Low (P10)"],
    "Projected Points": weekly["Projected Points"],
    "High (P90)": weekly["High (P90)"],
  }) : { p10: null, p50: null, p90: null };
  const narrativeFallback = Boolean(narrativeMeta.context_fallback);
  const media = narrativeMeta.media_context;
  const historical = pickHistoricalWeek(media);
  const historicalLabel = formatHistoricalWeekLabel(historical)
    || (narrativeMeta.season != null && narrativeMeta.week != null
      ? formatHistoricalWeekLabel({ season: narrativeMeta.season, week: narrativeMeta.week })
      : null);
  const showHistoricalOptIn =
    !narrative
    && isHistoricalAvailable(media)
    && !includeHistorical
    && typeof onViewOlderCommentary === "function";

  const primary = seasonScope && seasonBand?.p50 != null
    ? {
      p10: seasonBand.p10,
      p50: seasonBand.p50,
      p90: seasonBand.p90,
      floorLabel: "Floor",
      midLabel: "Season P50",
      ceilLabel: "Ceiling",
      format: (v) => formatSeasonPts(v, 0),
      title: seasonTip,
    }
    : {
      p10: weeklyBand.p10,
      p50: weeklyBand.p50,
      p90: weeklyBand.p90,
      floorLabel: "Floor",
      midLabel: "P50",
      ceilLabel: "Ceiling",
      format: (v) => Number.isFinite(v) ? v.toFixed(1) : "—",
      title: "Per-game scoring range",
    };

  const scheduleAware = isScheduleAwareMethod(seasonBand?.method || season?.season_quantile_method);
  const seasonMode = request?.seasonMode;
  const slateRank = request?.rank ?? null;
  const slatePeers = request?.peers || {};
  const rangeText = seasonScope
    ? seasonRead({
      Player: data.player_name,
      player_id: data.player_id,
      "Season Proj": seasonBand?.p50,
      "Season P10": seasonBand?.p10,
      "Season P90": seasonBand?.p90,
      season_quantile_method: seasonBand?.method,
    }, slatePeers, { rank: slateRank, position: request?.position || data.position })
    : weeklyWhyNow({
      Player: data.player_name,
      "Projected Points": weeklyBand.p50,
      "Low (P10)": weeklyBand.p10,
      "High (P90)": weeklyBand.p90,
      "Injury Status": injury?.injury_status,
    }, slatePeers, { rank: slateRank, position: request?.position || data.position });

  const role = roleOutlook({
    rank: slateRank,
    position: request?.position || data.position,
    injuryStatus: injury?.injury_status,
    rookie: Boolean(season?.["Rookie Est."] || data.rookie),
  });
  const range = rangeInsight(rangeText);
  const method = methodInsight({
    scope: seasonScope ? "season" : "weekly",
    scheduleAware,
    applyInjuryAdjustments: applyInjury,
    seasonMode,
  });
  const analyst = analystInsight({
    narrative,
    historicalLabel: narrativeFallback ? historicalLabel : null,
  });
  const seasonIdentity = seasonMode === "live" ? "season" : "preseason";
  const identityMeta = [
    positionShort(request?.position || data.position),
    data.team || request?.team,
    seasonScope
      ? (request?.season != null ? `${request.season} ${seasonIdentity}` : (seasonMode === "live" ? "Season" : "Preseason"))
      : weekLabel,
  ].filter(Boolean).join(" · ");

  return (
    <div className="player-card-body player-inspector-body">
      <div className="player-inspector-identity">
        <div>
          <PlayerCell
            name={data.player_name || fallbackName}
            team={data.team}
            playerId={data.player_id}
            media={data.media ? { [data.player_id]: data.media } : null}
            size="lg"
            showTeam={false}
            position={positionShort(request?.position || data.position)}
          />
          {identityMeta ? (
            <p className="player-card-context muted" role="status">{identityMeta}</p>
          ) : null}
        </div>
        <span className={`player-inspector-chip${injury?.injury_status ? " player-inspector-chip--caution" : ""}`}>
          {injury?.injury_status
            ? injury.injury_status
            : !seasonScope
              ? BOARD_COPY.weeklyModel
              : seasonMode === "live"
                ? BOARD_COPY.liveSeason
                : scheduleAware
                  ? BOARD_COPY.scheduleAware
                  : BOARD_COPY.preseasonEstimate}
        </span>
      </div>

      <div className="player-inspector-stats">
        <div className="player-inspector-stat">
          <span className="player-inspector-stat-label">{primary.floorLabel}</span>
          <span className="player-inspector-stat-value">
            {primary.p10 != null ? primary.format(primary.p10) : "—"}
          </span>
        </div>
        <div className="player-inspector-stat player-inspector-stat--primary">
          <span className="player-inspector-stat-label">{primary.midLabel}</span>
          <span className="player-inspector-stat-value">
            {primary.p50 != null ? primary.format(primary.p50) : "—"}
          </span>
        </div>
        <div className="player-inspector-stat">
          <span className="player-inspector-stat-label">{primary.ceilLabel}</span>
          <span className="player-inspector-stat-value">
            {primary.p90 != null ? primary.format(primary.p90) : "—"}
          </span>
        </div>
      </div>
      <ScaledRangeBar
        p10={primary.p10}
        p50={primary.p50}
        p90={primary.p90}
        title={primary.title}
        formatValue={primary.format}
      />

      <div className="player-inspector-grid">
        <InspectorTile kicker="Role outlook" title={role.title} detail={role.detail} />
        <InspectorTile kicker="Range read" title={range.title} detail={range.detail} />
        <InspectorTile kicker="Method" title={method.title} detail={method.detail} />
        <InspectorTile kicker="Analyst desk" title={analyst.title} detail={analyst.detail} />
      </div>

      {!seasonScope && weekly && pickOpportunityAdjustment(weekly) ? (
        <p className="chart-note">
          Opportunity adjustment {formatOpportunityAdjustmentPct(weekly)}
        </p>
      ) : null}

      {contextPanel}

      <section className="player-card-section">
        <h3>Analyst context</h3>
        {(narrativeFallback || (narrative && isHistoricalAvailable(media))) && historicalLabel ? (
          <div className="sentiment-fallback-banner player-card-narrative-fallback" role="status">
            Older commentary from <strong>{historicalLabel}</strong>
            {" — not current-week coverage."}
          </div>
        ) : null}
        {narrative ? (
          <>
            <div className="player-card-narrative-head">
              <SentimentBadge sentiment={narrative} compact />
            </div>
            <p className="player-card-narrative">
              {fantasyMediaNarrative(narrative, narrative.snippet) || "—"}
            </p>
          </>
        ) : showHistoricalOptIn ? (
          <HistoricalMediaOptIn
            requestedWeek={request?.week ?? narrativeMeta.requested_week}
            media={media}
            loading={loading}
            onViewOlder={onViewOlderCommentary}
          />
        ) : (
          <p className="state-empty-text player-card-empty">
            No analyst context for this player yet.
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

function InspectorSearch({ request, onSelect, candidates = [] }) {
  const [query, setQuery] = useState("");
  const matches = useMemo(
    () => (query.trim() ? filterInspectorCandidates(candidates, query) : []),
    [candidates, query],
  );

  useEffect(() => {
    setQuery("");
  }, [request?.playerId]);

  return (
    <div className="player-inspector-search">
      <label className="sr-only" htmlFor="player-inspector-search">
        {BOARD_COPY.searchInspector}
      </label>
      <input
        id="player-inspector-search"
        type="search"
        className="search-input"
        placeholder={BOARD_COPY.searchInspector}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {matches.length ? (
        <ul className="player-inspector-search-list">
          {matches.map((hit) => (
            <li key={hit.playerId}>
              <button
                type="button"
                onClick={() => {
                  onSelect?.(hit);
                  setQuery("");
                }}
              >
                {hit.name}
                {hit.team ? ` · ${hit.team}` : ""}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function PlayerCardModal({
  request,
  onClose,
  candidates = [],
  compareIds = [],
  onToggleCompare,
  maxCompare = 4,
  onSelectPlayer,
}) {
  const mobileLayout = useMobileLayout();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [includeHistorical, setIncludeHistorical] = useState(false);

  useEffect(() => {
    if (!request || mobileLayout) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [request, mobileLayout, onClose]);

  useEffect(() => {
    setIncludeHistorical(false);
  }, [request?.playerId, request?.season, request?.week, request?.scope]);

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
        setIncludeHistoricalParam(params, includeHistorical);
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
  }, [request, includeHistorical]);

  if (!request) return null;

  const title = data?.player_name || request.playerName || "Player";
  const selectPlayer = (hit) => {
    onSelectPlayer?.({
      ...request,
      playerId: hit.playerId,
      name: hit.name,
      team: hit.team,
      position: hit.position || request.position,
      rank: hit.rank ?? null,
    });
  };

  const selectedSet = (compareIds || []).map(String);
  const selected = selectedSet.includes(String(request.playerId));
  const canAdd = Boolean(onToggleCompare) && (!selected ? selectedSet.length < maxCompare : true);

  const body = (
    <div className="player-inspector">
      <div className="player-inspector-toolbar">
        <InspectorSearch request={request} onSelect={selectPlayer} candidates={candidates} />
        <button type="button" className="btn-ghost player-inspector-close" onClick={onClose} aria-label="Close">
          Close
        </button>
      </div>
      <div className="player-inspector-scroll">
        <PlayerCardBody
          data={data}
          loading={loading}
          error={error}
          fallbackName={request.playerName}
          request={request}
          includeHistorical={includeHistorical}
          onViewOlderCommentary={() => setIncludeHistorical(true)}
        />
      </div>
      <div className="player-inspector-footer">
        <span className="player-inspector-chip-player">
          {title}
          <button type="button" className="btn-ghost" onClick={onClose} aria-label={`Close ${title}`}>
            ×
          </button>
        </span>
        {canAdd ? (
          <button
            type="button"
            className="player-inspector-add"
            onClick={() => onToggleCompare({
              player_id: request.playerId,
              Player: title,
              Team: request.team,
            })}
          >
            {selected ? "Remove from compare" : `+ ${BOARD_COPY.addPlayer}`}
          </button>
        ) : null}
      </div>
    </div>
  );

  if (mobileLayout) {
    return (
      <MobileBottomSheet open onClose={onClose} title={title} className="player-card-sheet">
        {body}
      </MobileBottomSheet>
    );
  }

  return (
    <div className="player-card-overlay player-card-overlay--drawer" role="presentation" onClick={onClose}>
      <div
        className="player-card-dialog player-card-drawer panel"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        {body}
      </div>
    </div>
  );
}
