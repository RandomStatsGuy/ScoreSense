import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import useFantasyReady from "../useFantasyReady";
import { connectionErrorMessage, parseApiError } from "../format";
import { isAbortError } from "../fetchAbort";
import useMobileLayout from "../useMobileLayout";
import { HubAlert, HubLoadingSkeleton, HubPage, HubSection } from "./HubUILayout";
import LeagueChat from "./LeagueChat";
import TeamIdentityMark from "./TeamIdentityMark";
import MatchupBannerArt from "./MatchupBannerArt";
import { identityFor, useTeamIdentities } from "./TeamIdentityContext";
import {
  findViewerMatchup,
  formatStandingRank,
  formatStandingRecord,
  gameCenterTeamParts,
  interpretStandings,
  matchupTeams,
} from "./gameCenterPresentation";
import "../styles/fantasy-home.css";
import {
  actionLabel,
  HOME_DECK_COPY,
  HOME_PAGE_COPY,
  homeDeckMode,
  homeDeckStandingRows,
  homeHasPendingCuts,
  homeStandingHasGap,
  homeAlsoDueMessage,
  phaseTrackState,
  resolveLeagueHomeFocus,
  homeAttentionActions,
  homeShowsPriority,
  homeScoresArePlaceholder,
  homeMatchupDisplay,
  homeStandingPoints,
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
  const [scoringLoading, setScoringLoading] = useState(true);
  const [allStandings, setAllStandings] = useState(false);
  useFantasyReady("home", "home-data", Boolean(data) && !loading);
  useFantasyReady("home", "matchup", Boolean(data && scoring) && !loading);
  const [scoringError, setScoringError] = useState("");
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
    setScoringLoading(true);
    setAllStandings(false);
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
    if (!leagueId) { setScoring(null); setScoringLoading(false); return undefined; }
    const ctrl = new AbortController();
    setScoringLoading(true);
    setScoringError("");
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
      } finally {
        if (!ctrl.signal.aborted) setScoringLoading(false);
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
    () => homeDeckStandingRows(standingsView.standings, hubContext?.team_id, allStandings ? standingsView.standings.length : 5),
    [standingsView.standings, hubContext?.team_id, allStandings],
  );
  const placeholder = homeScoresArePlaceholder(scoring, hubContext);
  const matchDisplay = homeMatchupDisplay(scoring, matchViewer, matchOpponent, placeholder);
  const showDeck = Boolean(data && deckMode.show && leagueId);
  const showMatchup = showDeck && matchup && matchViewer && matchOpponent
    && (!deckMode.historical || Number(matchViewer.points) > 0 || Number(matchOpponent.points) > 0);
  const teamRecord = (team) => {
    const row = standingsView.standings.find(item =>
      (team?.hub_team_id && String(item.hub_team_id) === String(team.hub_team_id))
      || (team?.roster_id != null && String(item.roster_id) === String(team.roster_id)));
    return row ? formatStandingRecord(row) : "";
  };
  const identityTeam = (team) => ({
    id: team?.hub_team_id || team?.roster_id,
    name: team?.team_name,
    owner_name: team?.owner_name,
  });

  return (
    <HubPage className={`hub-league-home hub-home-page hub-home--clubhouse${mobileLayout ? " hub-league-home--mobile" : ""}`}>
      {error && <HubAlert variant="danger">{error}</HubAlert>}
      <header className="hub-home-phase-header">
        <nav className="hub-home-phases" aria-label="League season stage">
          {phaseTrack.map(item => <span key={item.id} aria-current={item.current ? "step" : undefined}><i aria-hidden="true" />{item.label}</span>)}
        </nav>
        {!mobileLayout && goSetup ? <button type="button" className="btn-ghost btn-sm" onClick={goSetup}>{HOME_PAGE_COPY.settings}</button> : null}
      </header>

      <div className="hub-home-clubhouse">
        {loading && !data ? (
          <section className="hub-home-feature" aria-busy="true">
            <HubLoadingSkeleton label={HOME_PAGE_COPY.loadingKicker} rows={3} />
            {slowLoad && <p className="chart-note">{HOME_PAGE_COPY.loadingFallback}</p>}
            {slowLoad && leagueId && (onLeagueSync || onNavigate) && <button type="button" className="btn-link" onClick={() => onLeagueSync ? onLeagueSync(leagueId) : onNavigate("setup")}>{HOME_PAGE_COPY.syncLeague}</button>}
          </section>
        ) : data && showPriority ? (
          <section className="hub-home-feature hub-home-preparation">
            <p className="hub-experience-kicker">{phase.label}</p>
            <h2>{focus.title}</h2>
            <p>{focus.detail}</p>
            <div className="hub-home-preparation-actions">
              {focus.view && onNavigate && <button type="button" className="btn-primary" onClick={() => onNavigate(focus.view)}>{focus.label} <span aria-hidden="true">→</span></button>}
              {pendingCuts && onNavigate && <button type="button" className="btn-link" onClick={() => onNavigate("roster")}>{HOME_PAGE_COPY.undoCut}</button>}
            </div>
            {phase.id === "pre_draft" && <dl className="hub-home-preparation-context">
              {cap.uses_salaries !== false && cap.salary_cap != null && <div><dt>{HOME_PAGE_COPY.draftLeftover}</dt><dd>{fmtCap(data?.pre_draft?.draft_budget_available ?? cap.remaining)}</dd></div>}
              <div><dt>{HOME_PAGE_COPY.seatsFilled}</dt><dd>{data?.seating?.team_count != null && data?.seating?.open_seats != null ? data.seating.team_count - data.seating.open_seats : "—"} / {data?.seating?.team_count ?? "—"}</dd></div>
              <div><dt>{HOME_PAGE_COPY.draftNight}</dt><dd>{draftDate || (onNavigate ? <button type="button" className="btn-link" onClick={() => onNavigate("room")}>{HOME_PAGE_COPY.notScheduled}</button> : HOME_PAGE_COPY.notScheduled)}</dd></div>
            </dl>}
          </section>
        ) : null}

        {scoringError && showMatchup && <HubAlert variant="warn">{scoringError}</HubAlert>}
        {showMatchup ? (
          <section className="hub-home-feature hub-home-matchup" aria-labelledby="home-matchup-title">
            <div className="hub-home-matchup-art" aria-hidden="true">
              <MatchupBannerArt identity={identityFor(identities, identityTeam(matchViewer))} side="home" />
              <MatchupBannerArt identity={identityFor(identities, identityTeam(matchOpponent))} side="away" />
            </div>
            <header className="hub-home-matchup-head">
              <div><p className="hub-experience-kicker">{[scoring?.season, scoring?.week != null ? `Week ${scoring.week}` : null].filter(Boolean).join(" · ")}</p><h2 id="home-matchup-title">{deckMode.historical ? HOME_PAGE_COPY.lastSeason(placeholder ? null : scoring?.season) : HOME_DECK_COPY.matchupTitle}</h2></div>
              <span className={`hub-home-matchup-status${matchDisplay.live ? " is-live" : ""}`}>{matchDisplay.status}</span>
            </header>
            <div className="hub-home-matchup-scoreboard">
              {[matchViewer, matchOpponent].map((team, index) => {
                const parts = gameCenterTeamParts(team);
                const record = teamRecord(team);
                return <React.Fragment key={team.hub_team_id || team.roster_id || index}>
                  {index === 1 && <span className="hub-home-matchup-vs">{HOME_DECK_COPY.versus}</span>}
                  <div className={`hub-home-matchup-team${index === 0 ? " is-you" : ""}`}>
                    <div className="hub-home-matchup-identity">
                      <TeamIdentityMark team={identityTeam(team)} identity={identityFor(identities, identityTeam(team))} size="lg" />
                      <div className="hub-home-matchup-person"><strong>{parts.owner || parts.team}{index === 0 && <small> · {HOME_DECK_COPY.you}</small>}</strong><span className="hub-home-matchup-nickname">{parts.owner && parts.team ? parts.team : ""}</span><span>{record}{record && standingsView.historical ? ` · ${standingsView.note}` : ""}</span></div>
                    </div>
                    <div className="hub-home-matchup-value"><strong>{index === 0 ? matchDisplay.home : matchDisplay.away}</strong><span>{matchDisplay.unit}</span></div>
                  </div>
                </React.Fragment>;
              })}
            </div>
            <footer className="hub-home-matchup-footer"><p>{matchDisplay.note}<span>{matchDisplay.support}</span></p><div className="hub-home-matchup-actions">{onNavigate && <><button type="button" className="btn-ghost btn-sm" onClick={() => onNavigate("week")}>{HOME_DECK_COPY.openWeek} <span aria-hidden="true">↗</span></button><button type="button" className="btn-ghost btn-sm" onClick={() => onNavigate("game", { matchupWeek: scoring?.week })}>{HOME_DECK_COPY.gameCenter} <span aria-hidden="true">↗</span></button></>}</div></footer>
          </section>
        ) : !showPriority && data && leagueId ? (
          <section className="hub-home-feature" aria-busy={scoringLoading}>
            {scoringLoading ? <HubLoadingSkeleton label={HOME_DECK_COPY.loadingMatchup} rows={3} /> : <HubAlert variant={scoringError ? "warn" : "info"} action={onNavigate ? <button type="button" className="btn-ghost btn-sm" onClick={() => onNavigate("game", { matchupWeek: scoring?.week })}>{HOME_DECK_COPY.openGame}</button> : null}>{scoringError ? HOME_PAGE_COPY.matchupUnavailable : HOME_DECK_COPY.noMatchup}</HubAlert>}
          </section>
        ) : null}

        {leagueId && <HomeDisclosure className="hub-home-conversation" title={HOME_DECK_COPY.lockerTitle} note={HOME_DECK_COPY.lockerNote} icon="chat"><LeagueChat key={leagueId} leagueId={leagueId} hubContext={hubContext} home /></HomeDisclosure>}

        {showDeck && standingRows.length > 0 && <HomeDisclosure className="hub-home-standings-card" title={HOME_DECK_COPY.standingsTitle} note={standingsView.note} icon="standings">
          <table className="hub-home-standings-table"><thead><tr><th scope="col">#</th><th scope="col">{HOME_DECK_COPY.manager}</th><th className="num" scope="col">{HOME_DECK_COPY.record}</th><th className="num" scope="col">{HOME_DECK_COPY.pointsFor}</th></tr></thead><tbody>
            {standingRows.map((row, index) => {
              const parts = gameCenterTeamParts(row);
              const mine = row.hub_team_id && String(row.hub_team_id) === String(hubContext?.team_id);
              return <React.Fragment key={row.roster_id || row.hub_team_id || index}>
                {homeStandingHasGap(standingRows[index - 1], row) && <tr className="hub-home-standings-gap"><td colSpan="4" aria-label="Other managers">···</td></tr>}
                <tr className={mine ? "is-you" : ""}><td className="num">{formatStandingRank(row, { ranked: standingsView.ranked })}</td><td><strong>{parts.owner || parts.team}</strong>{mine && <small> · {HOME_DECK_COPY.you}</small>}</td><td className="num">{formatStandingRecord(row)}</td><td className="num">{homeStandingPoints(row)}</td></tr>
              </React.Fragment>;
            })}
          </tbody></table>
          {standingsView.standings.length > 5 && <button type="button" className="btn-link hub-home-all-standings" aria-expanded={allStandings} onClick={() => setAllStandings(value => !value)}>{allStandings ? HOME_DECK_COPY.standingsLess : HOME_DECK_COPY.standingsAll} <span aria-hidden="true">{allStandings ? "−" : "+"}</span></button>}
        </HomeDisclosure>}

        {!loading && !error && supportingActions.length > 0 && <HomeDisclosure className="hub-home-attention" title={HOME_DECK_COPY.needsAttention} icon="attention"><ol className="hub-home-action-list">{supportingActions.map(action => <ActionRow key={action.id} action={action} onNavigate={onNavigate} />)}</ol></HomeDisclosure>}
      </div>
    </HubPage>
  );
}

function HomeDisclosure({ className, title, note, icon, children }) {
  return <HubSection disclosure className={`hub-home-section ${className}`} title={title} hint={note} icon={<HomeIcon kind={icon} />} defaultOpen>{children}</HubSection>;
}

function HomeIcon({ kind }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    {kind === "chat" ? <path d="M5 5h14v10H9l-4 4V5ZM9 9h6M9 12h4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /> : kind === "standings" ? <path d="M4 19v-8h4v8M10 19V5h4v14M16 19v-5h4v5" stroke="currentColor" strokeWidth="1.8" /> : <><circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" /><path d="M12 7v6m0 3v1" stroke="currentColor" strokeWidth="1.8" /></>}
  </svg>;
}
