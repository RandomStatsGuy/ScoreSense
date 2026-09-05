import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, formatRelativeTime, parseApiError } from "../format";
import { isAbortError } from "../fetchAbort";
import useMobileLayout from "../useMobileLayout";
import { HubAlert, HubPage } from "./HubUILayout";
import LeagueChat from "./LeagueChat";
import TeamIdentityMark from "./TeamIdentityMark";
import { identityFor, useTeamIdentities } from "./TeamIdentityContext";
import { findViewerMatchup, gameCenterTeamParts, matchupTeams } from "./gameCenterPresentation";
import { hubTeamLabel } from "./hubTeamLabel";
import {
  actionLabel,
  formatHomeScore,
  HOME_DECK_COPY,
  HOME_PAGE_COPY,
  homeDeckMode,
  homeDeckStandingRows,
  homeHasPendingCuts,
  homeHeroHeading,
  homeHeroSupport,
  homeMatchupNote,
  phaseTrackState,
  resolveLeagueHomeFocus,
  supportingLeagueHomeActions,
} from "./leagueHomePresentation";
import { getHomeCache, homeCacheKey, setHomeCache } from "./hubDataCache";

/** Valid Hub subview targets returned by `/api/hub/home` actions / primary CTA. */
const HUB_ACTION_VIEWS = new Set([
  "setup",
  "planner",
  "roster",
  "week",
  "office",
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
  const href = HUB_ACTION_VIEWS.has(action?.href) ? action.href : null;
  return (
    <li className={`hub-home-action hub-home-action--${severityVariant(action?.severity)}`}>
      <div className="hub-home-action-main">
        <p className="hub-home-action-message">{action.message}</p>
        {action.count != null && (
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
  const [slowLoad, setSlowLoad] = useState(false);
  const [prevCacheKey, setPrevCacheKey] = useState(cacheKey);
  if (cacheKey !== prevCacheKey) {
    setPrevCacheKey(cacheKey);
    const cached = getHomeCache(cacheKey);
    setData(cached?.data || null);
    setLoading(!cached?.data);
    setError("");
    setScoring(null);
    setSlowLoad(false);
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
      // include_week=true so in-season action center can surface lineup decisions.
      const res = await apiFetch("/api/hub/home?include_week=true", { signal });
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
    if (!leagueId) {
      setScoring(null);
      return undefined;
    }
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await apiFetch(
          `/api/hub/league/${encodeURIComponent(leagueId)}/live-scoring`,
          { signal: ctrl.signal },
        );
        if (res.ok) setScoring(await res.json());
      } catch {
        /* deck stays hidden if scoring cannot load */
      }
    })();
    return () => ctrl.abort();
  }, [leagueId, reloadToken]);

  const phase = data?.phase || {};
  const primaryCta = phase.primary_cta || null;
  const actions = data?.actions || [];
  const cap = data?.cap || {};
  const weekSummary = data?.week_summary || {};
  const freshness = data?.freshness || {};
  const focus = resolveLeagueHomeFocus({
    actions,
    primaryCta,
    defaultView: data?.checklist?.default_view,
    validViews: HUB_ACTION_VIEWS,
  });
  const supportingActions = supportingLeagueHomeActions(actions, focus);
  const phaseTrack = phaseTrackState(phase.id);
  const phaseCtaView = primaryCta?.view && HUB_ACTION_VIEWS.has(primaryCta.view)
    ? primaryCta.view
    : null;
  const showPhaseCta = phaseCtaView && phaseCtaView !== focus.view;
  const pendingCuts = homeHasPendingCuts(data);
  const deckMode = homeDeckMode({
    phaseId: phase.id,
    draftCompleted: hubContext?.draft_completed ?? data?.hub_context?.draft_completed,
    scoring,
  });

  const projBuilt = freshness.projections?.built_at;
  const projDays = freshness.projections?.days_old;
  const draftDate = formatDraftDate(data?.draft_schedule);

  const goSetup = onNavigateSetup || (onNavigate ? () => onNavigate("setup") : null);

  const matchup = useMemo(() => findViewerMatchup(scoring), [scoring]);
  const { viewer: matchViewer, opponent: matchOpponent } = useMemo(
    () => matchupTeams(matchup),
    [matchup],
  );
  const standingRows = useMemo(
    () => homeDeckStandingRows(scoring?.standings || [], hubContext?.team_id),
    [scoring?.standings, hubContext?.team_id],
  );
  const showDeck = Boolean(deckMode.show && leagueId && (matchup || standingRows.length));
  const placeholder = Boolean(scoring?.placeholder);
  const matchupNote = homeMatchupNote(scoring, matchOpponent);
  const identityTeam = (team) => ({
    id: team?.hub_team_id || team?.roster_id,
    name: team?.team_name,
    owner_name: team?.owner_name,
  });

  return (
    <HubPage className={`hub-league-home${mobileLayout ? " hub-league-home--mobile" : ""}`}>
      {error && <div className="error">{error}</div>}
      <header className="hub-home-heading">
        <div>
          <p className="hub-experience-kicker">{HOME_PAGE_COPY.kicker}</p>
          <h2>{loading && !data ? HOME_PAGE_COPY.loadingHeading : homeHeroHeading(data)}</h2>
          {!loading && data ? (
            <p className="chart-note">{homeHeroSupport(data)}</p>
          ) : null}
        </div>
        <div className="hub-home-heading-actions">
          {goSetup ? (
            <button type="button" className="btn-ghost btn-sm" onClick={goSetup}>
              Settings
            </button>
          ) : null}
        </div>
      </header>

      <nav className="hub-home-phase-track" aria-label="League season stage">
        {phaseTrack.map((item) => (
          <span
            key={item.id}
            className={`hub-home-phase-step${item.current ? " is-current" : ""}`}
            aria-current={item.current ? "step" : undefined}
          >
            <span className="hub-home-phase-dot" aria-hidden="true" />
            {item.label}
          </span>
        ))}
      </nav>

      <div className="hub-home-club">
      <div className="hub-home-club-main">
      <div className="hub-home-stage">
        <section className={`hub-home-priority hub-home-priority--${focus.kind}`} aria-busy={loading}>
          <p className="hub-home-priority-kicker">
            {loading && !data ? HOME_PAGE_COPY.loadingKicker : (phase.label || "Right now")}
          </p>
          <h3>{loading && !data ? HOME_PAGE_COPY.loadingHeading : focus.title}</h3>
          <p className="hub-home-priority-copy">
            {loading && !data
              ? (slowLoad ? HOME_PAGE_COPY.loadingFallback : HOME_PAGE_COPY.loadingSupport)
              : focus.detail}
          </p>
          {loading && !data && slowLoad ? (
            <div className="hub-home-priority-actions">
              {onLeagueSync && leagueId ? (
                <button type="button" className="btn-link" onClick={() => onLeagueSync(leagueId)}>
                  Sync league
                </button>
              ) : onNavigate ? (
                <button type="button" className="btn-link" onClick={() => onNavigate("setup")}>
                  Sync league
                </button>
              ) : null}
            </div>
          ) : null}
          {!loading && (
            <div className="hub-home-priority-actions">
              {focus.view && onNavigate ? (
                <button type="button" className="btn-primary" onClick={() => onNavigate(focus.view)}>
                  {focus.label} <span aria-hidden="true">→</span>
                </button>
              ) : null}
              {pendingCuts && onNavigate ? (
                <button type="button" className="btn-link" onClick={() => onNavigate("roster")}>
                  {HOME_PAGE_COPY.undoCut}
                </button>
              ) : showPhaseCta && onNavigate ? (
                <button type="button" className="btn-link" onClick={() => onNavigate(phaseCtaView)}>
                  {primaryCta.label}
                </button>
              ) : null}
            </div>
          )}
        </section>

        <aside className="hub-home-snapshot" aria-label="League snapshot">
          <div className="hub-home-snapshot-head">
            <p className="hub-experience-kicker">At a glance</p>
            <span>{hubTeamLabel({
              name: hubContext?.team_name,
              sleeper_team_name: hubContext?.sleeper_team_name,
              owner_name: hubContext?.owner_name,
            }) || "Your team"}</span>
          </div>
          <dl className="hub-home-snapshot-list">
            <div>
              <dt>Cap room</dt>
              <dd className={Number(cap.remaining) < 0 ? "is-danger" : ""}>{fmtCap(cap.remaining)}</dd>
              <span>{cap.salary_cap != null ? `${fmtCap(cap.spent)} committed` : "No cap loaded"}</span>
            </div>
            <div>
              <dt>{weekSummary.available ? `Week ${weekSummary.week}` : "Draft night"}</dt>
              <dd>
                {weekSummary.available
                  ? (weekSummary.headline || "Ready")
                  : (draftDate || (
                    onNavigate ? (
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => onNavigate("room")}
                      >
                        {HOME_PAGE_COPY.notScheduled}
                      </button>
                    ) : HOME_PAGE_COPY.notScheduled
                  ))}
              </dd>
            </div>
            <div>
              <dt>Projections</dt>
              <dd>
                {projBuilt
                  ? (formatRelativeTime(projBuilt) || "Available")
                  : (freshness.projections?.available === false ? "Unavailable" : "Checking…")}
              </dd>
              {projDays != null ? <span>{projDays} day{projDays === 1 ? "" : "s"} old</span> : null}
            </div>
          </dl>
        </aside>
      </div>

      {showDeck ? (
        <div className="hub-home-deck">
          {placeholder ? (
            <HubAlert
              variant="info"
              action={goSetup ? (
                <button type="button" className="btn-ghost btn-sm" onClick={goSetup}>
                  Open Setup
                </button>
              ) : null}
            >
              {scoring?.hint || HOME_DECK_COPY.linkSleeper}
            </HubAlert>
          ) : null}
          {matchup && matchViewer && matchOpponent ? (
            <section className="hub-home-deck-card" aria-label={HOME_DECK_COPY.matchupTitle}>
              <header className="hub-home-deck-head">
                <h3>{deckMode.historical ? HOME_PAGE_COPY.lastSeason : HOME_DECK_COPY.matchupTitle}</h3>
                <span className="chart-note">{deckMode.historical ? HOME_PAGE_COPY.lastSeason : matchupNote}</span>
              </header>
              {[matchViewer, matchOpponent].map((team) => {
                const parts = gameCenterTeamParts(team);
                return (
                <div className="hub-home-mu-row" key={team.roster_id || team.team_name}>
                  <TeamIdentityMark
                    team={identityTeam(team)}
                    identity={identityFor(identities, identityTeam(team))}
                    size="sm"
                  />
                  <span className="hub-home-mu-name">
                    {parts.owner || parts.team || team.team_name}
                    {parts.owner && parts.team ? (
                      <span className="hub-gc-team-nick">{parts.team}</span>
                    ) : null}
                  </span>
                  <span className="hub-home-mu-score">{formatHomeScore(team, placeholder)}</span>
                </div>
                );
              })}
              {onNavigate ? (
                <button type="button" className="btn-ghost btn-sm" onClick={() => onNavigate("game")}>
                  {HOME_DECK_COPY.openGame} <span aria-hidden="true">→</span>
                </button>
              ) : null}
            </section>
          ) : null}
          {standingRows.length > 0 ? (
            <section className="hub-home-deck-card" aria-label={HOME_DECK_COPY.standingsTitle}>
              <header className="hub-home-deck-head">
                <h3>{deckMode.historical ? HOME_PAGE_COPY.lastSeason : HOME_DECK_COPY.standingsTitle}</h3>
                <span className="chart-note">{deckMode.historical ? HOME_PAGE_COPY.lastSeason : HOME_DECK_COPY.standingsNote}</span>
              </header>
              <ol className="hub-home-standings">
                {standingRows.map((row) => {
                  const parts = gameCenterTeamParts(row);
                  return (
                  <li
                    key={row.roster_id}
                    className={row.hub_team_id && String(row.hub_team_id) === String(hubContext?.team_id) ? "is-you" : ""}
                  >
                    <span className="hub-home-standing-rank">{row.rank}</span>
                    <span className="hub-home-standing-name">
                      {parts.owner || parts.team || row.team_name}
                      {parts.owner && parts.team ? (
                        <span className="hub-gc-team-nick">{parts.team}</span>
                      ) : null}
                    </span>
                    <span className="hub-home-standing-rec">
                      {row.wins}–{row.losses}{row.ties ? `–${row.ties}` : ""}
                    </span>
                  </li>
                  );
                })}
              </ol>
            </section>
          ) : null}
        </div>
      ) : null}

      {supportingActions.length > 0 ? (
        <section className="hub-home-supporting" aria-labelledby="hub-home-supporting-title">
          <header>
            <div>
              <p className="hub-experience-kicker">After that</p>
              <h3 id="hub-home-supporting-title">{HOME_PAGE_COPY.supportingTitle}</h3>
            </div>
          </header>
          <ol className="hub-home-action-list">
            {supportingActions.map((action) => (
              <ActionRow key={action.id} action={action} onNavigate={onNavigate} />
            ))}
          </ol>
        </section>
      ) : null}
      </div>
      {leagueId ? (
        <aside className="hub-home-locker" aria-label={HOME_DECK_COPY.lockerTitle}>
          <header className="hub-home-locker-head">
            <p className="hub-experience-kicker">{HOME_DECK_COPY.lockerKicker}</p>
            <h3>{HOME_DECK_COPY.lockerTitle}</h3>
            <p className="chart-note">{HOME_DECK_COPY.lockerNote}</p>
          </header>
          <LeagueChat leagueId={leagueId} hubContext={hubContext} />
        </aside>
      ) : null}
      </div>
    </HubPage>
  );
}
