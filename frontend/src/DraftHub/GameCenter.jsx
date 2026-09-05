import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import { isAbortError } from "../fetchAbort";
import { usePlayerMedia } from "../PlayerCell";
import { HubAlert, HubLoadingSkeleton, HubPage } from "./HubUILayout";
import { PAINT_WIDTH, paintMediaUrl } from "./draftMedia";
import TeamIdentityMark from "./TeamIdentityMark";
import WeekCulturePanel from "./WeekCulturePanel";
import { identityFor, useTeamIdentities } from "./TeamIdentityContext";
import {
  GAME_CENTER_COPY,
  duelRows,
  findViewerMatchup,
  formatMatchupRecord,
  formatMatchupScore,
  formatStandingRank,
  formatStandingRecord,
  formatSyncedAgo,
  formatWinProb,
  gameCenterBanner,
  gameCenterHeroCopy,
  gameCenterStandingRows,
  gameCenterTeamLabel,
  gameCenterTeamParts,
  gameStateLabel,
  interpretStandings,
  scoresArePlaceholder,
  lineupIsEmpty,
  matchupStoryline,
  matchupTeams,
  shouldShowNextWeek,
  shouldShowPrevWeek,
  startersPending,
  winProbFor,
} from "./gameCenterPresentation";

const REFRESH_MS = 60_000;

function DuelPlayer({ player, media, away = false }) {
  if (!player || !player.name || player.name === "Empty") {
    return <div className={`hub-gc-duel-player${away ? " hub-gc-duel-player--away" : ""} hub-gc-duel-player--empty`}>Empty slot</div>;
  }
  const raw = media?.[player.player_id]?.headshot_url || media?.[player.player_id]?.team_logo_url;
  const shot = paintMediaUrl(raw, PAINT_WIDTH.mark);
  return (
    <div className={`hub-gc-duel-player${away ? " hub-gc-duel-player--away" : ""}`}>
      {shot ? (
        <img
          className="hub-gc-duel-headshot"
          src={shot}
          alt={player.name}
          loading="lazy"
          onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
        />
      ) : (
        <span className="hub-gc-duel-headshot hub-gc-duel-headshot--empty" aria-hidden="true" />
      )}
      <div className="hub-gc-duel-id">
        <span className="hub-gc-duel-name">{player.name}</span>
        <span className="hub-gc-duel-sub">
          {[player.team, player.position].filter(Boolean).join(" · ") || "—"}
        </span>
      </div>
    </div>
  );
}

function DuelPoints({ player, leading, placeholder = false }) {
  const shown = formatMatchupScore(player?.points, {
    placeholder,
    proj: player?.proj,
  });
  return (
    <div className={`hub-gc-duel-pts${leading ? " is-leading" : ""}`}>
      {shown.score}
      <span>{shown.label || "\u00a0"}</span>
    </div>
  );
}

