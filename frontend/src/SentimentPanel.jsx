import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "./auth";
import { isAbortError } from "./fetchAbort";
import Chip from "./Chip";
import HoverTip, { TipLine, TipTitle } from "./HoverTip";
import { connectionErrorMessage, fmtMentions, parseApiError } from "./format";
import SentimentBadge from "./SentimentBadge";
import SentimentMeter from "./SentimentMeter";
import useMobileLayout from "./useMobileLayout";

const SentimentCharts = lazy(() => import("./SentimentCharts"));

const NETWORK_CHIP_TONE = {
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
};

function mergeSentimentMeta(data) {
  if (!data) return null;
  return {
    ...(data.meta || {}),
    scope: data.scope,
    season: data.season,
    week: data.week,
    requested_season: data.requested_season,
    requested_week: data.requested_week,
    context_fallback: data.context_fallback,
    count: data.count,
  };
}

function digestText(row) {
  return row.fantasy_digest?.trim() || row.beat_digest?.trim() || "";
}

function digestSource(row) {
  return row.fantasy_digest_source || row.beat_digest_source;
}

function trendLabel(trend) {
  const n = Number(trend);
  if (!Number.isFinite(n)) return null;
  if (n > 0.25) return "↑ warming";
  if (n < -0.25) return "↓ cooling";
  return "→ steady";
}

function SourceChip({ network, label }) {
  const tone = NETWORK_CHIP_TONE[network] || "default";
  return (
    <Chip tone={tone} className="sentiment-source-chip" title={network}>
      {label || network}
    </Chip>
  );
}

