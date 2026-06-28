import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "./auth";
import { isAbortError } from "./fetchAbort";
import Chip from "./Chip";
import HoverTip, { TipLine, TipTitle } from "./HoverTip";
import { connectionErrorMessage, fmtMentions, parseApiError } from "./format";
import SentimentBadge from "./SentimentBadge";
import SentimentMeter from "./SentimentMeter";

const SentimentCharts = lazy(() => import("./SentimentCharts"));

const NETWORK_CHIP_TONE = {
  locked_on: "probable",
  sb_nation: "doubtful",
  chat_sports: "questionable",
  fantasy_footballers: "probable",
  fantasypros_yt: "probable",
  late_round: "probable",
  fantasy_points: "probable",
  reception_perception: "probable",
  underdog_fantasy: "doubtful",
  establish_the_run: "doubtful",
  draft_sharks: "doubtful",
  playerprofiler: "doubtful",
  qb_list: "doubtful",
  espn: "probable",
  athletic: "doubtful",
};

function mergeSentimentMeta(data) {
  if (!data) return null;
  return {
    ...(data.meta || {}),
    season: data.season,
    week: data.week,
    requested_season: data.requested_season,
    requested_week: data.requested_week,
    context_fallback: data.context_fallback,
    count: data.count,
  };
}

function SourceChip({ network, label }) {
  const tone = NETWORK_CHIP_TONE[network] || "default";
  return (
    <Chip tone={tone} className="sentiment-source-chip" title={network}>
      {label || network}
    </Chip>
  );
}