export default function GameCenter({ leagueId, hubContext, onNavigate }) {
  const { identities } = useTeamIdentities();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [week, setWeek] = useState(null); // null = current NFL week

  const load = useCallback(async (signal, { refresh = false } = {}) => {
    if (!leagueId) return;
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
      if (!signal?.aborted) setData(payload);
    } catch (e) {
      if (isAbortError(e) || signal?.aborted) return;
      setError(connectionErrorMessage(e));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [leagueId, week]);

  useEffect(() => {
    setLoading(true);
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const isLiveWeek = data ? gameStateLabel(data) === "Live" && !data.preseason : false;

  /** Live weeks re-pull on the server cache cadence while the tab is visible. */
  useEffect(() => {
    if (!isLiveWeek) return undefined;
    const tick = () => {
      if (document.visibilityState === "visible") load();
    };
    const id = window.setInterval(tick, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [isLiveWeek, load]);

  const matchup = useMemo(() => findViewerMatchup(data), [data]);
  const { viewer, opponent } = useMemo(() => matchupTeams(matchup), [matchup]);
  const rows = useMemo(
    () => duelRows(viewer, opponent, data?.starting_slots || []),
    [viewer, opponent, data?.starting_slots],
  );
  const duelIds = useMemo(
    () => rows.flatMap((r) => [r.home?.player_id, r.away?.player_id]).filter(Boolean),
    [rows],
  );
  const media = usePlayerMedia(duelIds);

  const standingsView = useMemo(
    () => interpretStandings(data, {
      draftCompleted: hubContext?.draft_completed,
    }),
    [data, hubContext?.draft_completed],
  );
  const standingRows = useMemo(
    () => gameCenterStandingRows(
      standingsView.standings,
      hubContext?.team_id,
      { compact: false },
    ),
    [standingsView.standings, hubContext?.team_id],
  );
  const viewerStanding = standingRows.find(
    (row) => row.hub_team_id && String(row.hub_team_id) === String(hubContext?.team_id),
  ) || standingRows.find((row) => viewer && String(row.roster_id) === String(viewer.roster_id));

  const weekNumber = data?.week;
  const currentWeek = data?.current_week;
  const maxWeek = data?.max_week || 18;
  const stateLabel = loading && !data
    ? GAME_CENTER_COPY.loadingChip
    : (data ? gameStateLabel(data, hubContext) : "");
  const viewerProb = matchup && viewer ? winProbFor(matchup, viewer) : null;
  const otherMatchups = (data?.matchups || []).filter((m) => m !== matchup);
  const weekComplete = stateLabel === "Final";
  const placeholder = scoresArePlaceholder(data, hubContext);
  const hasSlate = (data?.matchups || []).length > 0;
  const fullPageEmpty = !loading && data && !hasSlate;
  const emptyLineup = lineupIsEmpty(viewer, opponent, rows);
  const banner = gameCenterBanner({
    draftCompleted: hubContext?.draft_completed,
    draftStartsAt: hubContext?.draft_starts_at,
    placeholder,
    reason: data?.reason,
    sleeperLinked: Boolean(hubContext?.sleeper_league_id || data?.hub_context?.sleeper_league_id),
  });
  const showBanner = Boolean(!loading && data && banner);
  const hero = gameCenterHeroCopy({
    emptyLineup,
    live: stateLabel === "Live",
    weekComplete,
    placeholder,
    viewer,
    opponent,
  });
  const storyline = matchupStoryline({
    viewer,
    opponent,
    weekComplete,
    placeholder,
    week: weekNumber,
    hint: data?.hint,
  });
  const viewerScore = formatMatchupScore(viewer?.points, {
    placeholder,
    proj: viewer?.est_final ?? viewer?.proj_total,
  });
  const opponentScore = formatMatchupScore(opponent?.points, {
    placeholder,
    proj: opponent?.est_final ?? opponent?.proj_total,
  });

  const stepWeek = (delta) => {
    const base = Number(weekNumber ?? currentWeek ?? 1);
    const next = Math.min(Number(maxWeek), Math.max(1, base + delta));
    setWeek(next);
  };

  const identityTeam = (team) => ({
    id: team?.hub_team_id || team?.roster_id,
    name: team?.team_name,
    owner_name: team?.owner_name,
  });

  const teamTitle = (team) => {
    const parts = gameCenterTeamParts(team);
    return (
      <>
        <strong>{parts.owner || parts.team || gameCenterTeamLabel(team)}</strong>
        {parts.owner && parts.team ? <span className="hub-gc-team-nick">{parts.team}</span> : null}
      </>
    );
  };

  const showLiveChip = stateLabel === "Live" || stateLabel === "Final" || stateLabel === GAME_CENTER_COPY.loadingChip;
  const heroChip = data?.synced_at && stateLabel === "Live"
    ? `${stateLabel} · ${formatSyncedAgo(data.synced_at) || ""}`
    : (showLiveChip ? stateLabel : "");
  const showPrev = shouldShowPrevWeek(weekNumber);
  const showNext = shouldShowNextWeek(weekNumber, maxWeek);

  const goBanner = () => {
    if (!onNavigate || !banner) return;
    onNavigate(banner.action);
  };

  const opponentRecord = (() => {
    if (opponent?.roster_id === "tbd") {
      return weekNumber != null ? `Week ${weekNumber} opponent TBD` : "Opponent TBD";
    }
    const row = standingRows.find((s) => String(s.roster_id) === String(opponent?.roster_id))
      || standingRows.find((s) => s.hub_team_id && String(s.hub_team_id) === String(opponent?.hub_team_id));
    return formatMatchupRecord(row, { ranked: standingsView.ranked });
  })();

  return (
    <HubPage className="hub-game-center">
      <header className="hub-gc-head">
        <div>
          <p className="hub-experience-kicker">{GAME_CENTER_COPY.eyebrow}</p>
          <h1 className="hub-tab-intro-title">
            {hero.heading}
          </h1>
          {hero.support ? <p className="hub-gc-hero-support">{hero.support}</p> : null}
        </div>
        <div className="hub-gc-week-toolbar">
          {heroChip ? <span className={`hub-gc-state${stateLabel === "Live" ? " is-live" : ""}`}>{heroChip}</span> : null}
          {(showPrev || showNext) ? (
            <div className="hub-gc-week-nav" role="group" aria-label="Week">
              {showPrev ? (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={loading}
                  onClick={() => stepWeek(-1)}
                >
                  ← Week {Math.max(1, Number(weekNumber ?? 1) - 1)}
                </button>
              ) : null}
              {showNext ? (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={loading}
                  onClick={() => stepWeek(1)}
                >
                  Week {Math.min(Number(maxWeek), Number(weekNumber ?? 1) + 1)} →
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      {error && <div className="error">{error}</div>}
      {loading && !data && <HubLoadingSkeleton label="Loading matchups" rows={3} />}

      {showBanner && (
        <HubAlert
          variant="warn"
          action={onNavigate ? (
            <button type="button" className="btn-ghost btn-sm" onClick={goBanner}>
              {banner.actionLabel}
            </button>
          ) : null}
        >
          {banner.text}
        </HubAlert>
      )}

      {fullPageEmpty && !placeholder && !showBanner && (
        <section className="hub-gc-empty panel">
          <h3>{data?.reason === "fetch_failed" ? "Couldn’t load matchups" : "No matchups yet"}</h3>
          {data?.hint && data.hint !== GAME_CENTER_COPY.emptyPreseason ? (
            <p className="chart-note">{data.hint}</p>
          ) : null}
        </section>
      )}

      {matchup && viewer && opponent && (
        <section className="hub-gc-billboard" aria-label="Your matchup">
          <div className="hub-gc-bb-side">
            <TeamIdentityMark team={identityTeam(viewer)} identity={identityFor(identities, identityTeam(viewer))} size="lg" />
            <div className="hub-gc-bb-team">
              {teamTitle(viewer)}
              <span>
                {formatMatchupRecord(viewerStanding, { ranked: standingsView.ranked }) || "You"}
              </span>
            </div>
          </div>
          <div className="hub-gc-bb-score" aria-live="polite" aria-atomic="true">
            <div className={`hub-gc-bb-points${!placeholder && viewer.points >= opponent.points ? " is-leading" : ""}`}>
              {viewerScore.score}
              <span>{viewerScore.label || "\u00a0"}</span>
            </div>
            <div className="hub-gc-bb-divider" aria-hidden="true">
              <span>Week {weekNumber}</span>
            </div>
            <div className={`hub-gc-bb-points${!placeholder && opponent.points > viewer.points ? " is-leading" : ""}`}>
              {opponentScore.score}
              <span>{opponentScore.label || "\u00a0"}</span>
            </div>
          </div>
          <div className="hub-gc-bb-side hub-gc-bb-side--away">
            <TeamIdentityMark team={identityTeam(opponent)} identity={identityFor(identities, identityTeam(opponent))} size="lg" />
            <div className="hub-gc-bb-team">
              {teamTitle(opponent)}
              <span>{opponentRecord || "Opponent"}</span>
            </div>
          </div>

          {viewerProb != null && !placeholder && (
            <div className="hub-gc-winprob">
              <div className="hub-gc-winprob-labels">
                <span><strong>{formatWinProb(viewerProb)}</strong> win probability{startersPending(viewer) + startersPending(opponent) > 0 ? " (estimate)" : ""}</span>
                <span>{formatWinProb(1 - viewerProb)}</span>
              </div>
              <div className="hub-gc-winprob-bar" role="img" aria-label={`Win probability ${formatWinProb(viewerProb)}`}>
                <span className="home" style={{ width: `${Math.round(viewerProb * 100)}%` }} />
                <span className="away" />
              </div>
              <p className="hub-gc-storyline">{storyline}</p>
            </div>
          )}
          {(viewerProb == null || placeholder) && storyline ? (
            <p className="hub-gc-storyline">{storyline}</p>
          ) : null}
        </section>
      )}

      {matchup && viewer && opponent && (
        <div className="hub-gc-columns">
          <aside className="hub-gc-rail">
            <section className="panel hub-gc-around" aria-label={GAME_CENTER_COPY.leagueTitle}>
              <header className="hub-gc-panel-head">
                <div>
                  <h3>{GAME_CENTER_COPY.leagueTitle}</h3>
                  <p className="chart-note">{GAME_CENTER_COPY.leagueSupport}</p>
                </div>
              </header>
              <div className="hub-gc-mini-list" aria-live="polite">
                {otherMatchups.map((m) => (
                  <div className="hub-gc-mini" key={m.matchup_id}>
                    {(m.teams || []).map((team) => {
                      const parts = gameCenterTeamParts(team);
                      const shown = formatMatchupScore(team.points, {
                        placeholder,
                        proj: team.est_final ?? team.proj_total,
                      });
                      return (
                      <div
                        className={`hub-gc-mini-line${Number(team.points) >= Math.max(...(m.teams || []).map((t) => Number(t.points || 0))) ? " is-leading" : ""}`}
                        key={team.roster_id}
                      >
                        <TeamIdentityMark
                          team={identityTeam(team)}
                          identity={identityFor(identities, identityTeam(team))}
                          size="sm"
                        />
                        <span className="hub-gc-mini-name">
                          {parts.owner || parts.team || team.team_name}
                          {parts.owner && parts.team ? (
                            <span className="hub-gc-team-nick">{parts.team}</span>
                          ) : null}
                        </span>
                        <span className="hub-gc-mini-score">
                          {shown.score}
                          {shown.label ? <span className="hub-gc-mini-score-label">{shown.label}</span> : null}
                        </span>
                      </div>
                      );
                    })}
                  </div>
                ))}
                {!otherMatchups.length && <p className="chart-note">No other matchups this week.</p>}
              </div>
            </section>

            {standingRows.length > 0 && (
              <section className="panel hub-gc-standings" aria-label={GAME_CENTER_COPY.standingsTitle}>
                <header className="hub-gc-panel-head">
                  <div>
                    <h3>{standingsView.historical ? GAME_CENTER_COPY.standingsLastSeason : GAME_CENTER_COPY.standingsTitle}</h3>
                    <p className="chart-note">{standingsView.note}</p>
                  </div>
                </header>
                <ol className="hub-gc-standings-list">
                  {standingRows.map((row) => {
                    const parts = gameCenterTeamParts(row);
                    return (
                    <li
                      key={row.roster_id}
                      className={viewerStanding && row.roster_id === viewerStanding.roster_id ? "is-you" : ""}
                    >
                      <span className="hub-gc-standing-rank">
                        {formatStandingRank(row, { ranked: standingsView.ranked })}
                      </span>
                      <span className="hub-gc-standing-name">
                        {parts.owner || parts.team || row.team_name}
                        {parts.owner && parts.team ? (
                          <span className="hub-gc-team-nick">{parts.team}</span>
                        ) : null}
                      </span>
                      <span className="hub-gc-standing-rec">{formatStandingRecord(row)}</span>
                    </li>
                    );
                  })}
                </ol>
              </section>
            )}
          </aside>
          <div className="hub-gc-main">
            <section className="panel hub-gc-duel" aria-label={GAME_CENTER_COPY.duelTitle}>
              <header className="hub-gc-panel-head">
                <div>
                  <h3>{GAME_CENTER_COPY.duelTitle}</h3>
                  <p className="chart-note">{GAME_CENTER_COPY.duelSupport}</p>
                </div>
              </header>
              <div className="hub-gc-duel-rows">
                {rows.length === 0 ? (
                  <div className="hub-gc-duel-empty">
                    <p className="chart-note">{GAME_CENTER_COPY.emptyDuel}</p>
                    {onNavigate && !weekComplete ? (
                      <button type="button" className="btn-primary" onClick={() => onNavigate("week")}>
                        {GAME_CENTER_COPY.setLineup}
                      </button>
                    ) : null}
                  </div>
                ) : rows.map((row) => {
                  const homePts = Number(row.home?.points || 0);
                  const awayPts = Number(row.away?.points || 0);
                  return (
                    <div className="hub-gc-duel-row" key={row.key}>
                      <DuelPlayer player={row.home} media={media} />
                      <DuelPoints player={row.home} leading={!placeholder && homePts >= awayPts} placeholder={placeholder} />
                      <span className="hub-gc-duel-slot">{row.slot}</span>
                      <DuelPoints player={row.away} leading={!placeholder && awayPts > homePts} placeholder={placeholder} />
                      <DuelPlayer player={row.away} media={media} away />
                    </div>
                  );
                })}
              </div>
            </section>

            {(viewer.bench || opponent.bench) && !placeholder && (
              <section className="panel hub-gc-bench" aria-label={GAME_CENTER_COPY.benchTitle}>
                <header className="hub-gc-panel-head">
                  <div>
                    <h3>{GAME_CENTER_COPY.benchTitle}</h3>
                    <p className="chart-note">{GAME_CENTER_COPY.benchSupport}</p>
                  </div>
                </header>
                <div className="hub-gc-bench-grid">
                  {viewer.bench && (
                    <div className="hub-gc-bench-cell">
                      <strong>
                        {viewer.bench.top_name} · {formatMatchupScore(viewer.bench.top_points).score} pts
                      </strong>
                      Your best bench score. Bench total {formatMatchupScore(viewer.bench.points).score} across {viewer.bench.count} players.
                    </div>
                  )}
                  {opponent.bench && (
                    <div className="hub-gc-bench-cell">
                      <strong>Their bench: {formatMatchupScore(opponent.bench.points).score} pts</strong>
                      Best left out: {opponent.bench.top_name} ({formatMatchupScore(opponent.bench.top_points).score}).
                    </div>
                  )}
                </div>
              </section>
            )}

            <section className="hub-gc-culture" aria-label={GAME_CENTER_COPY.trophiesTitle}>
              <WeekCulturePanel
                hubContext={hubContext}
                week={weekNumber}
                boardReady
                title={GAME_CENTER_COPY.trophiesTitle}
                support={GAME_CENTER_COPY.trophiesSupport}
              />
            </section>
          </div>
        </div>
      )}
    </HubPage>
  );
}