function NarrativeRow({ row, scope = "weekly" }) {
  const snippet = row.snippet?.trim();
  const narrative = digestText(row) || snippet;
  const flags = [];
  if (Number(row.injury_flag) > 0) flags.push("injury");
  if (Number(row.role_hype_flag) > 0) flags.push("hype");
  const sourceLabel = digestSource(row) === "llm"
    ? "AI summary"
    : digestSource(row) === "cache"
      ? "Cached summary"
      : digestSource(row) === "extractive"
        ? "Extractive"
        : null;
  const trend = scope === "season" ? trendLabel(row.mention_trend) : null;

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
        {scope === "season" && row.weeks_with_mentions ? (
          <span>{row.weeks_with_mentions} wks</span>
        ) : null}
        {trend ? <span>{trend}</span> : null}
        {sourceLabel ? <span>{sourceLabel}</span> : null}
        {flags.length ? <span>{flags.join(" · ")}</span> : null}
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
        <p className="sentiment-snippet-clamp state-empty-text">No analyst context available</p>
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
  scope = "weekly",
  players: playersProp,
  meta: metaProp,
  loading: loadingProp,
  error: errorProp,
  className = "",
}) {
  const mobileLayout = useMobileLayout();
  const [playersLocal, setPlayersLocal] = useState([]);
  const [metaLocal, setMetaLocal] = useState(null);
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [errorLocal, setErrorLocal] = useState("");
  // Collapsed by default in the desktop sidebar; on mobile the panel IS the
  // "Analyst" tab the user tapped, so it must render its content directly.
  const [openState, setOpenState] = useState(null);
  const open = openState ?? mobileLayout;
  const setOpen = setOpenState;
  const [view, setView] = useState("list");
  const [filter, setFilter] = useState("");

  const isSeason = scope === "season";
  const panelTitle = isSeason ? "Season analyst context" : "Analyst context";
  const panelSubtitle = isSeason
    ? "YouTube fantasy analysts — season-to-date outlook, not in projections."
    : "YouTube fantasy analysts — does not change projections or injury boosts.";
  const apiPath = isSeason
    ? `/api/fantasy-narrative/${position}/season`
    : `/api/fantasy-narrative/${position}/weekly`;

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
        `${apiPath}?season=${season}&week=${week}`,
        { signal },
      );
      if (!res.ok) throw new Error(await parseApiError(res, `Failed to load ${panelTitle.toLowerCase()}`));
      const data = await res.json();
      if (signal?.aborted) return;
      setPlayersLocal(data.players || []);
      setMetaLocal(mergeSentimentMeta(data));
    } catch (err) {
      if (isAbortError(err)) return;
      setPlayersLocal([]);
      setMetaLocal(null);
      setErrorLocal(connectionErrorMessage(err, `Failed to load ${panelTitle.toLowerCase()}`));
    } finally {
      setLoadingLocal(false);
    }
  }, [controlled, apiPath, panelTitle, position, season, week]);

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
      parts.push(isSeason ? `${meta.season} · through W${meta.week}` : `${meta.season} · W${meta.week}`);
    }
    if (meta.context_fallback && meta.requested_season != null && meta.requested_week != null) {
      const reqLabel = `${meta.requested_season} W${meta.requested_week}`;
      const shownLabel = `${meta.season ?? season} W${meta.week ?? week}`;
      if (reqLabel !== shownLabel) {
        parts.push(`showing ${shownLabel}`);
      } else {
        parts.push(`fallback from ${reqLabel}`);
      }
    }
    if (meta.last_refresh) {
      parts.push(`Updated ${new Date(meta.last_refresh).toLocaleString()}`);
    }
    return parts.join(" · ");
  }, [meta, isSeason]);

  const fallbackBanner = useMemo(() => {
    if (!meta?.context_fallback) return null;
    const shownSeason = meta.season ?? season;
    const shownWeek = meta.week ?? week;
    const reqSeason = meta.requested_season ?? season;
    const reqWeek = meta.requested_week ?? week;
    return (
      <div className="sentiment-fallback-banner" role="status">
        Historical context from <strong>{shownSeason} Wk {shownWeek}</strong>
        {reqSeason !== shownSeason || reqWeek !== shownWeek ? (
          <> — no matching-week analyst data for {reqSeason} Wk {reqWeek}</>
        ) : null}
        .
      </div>
    );
  }, [meta, season, week]);

  return (
    <section
      className={`panel wide sentiment-panel projections-mobile-panel${open ? " sentiment-panel--open" : " sentiment-panel--collapsed"}${className ? ` ${className}` : ""}`.trim()}
    >
      <div className="sentiment-panel-head">
        <div className="sentiment-panel-title-block">
          <h2>{panelTitle}</h2>
          <p className="sentiment-panel-summary">
            {open ? panelSubtitle : summary || (loading ? "Loading…" : "League-wide fantasy YouTube mentions")}
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
          {!mobileLayout && (
            <button
              type="button"
              className="btn-ghost sentiment-panel-toggle"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
            >
              {open ? "Hide" : "Show"}
            </button>
          )}
        </div>
      </div>

      {open && summary && <p className="sentiment-panel-meta-line">{summary}</p>}
      {open && fallbackBanner}
      {error && open && <div className="error">{error}</div>}

      {open && view === "charts" && !loading && (
        <Suspense fallback={<div className="sentiment-charts-empty">Loading charts…</div>}>
          <SentimentCharts
            players={players}
            season={meta?.season ?? season}
            week={meta?.week ?? week}
            scope={scope}
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
            <div className="sentiment-charts-empty">Loading {panelTitle.toLowerCase()}…</div>
          )}

          {!loading && !hasData && (
            <div className="state-empty-callout sentiment-charts-empty">
              {isSeason
                ? "No analyst context for this season yet — data appears once in-season YouTube mentions are ingested."
                : "No analyst context for this week yet — data appears once in-season YouTube mentions are ingested."}
            </div>
          )}

          {!loading && hasData && (
            <div className="sentiment-player-list">
              {filteredPlayers.length === 0 && (
                <div className="state-empty-callout sentiment-charts-empty">No players match your search.</div>
              )}
              {filteredPlayers.map((row) => (
                <NarrativeRow
                  key={row.player_id || `${row.player}-${row.team}`}
                  row={row}
                  scope={scope}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
