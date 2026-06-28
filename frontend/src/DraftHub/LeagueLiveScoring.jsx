import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, formatRelativeTime, parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import MobilePlayerCard from "../MobilePlayerCard";
import { HubPage } from "./HubUILayout";

const POLL_MS = 60_000;

function fmtPts(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v).toFixed(1);
}

function viewerMatchup(data, hubContext) {
  const matchups = data?.matchups || [];
  const viewerRid = String(hubContext?.sleeper_roster_id || data?.hub_context?.sleeper_roster_id || "");
  if (!viewerRid) return null;
  return matchups.find((m) => (m.teams || []).some((t) => String(t.roster_id) === viewerRid)) || null;
}

function LiveEmptyState({ data, hubContext, onNavigate, onRefresh, loading }) {
  const reason = data?.reason || "unknown";
  const linked = Boolean(hubContext?.sleeper_league_id || data?.hub_context?.sleeper_league_id);

  let title = "Connect Sleeper for live scoring";
  let body = data?.hint || "Link Sleeper in Setup to see this week's matchup.";

  if (reason === "fetch_failed") {
    title = "Could not load live scoring";
  } else if (data?.preseason) {
    title = "Season not started";
    body = data?.hint || "Live scores appear once your league has played games.";
  }

  return (
    <div className="hub-insights-empty-state">
      <h3>{title}</h3>
      <p>{body}</p>
      {linked && data?.season && (
        <p className="chart-note hub-insights-empty-meta">
          {data.season} season
          {data.week ? ` · Week ${data.week}` : ""}
        </p>
      )}
      <div className="hub-insights-empty-actions">
        {!linked && onNavigate && (
          <button type="button" className="btn-primary btn-sm" onClick={() => onNavigate("setup")}>
            Go to Setup
          </button>
        )}
        {linked && (
          <button type="button" className="btn-ghost btn-sm" onClick={onRefresh} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh from Sleeper"}
          </button>
        )}
      </div>
      <p className="chart-note hub-live-scoring-disclaimer">Scores from Sleeper.</p>
    </div>
  );
}

