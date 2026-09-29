import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import { isAbortError } from "../fetchAbort";
import useMobileLayout from "../useMobileLayout";
import { HubAlert, HubLoadingSkeleton, HubPage, HubSection } from "./HubUILayout";
import LeagueChat from "./LeagueChat";
import TeamIdentityMark from "./TeamIdentityMark";
import { identityFor, useTeamIdentities } from "./TeamIdentityContext";
import {
  findViewerMatchup,
  formatStandingRank,
  formatStandingRecord,
  gameCenterTeamParts,
  interpretStandings,
  matchupTeams,
} from "./gameCenterPresentation";
import "../styles/fantasy-mobile-home.css";
import {
  actionLabel,
  formatHomeScore,
  HOME_DECK_COPY,
  HOME_PAGE_COPY,
  homeDeckMode,
  homeDeckStandingRows,
  homeHasPendingCuts,
  homeStandingHasGap,
  homeAlsoDueMessage,
  homeMatchupNote,
  phaseTrackState,
  resolveLeagueHomeFocus,
  homeAttentionActions,
  homeShowsPriority,
  homeScoreMode,
  homeScoresArePlaceholder,
} from "./leagueHomePresentation";
import { getHomeCache, homeCacheKey, setHomeCache } from "./hubDataCache";

/** Valid Hub subview targets returned by `/api/hub/home` actions / primary CTA. */
const HUB_ACTION_VIEWS = new Set([
  "setup",
  "planner",
  "roster",
  "week",
  "office",
  "office-access",
  "available",
  "value",
  "room",
  "rosters",
  "trades",
  "insights",
  "home",
  "game",
]);

function severityVariant(severity) {
  if (severity === "high") return "danger";
  if (severity === "low") return "info";
  return "warn";
}

