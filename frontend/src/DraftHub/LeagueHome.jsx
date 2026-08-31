import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, formatRelativeTime, parseApiError } from "../format";
import { isAbortError } from "../fetchAbort";
import useMobileLayout from "../useMobileLayout";
import { HubPage } from "./HubUILayout";
import TeamIdentityMark from "./TeamIdentityMark";
import { identityFor, useTeamIdentities } from "./TeamIdentityContext";
import {
  findViewerMatchup,
  formatWinProb,
  matchupTeams,
  winProbFor,
} from "./gameCenterPresentation";
import {
  actionLabel,
  phaseTrackState,
  pulseEventLine,
  resolveLeagueHomeFocus,
  supportingLeagueHomeActions,
} from "./leagueHomePresentation";

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
 * Consumes GET /api/hub/home — no live Sleeper on load.
 */
export default function LeagueHome({
  hubContext,
  reloadToken = 0,
  onNavigate,
  onNavigateSetup,
  onCreateLeague,
}) {
  const mobileLayout = useMobileLayout();
  const { identities } = useTeamIdentities();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scoring, setScoring] = useState(null);
  const [pulse, setPulse] = useState(null);

  const leagueId = hubContext?.mode === "league" ? hubContext?.league_id : null;

  /** Deck data (matchup / standings / pulse) is additive — it must never block
   *  or error the action center, so failures just leave the cards hidden. */
  useEffect(() => {
    if (!leagueId) {
      setScoring(null);
      setPulse(null);
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
      } catch { /* deck card stays hidden */ }
    })();
    (async () => {
      try {
        const res = await apiFetch(
          `/api/hub/league/${encodeURIComponent(leagueId)}/pulse`,
          { signal: ctrl.signal },
        );
        if (res.ok) setPulse(await res.json());
      } catch { /* deck card stays hidden */ }
    })();
    return () => ctrl.abort();
  }, [leagueId, reloadToken]);

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    try {
      // include_week=true so in-season action center can surface lineup decisions.
      const res = await apiFetch("/api/hub/home?include_week=true", { signal });
      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      if (!signal?.aborted) setData(payload);
    } catch (e) {
      if (isAbortError(e) || signal?.aborted) return;
      setError(connectionErrorMessage(e));
      setData(null);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

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

  const projBuilt = freshness.projections?.built_at;
  const projDays = freshness.projections?.days_old;
  const draftDate = formatDraftDate(data?.draft_schedule);

  const goSetup = onNavigateSetup || (onNavigate ? () => onNavigate("setup") : null);

  const matchup = useMemo(() => findViewerMatchup(scoring), [scoring]);
  const { viewer: matchViewer, opponent: matchOpponent } = useMemo(
    () => matchupTeams(matchup),
    [matchup],
  );
  const matchProb = matchup && matchViewer ? winProbFor(matchup, matchViewer) : null;
  const standings = scoring?.standings || [];
  const lastSeasonScoring = Boolean(
    scoring?.season
    && hubContext?.season
    && String(scoring.season) !== String(hubContext.season),
  );
  const standingRows = useMemo(() => {
    if (!standings.length) return [];
    const top = standings.slice(0, 5);
    const mine = standings.find(
      (row) => row.hub_team_id && String(row.hub_team_id) === String(hubContext?.team_id),
    );
    if (mine && !top.includes(mine)) {
      return [...top.slice(0, 4), mine];
    }
    return top;
  }, [standings, hubContext?.team_id]);
  const pulseEvents = (pulse?.events || []).slice(0, 4);
  const showDeck = Boolean(leagueId && (matchup || standingRows.length || pulseEvents.length));

  const identityTeam = (team) => ({
    id: team?.hub_team_id || team?.roster_id,
    name: team?.team_name,
  });

  return (
    <HubPage className={`hub-league-home${mobileLayout ? " hub-league-home--mobile" : ""}`}>
      {error && <div className="error">{error}</div>}
      <header className="hub-home-heading">
        <div>
          <p className="hub-experience-kicker">League command center</p>
          <h2>Make the next decision count.</h2>
        </div>
        <div className="hub-home-heading-actions">
          {onCreateLeague ? (
            <button type="button" className="btn-primary btn-sm" onClick={onCreateLeague}>
              New league
            </button>
          ) : null}
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

      <div className="hub-home-stage">
        <section className={`hub-home-priority hub-home-priority--${focus.kind}`} aria-busy={loading}>
          <p className="hub-home-priority-kicker">
            {loading && !data ? "Reading your league" : (phase.label || "Right now")}
          </p>
          <h3>{loading && !data ? "Finding the move that matters…" : focus.title}</h3>
          <p className="hub-home-priority-copy">
            {loading && !data
              ? "Checking deadlines, contracts, cap, and lineup signals."
              : focus.detail}
          </p>
          {!loading && (
            <div className="hub-home-priority-actions">
              {focus.view && onNavigate ? (
                <button type="button" className="btn-primary" onClick={() => onNavigate(focus.view)}>
                  {focus.label} <span aria-hidden="true">→</span>
                </button>
              ) : null}
              {showPhaseCta && onNavigate ? (
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
            <span>{hubContext?.team_name || "Your team"}</span>
          </div>
          <dl className="hub-home-snapshot-list">
            <div>
              <dt>Cap room</dt>
              <dd className={Number(cap.remaining) < 0 ? "is-danger" : ""}>{fmtCap(cap.remaining)}</dd>
              <span>{cap.salary_cap != null ? `${fmtCap(cap.spent)} committed` : "No cap loaded"}</span>
            </div>
            <div>
              <dt>{weekSummary.available ? `Week ${weekSummary.week}` : "Draft night"}</dt>
              <dd>{weekSummary.available ? (weekSummary.headline || "Ready") : (draftDate || "Not scheduled")}</dd>
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

      {showDeck && (
        <div className="hub-home-deck">
          {matchup && matchViewer && matchOpponent && (
            <section className="hub-home-deck-card" aria-label="Your matchup">
              <header className="hub-home-deck-head">
                <h3>Your matchup</h3>
                <span className="chart-note">
                  {scoring?.week != null ? `Week ${scoring.week}` : ""}
                  {lastSeasonScoring ? " · last season" : ""}
                </span>
              </header>
              {[matchViewer, matchOpponent].map((team) => (
                <div className="hub-home-mu-row" key={team.roster_id}>
                  <TeamIdentityMark
                    team={identityTeam(team)}
                    identity={identityFor(identities, identityTeam(team))}
                    size="sm"
                  />
                  <span className="hub-home-mu-name">{team.team_name}</span>
                  <span className="hub-home-mu-score">
                    {Number(team.points || 0) > 0 || team.proj_total == null
                      ? Number(team.points || 0).toFixed(1)
                      : `proj ${Number(team.est_final).toFixed(1)}`}
                  </span>
                </div>
              ))}
              {matchProb != null && (
                <>
                  <div className="hub-home-mu-bar" aria-hidden="true">
                    <span style={{ width: `${Math.round(matchProb * 100)}%` }} />
                  </div>
                  <p className="chart-note">{formatWinProb(matchProb)} win probability</p>
                </>
              )}
              {onNavigate ? (
                <button type="button" className="btn-ghost btn-sm" onClick={() => onNavigate("game")}>
                  Open Game center →
                </button>
              ) : null}
            </section>
          )}

          {pulseEvents.length > 0 && (
            <section className="hub-home-deck-card" aria-label="League pulse">
              <header className="hub-home-deck-head">
                <h3>League pulse</h3>
                <span className="chart-note">What changed lately</span>
              </header>
              <ul className="hub-home-pulse">
                {pulseEvents.map((event, idx) => {
                  const line = pulseEventLine(event);
                  return (
                    <li key={`${event.kind}-${event.at || idx}`}>
                      <span className="hub-home-pulse-ico" aria-hidden="true">{line.icon}</span>
                      <span className="hub-home-pulse-text">
                        {line.text}
                        {event.at ? <time>{formatRelativeTime(event.at)}</time> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {standingRows.length > 0 && (
            <section className="hub-home-deck-card" aria-label="Standings">
              <header className="hub-home-deck-head">
                <h3>Standings</h3>
                <span className="chart-note">{lastSeasonScoring ? "Final · last season" : "Season to date"}</span>
              </header>
              <ol className="hub-home-standings">
                {standingRows.map((row) => (
                  <li
                    key={row.roster_id}
                    className={row.hub_team_id && String(row.hub_team_id) === String(hubContext?.team_id) ? "is-you" : ""}
                  >
                    <span className="hub-home-standing-rank">{row.rank}</span>
                    <span className="hub-home-standing-name">{row.team_name}</span>
                    <span className="hub-home-standing-rec">
                      {row.wins}–{row.losses}{row.ties ? `–${row.ties}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
              {onNavigate ? (
                <button type="button" className="btn-ghost btn-sm" onClick={() => onNavigate("insights")}>
                  Full standings → Insights
                </button>
              ) : null}
            </section>
          )}
        </div>
      )}

      {supportingActions.length > 0 ? (
        <section className="hub-home-supporting" aria-labelledby="hub-home-supporting-title">
          <header>
            <div>
              <p className="hub-experience-kicker">After that</p>
              <h3 id="hub-home-supporting-title">Keep the league moving</h3>
            </div>
            <span>{supportingActions.length} more</span>
          </header>
          <ol className="hub-home-action-list">
            {supportingActions.map((action) => (
              <ActionRow key={action.id} action={action} onNavigate={onNavigate} />
            ))}
          </ol>
        </section>
      ) : null}
    </HubPage>
  );
}