function StarterList({ team, mobileLayout }) {
  if (!team) return null;
  const starters = team.starters || [];

  if (mobileLayout) {
    return (
      <div className="hub-live-starter-grid">
        <h4 className="hub-live-starter-heading">
          {team.team_name}
          <span className="hub-live-starter-total">{fmtPts(team.points)} pts</span>
        </h4>
        {starters.map((p) => (
          <MobilePlayerCard
            key={`${team.roster_id}-${p.sleeper_player_id}`}
            name={p.name}
            meta={[p.team, p.position].filter(Boolean).join(" · ") || "—"}
            heroValue={fmtPts(p.points)}
            heroLabel="pts"
            className={team.is_viewer ? "hub-live-starter-viewer" : team.is_opponent ? "hub-live-starter-opponent" : ""}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="hub-live-starter-table-wrap">
      <h4 className="hub-live-starter-heading">
        {team.team_name}
        <span className="hub-live-starter-total">{fmtPts(team.points)} pts</span>
      </h4>
      <table className="data-table compact hub-live-starter-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Pos</th>
            <th>Team</th>
            <th className="num">Pts</th>
          </tr>
        </thead>
        <tbody>
          {starters.map((p) => (
            <tr key={`${team.roster_id}-${p.sleeper_player_id}`}>
              <td>{p.name}</td>
              <td>{p.position || "—"}</td>
              <td>{p.team || "—"}</td>
              <td className="num">{fmtPts(p.points)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatchupHero({ matchup }) {
  const teams = matchup?.teams || [];
  if (teams.length < 2) {
    const solo = teams[0];
    return (
      <div className="hub-live-matchup-hero hub-live-matchup-hero--bye">
        <span className="hub-live-matchup-team">{solo?.team_name || "Your team"}</span>
        <strong className="hub-live-matchup-score">{fmtPts(solo?.points)}</strong>
        <span className="hub-live-matchup-label">Bye week</span>
      </div>
    );
  }
  const [a, b] = teams;
  const diff = (a.points || 0) - (b.points || 0);
  const leading = diff > 0 ? a : diff < 0 ? b : null;
  return (
    <div className="hub-live-matchup-hero">
      <div className={`hub-live-matchup-side${a.is_viewer ? " hub-live-matchup-side--viewer" : ""}`}>
        <span className="hub-live-matchup-team">{a.team_name}</span>
        <strong className="hub-live-matchup-score">{fmtPts(a.points)}</strong>
      </div>
      <div className="hub-live-matchup-mid">
        <span className="hub-live-matchup-vs">vs</span>
        {leading && (
          <span className="hub-live-matchup-diff">
            {leading.team_name} +{fmtPts(Math.abs(diff))}
          </span>
        )}
        {!leading && diff === 0 && <span className="hub-live-matchup-diff">Tied</span>}
      </div>
      <div className={`hub-live-matchup-side${b.is_viewer ? " hub-live-matchup-side--viewer" : ""}`}>
        <span className="hub-live-matchup-team">{b.team_name}</span>
        <strong className="hub-live-matchup-score">{fmtPts(b.points)}</strong>
      </div>
    </div>
  );
}

function MatchupCard({ matchup, compact = false }) {
  const teams = matchup?.teams || [];
  return (
    <div className={`hub-live-matchup-card${compact ? " hub-live-matchup-card--compact" : ""}`}>
      {teams.map((t) => (
        <div key={t.roster_id} className={`hub-live-matchup-card-row${t.is_viewer ? " hub-live-matchup-card-row--viewer" : ""}`}>
          <span className="hub-live-matchup-card-team">{t.team_name}</span>
          <span className="hub-live-matchup-card-pts">{fmtPts(t.points)}</span>
        </div>
      ))}
    </div>
  );
}

export default function LeagueLiveScoring({ leagueId, hubContext, onNavigate }) {
  const mobileLayout = useMobileLayout();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState(null);

  const load = useCallback(async ({ refresh = false, silent = false, week } = {}) => {
    if (!leagueId) return;
    if (!silent) {
      if (refresh) setRefreshing(true);
      else setLoading(true);
    }
    setError("");
    try {
      const params = new URLSearchParams();
      const weekParam = week !== undefined ? week : selectedWeek;
      if (weekParam != null && Number.isFinite(Number(weekParam))) {
        params.set("week", String(weekParam));
      }
      if (refresh) params.set("refresh", "1");
      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await apiFetch(`/api/hub/league/${leagueId}/live-scoring${qs}`);
      if (!res.ok) {
        const msg = await parseApiError(res);
        throw new Error(msg || `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (err) {
      setError(connectionErrorMessage(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [leagueId, selectedWeek]);

  useEffect(() => {
    load();
  }, [load]);

  const currentWeek = data?.current_week ?? data?.week;
  const viewingCurrentWeek = selectedWeek == null || selectedWeek === currentWeek;

  useEffect(() => {
    if (!viewingCurrentWeek) return undefined;
    const tick = () => {
      if (document.visibilityState === "visible") {
        load({ silent: true });
      }
    };
    const id = window.setInterval(tick, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load, viewingCurrentWeek]);

  const weekOptions = useMemo(() => {
    const max = Number(data?.max_week) || 18;
    return Array.from({ length: max }, (_, i) => i + 1);
  }, [data?.max_week]);

  const displayWeek = selectedWeek ?? data?.week ?? currentWeek;

  const myMatchup = useMemo(() => viewerMatchup(data, hubContext), [data, hubContext]);
  const myTeams = useMemo(() => {
    const teams = myMatchup?.teams || [];
    const viewerRid = String(hubContext?.sleeper_roster_id || "");
    const viewer = teams.find((t) => String(t.roster_id) === viewerRid) || teams.find((t) => t.is_viewer);
    const opponent = teams.find((t) => t !== viewer);
    return { viewer, opponent };
  }, [myMatchup, hubContext]);

  const showContent = data?.available && !data?.preseason && (data?.matchups?.length || 0) > 0;
  const showPreseason = data?.available && (data?.preseason || !(data?.matchups?.length));

  return (
    <HubPage className="hub-live-scoring">
      <header className="hub-section-head hub-section-head--row">
        <div>
          <h2 className="hub-tab-intro-title">Live scoring</h2>
          {data?.week && data?.season && (
            <p className="hub-page-meta">
              Week {displayWeek} · {data.season} season · scores from Sleeper
              {!viewingCurrentWeek && " · past week"}
            </p>
          )}
        </div>
        <div className="hub-insights-scoring-meta">
          {weekOptions.length > 0 && data?.available !== false && (
            <label className="hub-insights-season-picker">
              <span className="hub-filter-label">Week</span>
              <select
                className="search-input"
                value={displayWeek ?? ""}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setSelectedWeek(next);
                  load({ week: next, refresh: true });
                }}
                disabled={loading || refreshing}
              >
                {weekOptions.map((w) => (
                  <option key={w} value={w}>
                    Week {w}{w === currentWeek ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {data?.synced_at && formatRelativeTime(data.synced_at) && (
            <span className="table-meta hub-insights-scoring-synced">
              {refreshing ? "Updating…" : formatRelativeTime(data.synced_at)}
            </span>
          )}
          {data?.available !== false && (
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => load({ refresh: true })}
              disabled={loading || refreshing}
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          )}
        </div>
      </header>

      {error && <p className="error-banner">{error}</p>}

      {loading && !data && <p className="chart-note">Loading live scoring…</p>}

      {!loading && data && !data.available && (
        <LiveEmptyState
          data={data}
          hubContext={hubContext}
          onNavigate={onNavigate}
          onRefresh={() => load({ refresh: true })}
          loading={refreshing}
        />
      )}

      {showPreseason && data?.available && (
        <LiveEmptyState
          data={data}
          hubContext={hubContext}
          onNavigate={onNavigate}
          onRefresh={() => load({ refresh: true })}
          loading={refreshing}
        />
      )}

      {showContent && (
        <>
          <section className="hub-live-section">
            <h3 className="hub-live-section-title">My matchup</h3>
            {myMatchup ? (
              <>
                <MatchupHero matchup={myMatchup} />
                <div className="hub-live-starters-row">
                  <StarterList team={myTeams.viewer} mobileLayout={mobileLayout} />
                  <StarterList team={myTeams.opponent} mobileLayout={mobileLayout} />
                </div>
              </>
            ) : (
              <p className="chart-note">
                Link your Sleeper team in Setup to highlight your matchup.
              </p>
            )}
          </section>

          <section className="hub-live-section">
            <h3 className="hub-live-section-title">League scoreboard</h3>
            <div className="hub-live-scoreboard-list">
              {(data.matchups || []).map((m) => (
                <MatchupCard
                  key={m.matchup_id}
                  matchup={m}
                  compact={mobileLayout}
                />
              ))}
            </div>
          </section>
        </>
      )}

      {showContent && mobileLayout && (
        <p className="chart-note hub-live-scoring-disclaimer">Scores from Sleeper.</p>
      )}
    </HubPage>
  );
}