function NarrativeRow({ row }) {
  const snippet = row.snippet?.trim();
  const narrative = row.beat_digest?.trim() || snippet;
  const flags = [];
  if (Number(row.injury_flag) > 0) flags.push("injury");
  if (Number(row.role_hype_flag) > 0) flags.push("hype");
  const sourceLabel = row.beat_digest_source === "llm"
    ? "AI summary"
    : row.beat_digest_source === "cache"
      ? "Cached summary"
      : row.beat_digest_source === "extractive"
        ? "Extractive"
        : null;

  return (
    <article className="sentiment-player-card">
      <div className="sentiment-player-card-head">
        <div className="sentiment-player-identity">
          <span className="sentiment-player-name">{row.player}</span>
          {row.team ? <Chip tone="team">{row.team}</Chip> : null}
        </div>
        <div className="sentiment-player-tone">
          <SentimentBadge sentiment={row} compact />
          <SentimentMeter score={row.sentiment_score} size="sm" />
        </div>
      </div>

      <div className="sentiment-player-meta">
        <span>{fmtMentions(row.mention_count)} mentions</span>
        {sourceLabel ? <span>{sourceLabel}</span> : null}
        {flags.length ? <span>{flags.join(" · ")}</span> : null}
        {row.beat_writer ? <span className="sentiment-beat-line">{row.beat_writer}</span> : null}
      </div>

      {narrative ? (
        <HoverTip
          content={
            <>
              <TipTitle>{row.sentiment_label_text || row.sentiment_label}</TipTitle>
              {snippet && snippet !== narrative ? (
                <TipLine className="hover-tip-snippet">Raw notes: {snippet}</TipLine>
              ) : null}
            </>
          }
          variant="dark"
        >
          <p className="sentiment-snippet-clamp sentiment-narrative">{narrative}</p>
        </HoverTip>
      ) : (
        <p className="sentiment-snippet-clamp muted">No narrative available</p>
      )}

      {row.sources?.length ? (
        <div className="sentiment-source-badges">
          {row.sources.map((src) => (
            <SourceChip
              key={`${src.label}-${src.network}`}
              network={src.network}
              label={src.network_label || src.label}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

export default function SentimentPanel({
  position,
  season,
  week,
  players: playersProp,
  meta: metaProp,
  loading: loadingProp,
  error: errorProp,
  className = "",
}) {
  const [playersLocal, setPlayersLocal] = useState([]);
  const [metaLocal, setMetaLocal] = useState(null);
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [errorLocal, setErrorLocal] = useState("");
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("list");
  const [filter, setFilter] = useState("");

  const controlled = playersProp !== undefined;
  const players = controlled ? playersProp || [] : playersLocal;
  const meta = controlled ? metaProp : metaLocal;
  const loading = controlled ? Boolean(loadingProp) : loadingLocal;
  const error = controlled ? errorProp || "" : errorLocal;

  const fetchSentiment = useCallback(async (signal) => {
    if (controlled || season == null || week == null) return;
    setLoadingLocal(true);
    setErrorLocal("");
    try {
      const res = await apiFetch(
        `/api/sentiment/${position}?season=${season}&week=${week}`,
        { signal },
      );
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to load beat narrative"));
      const data = await res.json();
      if (signal?.aborted) return;
      setPlayersLocal(data.players || []);
      setMetaLocal(mergeSentimentMeta(data));
    } catch (err) {
      if (isAbortError(err)) return;
      setPlayersLocal([]);
      setMetaLocal(null);
      setErrorLocal(connectionErrorMessage(err, "Failed to load beat narrative"));
    } finally {
      setLoadingLocal(false);
    }
  }, [controlled, position, season, week]);

  useEffect(() => {
    const controller = new AbortController();
    fetchSentiment(controller.signal);
    return () => controller.abort();
  }, [fetchSentiment]);

  const filteredPlayers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return players;
    return players.filter(
      (row) =>
        String(row.player || "").toLowerCase().includes(q) ||
        String(row.team || "").toLowerCase().includes(q)
    );
  }, [players, filter]);

  const hasData = players.length > 0;

  const summary = useMemo(() => {
    if (!meta) return null;
    const parts = [];
    if (meta.count != null) {
      parts.push(`${meta.count} players`);
    }
    if (meta.season != null && meta.week != null) {
      parts.push(`${meta.season} · W${meta.week}`);
    }
    if (meta.context_fallback && meta.requested_season != null && meta.requested_week != null) {
      parts.push(`fallback from ${meta.requested_season} W${meta.requested_week}`);
    }
    if (meta.data_coverage != null && Number.isFinite(Number(meta.data_coverage))) {
      parts.push(`${Math.round(Number(meta.data_coverage) * 100)}% team coverage`);
    }
    if (meta.last_refresh) {
      parts.push(`Updated ${new Date(meta.last_refresh).toLocaleString()}`);
    }
    return parts.join(" · ");
  }, [meta]);

  const beatWriters = meta?.beat_writers_by_team || {};
  const beatWriterTeams = Object.keys(beatWriters).sort();

  const fallbackBanner = useMemo(() => {
    if (!meta?.context_fallback) return null;
    const shownSeason = meta.season ?? season;
    const shownWeek = meta.week ?? week;
    const reqSeason = meta.requested_season ?? season;
    const reqWeek = meta.requested_week ?? week;
    return (
      <div className="sentiment-fallback-banner" role="status">
        Showing <strong>Wk {shownWeek}</strong> (no data for Wk {reqWeek}).
      </div>
    );
  }, [meta, season, week]);

  return (
    <section className={`panel wide sentiment-panel projections-mobile-panel ${className}`.trim()}>
      <div className="sentiment-panel-head">
        <div className="sentiment-panel-title-block">
          <h2>Weekly narrative</h2>
          <p className="sentiment-panel-summary">
            {open
              ? "Video context only — not in projections."
              : summary || (loading ? "Loading…" : "Team & fantasy video mentions")}
          </p>
        </div>
        <div className="sentiment-panel-actions">
          {open && hasData && !loading && (
            <div className="sentiment-view-toggle" role="tablist" aria-label="Narrative view">
              <button
                type="button"
                className={`tab sentiment-view-tab ${view === "list" ? "active" : ""}`}
                role="tab"
                aria-selected={view === "list"}
                onClick={() => setView("list")}
              >
                Players
              </button>
              <button
                type="button"
                className={`tab sentiment-view-tab ${view === "charts" ? "active" : ""}`}
                role="tab"
                aria-selected={view === "charts"}
                onClick={() => setView("charts")}
              >
                Charts
              </button>
            </div>
          )}
          <button
            type="button"
            className="btn-ghost sentiment-panel-toggle"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {open && summary && <p className="sentiment-panel-meta-line">{summary}</p>}
      {open && fallbackBanner}
      {error && open && <div className="error">{error}</div>}

      {open && beatWriterTeams.length > 0 && (
        <details className="sentiment-panel-details">
          <summary>Team beat reporters</summary>
          <ul className="sentiment-beat-list">
            {beatWriterTeams.map((team) => (
              <li key={team}>
                <strong>{team}</strong> — {beatWriters[team]}
              </li>
            ))}
          </ul>
        </details>
      )}

      {open && view === "charts" && !loading && (
        <Suspense fallback={<div className="sentiment-charts-empty">Loading charts…</div>}>
          <SentimentCharts
            players={players}
            season={meta?.season ?? season}
            week={meta?.week ?? week}
          />
        </Suspense>
      )}

      {open && view === "list" && (
        <>
          <div className="sentiment-panel-toolbar">
            <input
              type="search"
              className="search-input sentiment-panel-search"
              placeholder="Search players…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter narrative list"
            />
            {!loading && hasData && (
              <span className="table-meta">{filteredPlayers.length} shown</span>
            )}
          </div>

          {loading && (
            <div className="sentiment-charts-empty">Loading weekly narrative…</div>
          )}

          {!loading && !hasData && (
            <div className="sentiment-charts-empty">
              No channel mentions for this week yet. Run sentiment refresh after channel IDs are configured.
            </div>
          )}

          {!loading && hasData && (
            <div className="sentiment-player-list">
              {filteredPlayers.length === 0 && (
                <div className="sentiment-charts-empty">No players match your search.</div>
              )}
              {filteredPlayers.map((row) => (
                <NarrativeRow key={row.player_id || `${row.player}-${row.team}`} row={row} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