function fmtCap(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(Math.round(n))}`;
}

function ActionRow({ action, onNavigate }) {
  if (!action) return null;
  const href = HUB_ACTION_VIEWS.has(action.href) ? action.href : null;
  return (
    <li className={`hub-home-action hub-home-action--${severityVariant(action.severity)}`}>
      <div className="hub-home-action-main">
        <p className="hub-home-action-message">{homeAlsoDueMessage(action)}</p>
        {action.count != null && action.id !== "expiring_contracts" && (
          <span className="hub-home-action-meta">{action.count} item{action.count === 1 ? "" : "s"}</span>
        )}
        {action.amount != null && action.id === "cap_overage" && (
          <span className="hub-home-action-meta">{fmtCap(action.amount)} over</span>
        )}
      </div>
      {href && onNavigate ? (
        <button
          type="button"
          className="btn-ghost btn-sm hub-home-action-go"
          onClick={() => onNavigate(href)}
        >
          {actionLabel(action)} <span aria-hidden="true">→</span>
        </button>
      ) : null}
    </li>
  );
}

function formatDraftDate(schedule) {
  if (!schedule?.starts_at) return null;
  return new Date(schedule.starts_at).toLocaleString(undefined, {
    timeZone: schedule.timezone || undefined,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/**
 * Phase-aware League Home + action center (SCORE-10).
 * Action center from GET /api/hub/home. Matchup/standings deck from live-scoring.
 */
export default function LeagueHome({
  hubContext,
  reloadToken = 0,
  onNavigate,
  onNavigateSetup,
  onLeagueSync,
}) {
  const mobileLayout = useMobileLayout();
  const { identities } = useTeamIdentities();
  const cacheKey = homeCacheKey(hubContext);
  const [data, setData] = useState(() => getHomeCache(cacheKey)?.data || null);
  const [loading, setLoading] = useState(() => !getHomeCache(cacheKey)?.data);
  const [error, setError] = useState("");
  const [scoring, setScoring] = useState(null);
  const [scoringError, setScoringError] = useState("");
  const [chatMounted, setChatMounted] = useState(!mobileLayout);
  const [slowLoad, setSlowLoad] = useState(false);
  const [prevCacheKey, setPrevCacheKey] = useState(cacheKey);
  if (cacheKey !== prevCacheKey) {
    setPrevCacheKey(cacheKey);
    const cached = getHomeCache(cacheKey);
    setData(cached?.data || null);
    setLoading(!cached?.data);
    setError("");
    setScoring(null);
    setScoringError("");
    setSlowLoad(false);
    setChatMounted(!mobileLayout);
  }
  const leagueId = hubContext?.mode === "league" ? hubContext?.league_id : null;

  const load = useCallback(async (signal) => {
    const cached = getHomeCache(cacheKey);
    if (cached?.data) {
      setData(cached.data);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError("");
    try {
      const res = await apiFetch("/api/hub/home?include_week=false", { signal });
      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      if (signal?.aborted) return;
      setHomeCache(cacheKey, payload);
      setData(payload);
    } catch (e) {
      if (isAbortError(e) || signal?.aborted) return;
      setError(connectionErrorMessage(e));
      if (!cached?.data) setData(null);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [cacheKey]);

  useEffect(() => {
    if (!loading) {
      setSlowLoad(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setSlowLoad(true), 3000);
    return () => window.clearTimeout(timer);
  }, [loading]);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [
    load,
    hubContext?.league_id,
    hubContext?.team_id,
    hubContext?.mode,
    hubContext?.draft_completed,
    reloadToken,
  ]);

  useEffect(() => {
    if (!leagueId) { setScoring(null); return undefined; }
    const ctrl = new AbortController();
    const update = async () => {
      try {
        const query = hubContext?.draft_completed ? "?home_view=true" : "";
        const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/live-scoring${query}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(await parseApiError(res));
        const payload = await res.json();
        if (ctrl.signal.aborted) return;
        setScoring(payload);
        setScoringError(payload.available === false ? HOME_PAGE_COPY.matchupUnavailable : "");
      } catch (e) {
        if (!ctrl.signal.aborted) setScoringError(connectionErrorMessage(e));
      }
    };
    update();
    const refresh = () => { if (!document.hidden) update(); };
    const timer = window.setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);
    return () => { ctrl.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [leagueId, reloadToken, hubContext?.draft_completed]);

  const phase = data?.phase || {};
  const primaryCta = phase.primary_cta || null;
  const actions = data?.actions || [];
  const cap = data?.cap || {};
  const focus = resolveLeagueHomeFocus({
    actions,
    primaryCta,
    defaultView: data?.checklist?.default_view,
    validViews: HUB_ACTION_VIEWS,
  });
  const showPriority = homeShowsPriority(phase.id);
  const supportingActions = homeAttentionActions(actions, phase.id, showPriority ? focus : null);
  const phaseTrack = phaseTrackState(phase.id);
  const pendingCuts = homeHasPendingCuts(data);
  const deckMode = homeDeckMode({
    phaseId: phase.id,
    draftCompleted: hubContext?.draft_completed ?? data?.hub_context?.draft_completed,
    scoring,
  });

  const draftDate = formatDraftDate(data?.draft_schedule);

  const goSetup = onNavigateSetup || (onNavigate ? () => onNavigate("setup") : null);

  const matchup = useMemo(() => findViewerMatchup(scoring), [scoring]);
  const { viewer: matchViewer, opponent: matchOpponent } = useMemo(
    () => matchupTeams(matchup),
    [matchup],
  );
  const standingsView = useMemo(
    () => interpretStandings(scoring, {
      phaseId: phase.id,
      draftCompleted: hubContext?.draft_completed ?? data?.hub_context?.draft_completed,
    }),
    [scoring, phase.id, hubContext?.draft_completed, data?.hub_context?.draft_completed],
  );
  const standingRows = useMemo(
    () => homeDeckStandingRows(standingsView.standings, hubContext?.team_id),
    [standingsView.standings, hubContext?.team_id],
  );
  const placeholder = homeScoresArePlaceholder(scoring, hubContext);
  const matchupNote = homeMatchupNote(scoring, matchOpponent);
  const scoreMode = homeScoreMode(scoring);
  const viewerStanding = standingsView.standings.find(row => String(row.hub_team_id || "") === String(hubContext?.team_id || ""));
  const identityTeam = (team) => ({
    id: team?.hub_team_id || team?.roster_id,
    name: team?.team_name,
    owner_name: team?.owner_name,
  });

  return (
    <HubPage className={`hub-league-home hub-home-page${mobileLayout ? " hub-league-home--mobile" : ""}`}>
      {error && <HubAlert variant="danger">{error}</HubAlert>}
      <header className="hub-home-phase-header">
        <nav className="hub-home-phases" aria-label="League season stage">
          {phaseTrack.map(item => <span key={item.id} aria-current={item.current ? "step" : undefined}><i aria-hidden="true" />{item.label}</span>)}
        </nav>
        {!mobileLayout && goSetup ? <button type="button" className="btn-ghost btn-sm" onClick={goSetup}>{HOME_PAGE_COPY.settings}</button> : null}
      </header>
      <div className="hub-home-layout">
        <div className="hub-home-main">
          {loading && !data ? <section className="hub-home-card" aria-busy="true">
            <HubLoadingSkeleton label={HOME_PAGE_COPY.loadingKicker} rows={3} />
            {slowLoad && onLeagueSync && leagueId ? <button className="btn-link" onClick={() => onLeagueSync(leagueId)}>{HOME_PAGE_COPY.syncLeague}</button> : null}
          </section> : showPriority && data ? <section className="hub-home-card hub-home-next">
            <p className="chart-note">{phase.label}</p><h2>{focus.title}</h2>
            {focus.detail ? <p className="hub-home-muted">{focus.detail}</p> : null}
            {focus.view && onNavigate ? <button type="button" className="btn-primary" onClick={() => onNavigate(focus.view)}>{focus.label} <span aria-hidden="true">→</span></button> : null}
            {pendingCuts && onNavigate ? <button type="button" className="btn-link" onClick={() => onNavigate("roster")}>{HOME_PAGE_COPY.undoCut}</button> : null}
            {phase.id === "pre_draft" ? <dl className="hub-home-context">
              {cap.uses_salaries !== false && cap.salary_cap != null ? <div><dt>{HOME_PAGE_COPY.draftLeftover}</dt><dd>{fmtCap(data?.pre_draft?.draft_budget_available ?? cap.remaining)}</dd></div> : null}
              <div><dt>{HOME_PAGE_COPY.seatsFilled}</dt><dd>{data?.seating?.team_count != null && data?.seating?.open_seats != null ? data.seating.team_count - data.seating.open_seats : "—"} / {data?.seating?.team_count ?? "—"}</dd></div>
            </dl> : null}
          </section> : null}
          {phase.id === "pre_draft" && data ? <section className="hub-home-card hub-home-draft-night">
            <h2>{HOME_PAGE_COPY.draftNight}</h2><p className="chart-note">{draftDate || HOME_PAGE_COPY.notScheduled}</p>
            {onNavigate ? <button type="button" className="btn-ghost" onClick={() => onNavigate("room")}>{HOME_PAGE_COPY.openDraft}</button> : null}
          </section> : null}
          {scoringError ? <HubAlert variant="warn">{scoringError}</HubAlert> : null}
          {deckMode.show && leagueId && matchup && matchViewer && matchOpponent && (!deckMode.historical || Number(matchViewer.points) > 0 || Number(matchOpponent.points) > 0) ? <section className="hub-home-card hub-home-matchup" aria-label={HOME_DECK_COPY.matchupTitle}>
            <div className="hub-home-card-heading"><h2>{deckMode.historical ? HOME_PAGE_COPY.lastSeason : HOME_DECK_COPY.matchupTitle}</h2><p className="chart-note">{matchupNote}</p></div>
            <div className="hub-home-scoreboard">{[matchViewer, matchOpponent].map((team, index) => {
              const parts = gameCenterTeamParts(team);
              const record = standingsView.standings.find(row => (team.hub_team_id && String(row.hub_team_id) === String(team.hub_team_id)) || String(row.roster_id) === String(team.roster_id));
              return <React.Fragment key={team.roster_id || index}>{index === 1 ? <span className="chart-note">{HOME_DECK_COPY.versus}</span> : null}<div className="hub-home-score-team">
                <TeamIdentityMark team={identityTeam(team)} identity={identityFor(identities, identityTeam(team))} size="lg" />
                <span className="hub-home-score-name">{parts.owner || parts.team || team.team_name}{team.is_viewer ? ` · ${HOME_DECK_COPY.you}` : ""}</span>
                {record ? <span className="chart-note" aria-label={`${HOME_DECK_COPY.record}: ${formatStandingRecord(record)}`}>{formatStandingRecord(record)}</span> : null}
                <strong className="hub-home-score">{formatHomeScore(team, placeholder, scoreMode)}</strong><span className="chart-note">{scoreMode === "projected" ? HOME_DECK_COPY.projectedPoints : HOME_DECK_COPY.weekPoints}</span>
              </div></React.Fragment>;
            })}</div>
            {onNavigate ? <button type="button" className="btn-ghost hub-home-game-link" onClick={() => onNavigate("game", { matchupWeek: scoring?.week })}>{HOME_DECK_COPY.openGame} <span aria-hidden="true">→</span></button> : null}
          </section> : null}
          {phase.id === "in_season" && leagueId && !matchup && !scoringError ? <section className="hub-home-card">
            {!scoring ? <HubLoadingSkeleton label={HOME_PAGE_COPY.matchupLoading} rows={3} /> : <><h2>{HOME_DECK_COPY.matchupTitle}</h2><p className="hub-home-muted">{HOME_PAGE_COPY.matchupEmpty}</p></>}
          </section> : null}
        </div>
        {leagueId ? <aside className="hub-home-rail" aria-label={HOME_DECK_COPY.leagueActivity}>
          <HubSection disclosure className="hub-home-chat" title={HOME_DECK_COPY.lockerTitle} hint={HOME_DECK_COPY.chatHint} icon={<HomeIcon kind="chat" />} defaultOpen={!mobileLayout} onToggle={event => { if (event.currentTarget.open) setChatMounted(true); }}>
            {chatMounted ? <LeagueChat key={leagueId} leagueId={leagueId} hubContext={hubContext} home /> : null}
          </HubSection>
          {deckMode.show && standingRows.length ? <HubSection disclosure title={HOME_DECK_COPY.standingsTitle} hint={viewerStanding ? `${formatStandingRank(viewerStanding, { ranked: standingsView.ranked })} · ${formatStandingRecord(viewerStanding)}` : HOME_DECK_COPY.standingsNote} icon={<HomeIcon kind="standings" />}>
            <ol className="hub-home-standing-list">{standingRows.map((row,index) => {
              const parts = gameCenterTeamParts(row);
              return <React.Fragment key={row.roster_id}>{homeStandingHasGap(standingRows[index-1],row) ? <li aria-hidden="true">···</li> : null}<li><span>{formatStandingRank(row, { ranked: standingsView.ranked })} · {parts.owner || parts.team || row.team_name}</span><strong>{formatStandingRecord(row)}</strong></li></React.Fragment>;
            })}</ol>
          </HubSection> : null}
        </aside> : null}
        {supportingActions.length ? <HubSection disclosure className="hub-home-attention" title={HOME_PAGE_COPY.supportingTitle} icon={<HomeIcon kind="attention" />}>
          <ol className="hub-home-action-list">{supportingActions.map(action => <ActionRow key={action.id} action={action} onNavigate={onNavigate} />)}</ol>
        </HubSection> : null}
      </div>
    </HubPage>
  );
}

function HomeIcon({ kind }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    {kind === "chat" ? <path d="M5 5h14v10H9l-4 4V5ZM9 9h6M9 12h4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /> : kind === "standings" ? <path d="M4 19v-8h4v8M10 19V5h4v14M16 19v-5h4v5" stroke="currentColor" strokeWidth="1.8" /> : <><circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" /><path d="M12 7v6m0 3v1" stroke="currentColor" strokeWidth="1.8" /></>}
  </svg>;
}
