import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import { isAbortError } from "../fetchAbort";
import { usePlayerMedia } from "../PlayerCell";
import { HubAlert, HubLoadingSkeleton, HubPage } from "./HubUILayout";
import { useTeamIdentities } from "./TeamIdentityContext";
import {
  GAME_CENTER_COPY,
  duelRows,
  findViewerMatchup,
  gameCenterBanner,
  gameCenterWeek,
  gameCenterStandingRows,
  gameStateLabel,
  interpretStandings,
  scoresArePlaceholder,
  shouldPollGameCenter,
  matchupTeams,
  nativeScoreRefreshMessage,
  shouldShowNextWeek,
  shouldShowPrevWeek,
} from "./gameCenterPresentation";
import { WEEK_BOARD_COPY } from "./weekBoard";
import LeagueScoringControl from "./LeagueScoringControl";
import GameCenterMatchup from "./GameCenterMatchup";
import "../styles/game-center-room.css";

const REFRESH_MS = 60_000;

export default function GameCenter({
  leagueId,
  hubContext,
  onNavigate,
  requestedWeek,
  requestedTeam,
  reloadToken,
  weekly = false,
  renderLineup,
}) {
  const { identities } = useTeamIdentities();
  const [data, setData] = useState(null);
  const [lineupSummary, setLineupSummary] = useState(null);
  const [section, setSection] = useState(renderLineup ? "lineup" : "starters");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [week, setWeek] = useState(() => gameCenterWeek(requestedWeek)); // null = current NFL week
  useEffect(() => {
    setWeek(gameCenterWeek(requestedWeek));
  }, [leagueId, requestedWeek]);

  const scope = `${leagueId}:${week}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const readVersion = useRef(0);

  const load = useCallback(
    async (signal, { refresh = false } = {}) => {
      if (!leagueId) return;
      const version = ++readVersion.current;
      const isCurrent = () => !signal?.aborted && scopeRef.current === scope && version === readVersion.current;
      setError("");
      try {
        const params = new URLSearchParams();
        if (week != null) params.set("week", String(week));
        if (refresh) params.set("refresh", "1");
        const q = params.toString();
        const res = await apiFetch(
          `/api/hub/league/${encodeURIComponent(leagueId)}/live-scoring${q ? `?${q}` : ""}`,
          { signal },
        );
        if (!res.ok) throw new Error(await parseApiError(res));
        const payload = await res.json();
        if (isCurrent()) setData(payload);
      } catch (e) {
        if (isAbortError(e) || !isCurrent()) return;
        setError(connectionErrorMessage(e));
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    [leagueId, week, scope],
  );

  useEffect(() => {
    setLoading(true);
    setData(null);
    setLineupSummary(null);
    const ctrl = new AbortController();
    const native = !hubContext?.sleeper_league_id;
    load(ctrl.signal, {
      refresh: Boolean(hubContext?.draft_completed && native),
    });
    return () => ctrl.abort();
  }, [load, hubContext?.draft_completed, hubContext?.sleeper_league_id, reloadToken]);

  const pollScores = shouldPollGameCenter(data, hubContext);
  const refreshPending = ["pending", "running"].includes(data?.scoring_control?.refresh?.status);
  useEffect(() => {
    if (!refreshPending) return undefined;
    const ctrl = new AbortController();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") load(ctrl.signal);
    }, 5000);
    return () => { window.clearInterval(id); ctrl.abort(); };
  }, [refreshPending, load]);

  /** Current NFL weeks re-pull stats while the tab is visible. */
  useEffect(() => {
    if (!pollScores) return undefined;
    const ctrl = new AbortController();
    const tick = () => {
      if (document.visibilityState === "visible") load(ctrl.signal, { refresh: true });
    };
    const id = window.setInterval(tick, REFRESH_MS);
    return () => {
      window.clearInterval(id);
      ctrl.abort();
    };
  }, [pollScores, load]);

  const matchup = useMemo(
    () => findViewerMatchup(data, requestedTeam),
    [data, requestedTeam],
  );
  const { viewer, opponent } = useMemo(
    () => matchupTeams(matchup, requestedTeam),
    [matchup, requestedTeam],
  );
  const rows = useMemo(
    () => duelRows(viewer, opponent, data?.starting_slots || []),
    [viewer, opponent, data?.starting_slots],
  );
  const duelIds = useMemo(
    () =>
      rows
        .flatMap((r) => [r.home?.player_id, r.away?.player_id])
        .filter(Boolean),
    [rows],
  );
  const media = usePlayerMedia(duelIds);

  const standingsView = useMemo(
    () =>
      interpretStandings(data, {
        draftCompleted: hubContext?.draft_completed,
      }),
    [data, hubContext?.draft_completed],
  );
  const standingRows = useMemo(
    () =>
      gameCenterStandingRows(standingsView.standings, hubContext?.team_id, {
        compact: false,
      }),
    [standingsView.standings, hubContext?.team_id],
  );
  // Keep the editor in one location and one scope while independent scores load.
  const lineupWeek = week;
  const weekNumber = data?.week ?? week ?? lineupSummary?.week;
  const currentWeek = data?.current_week;
  const maxWeek = data?.max_week || 18;
  const stateLabel =
    loading && !data
      ? GAME_CENTER_COPY.loadingChip
      : data
        ? gameStateLabel(data, hubContext)
        : "";
  const otherMatchups = (data?.matchups || []).filter((m) => m !== matchup);
  const placeholder = scoresArePlaceholder(data, hubContext);
  const hasSlate = (data?.matchups || []).length > 0;
  const fullPageEmpty = !loading && data && !hasSlate;
  const banner = gameCenterBanner({
    draftCompleted: hubContext?.draft_completed,
    draftStartsAt: hubContext?.draft_starts_at,
    placeholder,
    reason: data?.reason,
    sleeperLinked: Boolean(
      hubContext?.sleeper_league_id || data?.hub_context?.sleeper_league_id,
    ),
  });
  const showBanner = Boolean(!loading && data && banner);
  const stepWeek = (delta) => {
    const base = Number(weekNumber ?? currentWeek ?? 1);
    const next = Math.min(Number(maxWeek), Math.max(1, base + delta));
    setWeek(next);
  };

  const showPrev = shouldShowPrevWeek(weekNumber);
  const showNext = shouldShowNextWeek(weekNumber, maxWeek);

  const goBanner = () => {
    if (!onNavigate || !banner) return;
    onNavigate(banner.action);
  };

  return (
    <HubPage frameless={weekly} className={`hub-game-room${weekly ? " hub-week-room" : ""}`}>
      <header className="gc-room-heading">
        <div className="gc-room-page-title">
          <p>
            {weekNumber
              ? `Week ${weekNumber} · ${data?.season || ""}`
              : weekly ? GAME_CENTER_COPY.weeklyTitle : GAME_CENTER_COPY.eyebrow}
          </p>
          <h1>{weekly ? GAME_CENTER_COPY.weeklyTitle : GAME_CENTER_COPY.eyebrow}</h1>
        </div>
        <div className="gc-room-week" role="group" aria-label="Week">
          {showPrev && (
            <button
              className="btn-ghost"
              disabled={loading}
              onClick={() => stepWeek(-1)}
              aria-label="Previous week"
            >
              ←
            </button>
          )}
          <span>
            {weekNumber ? `Week ${weekNumber}` : GAME_CENTER_COPY.loadingChip}
          </span>
          {showNext && (
            <button
              className="btn-ghost"
              disabled={loading}
              onClick={() => stepWeek(1)}
              aria-label="Next week"
            >
              →
            </button>
          )}
          {!weekly && <a href="/hub/roster">{GAME_CENTER_COPY.backToTeam}</a>}
        </div>
        {weekly && lineupSummary && lineupSummary.week === weekNumber && <span className="hub-week-call-count" role="status">{WEEK_BOARD_COPY.compactCalls(lineupSummary.calls)}</span>}
      </header>
      {error && (
        <HubAlert variant="warn">
          {error}
          <button className="btn-ghost" onClick={() => load()}>
            {GAME_CENTER_COPY.retry}
          </button>
        </HubAlert>
      )}
      {!loading && nativeScoreRefreshMessage(data) && (
        <HubAlert variant={data?.scoring_control?.refresh?.status === "failed" ? "warn" : "info"}>
          {nativeScoreRefreshMessage(data)}
        </HubAlert>
      )}
      {loading && <HubLoadingSkeleton label="Loading matchups" rows={3} />}
      {!loading && showBanner && (
        <HubAlert
          variant="warn"
          action={
            onNavigate ? (
              <button className="btn-ghost" onClick={goBanner}>
                {banner.actionLabel}
              </button>
            ) : null
          }
        >
          {banner.text}
        </HubAlert>
      )}
      {!loading && fullPageEmpty && !showBanner && (
        <p className="gc-room-empty">
          {data?.hint || GAME_CENTER_COPY.emptyPreseason}
        </p>
      )}
      {!loading && matchup && viewer && opponent && (
        <GameCenterMatchup
          key={`${leagueId}-${weekNumber}-${viewer.roster_id}`}
          data={data}
          viewer={viewer}
          opponent={opponent}
          rows={rows}
          media={media}
          identities={identities}
          placeholder={placeholder}
          stateLabel={stateLabel}
          otherMatchups={otherMatchups}
          standingRows={standingRows}
          standingsView={standingsView}
          onNavigate={onNavigate}
          hubContext={hubContext}
          weekly={weekly}
          lineup={Boolean(renderLineup)}
          activeSection={weekly ? section : undefined}
          onSectionChange={weekly ? setSection : undefined}
          scoringControl={(
            <LeagueScoringControl
              key={`${leagueId}-${data.season}-${data.week}`}
              leagueId={leagueId}
              data={data}
              hubContext={hubContext}
              onNavigate={onNavigate}
              onScored={() => load()}
            />
          )}
        />
      )}
      {weekly && renderLineup && section === "lineup" && renderLineup({week:lineupWeek, onChanged:() => load(), onSummary:setLineupSummary})}
    </HubPage>
  );
}
