import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import MobileDataList, { MobileStat } from "../MobileDataList";
import MobilePlayerCard from "../MobilePlayerCard";
import LeagueSleeperConnect from "./LeagueSleeperConnect";
import {
  getAnyLeagueRostersCache,
  setLeagueRostersCache,
} from "./hubDataCache";
import { fmtSal, leagueStepUp, preDraftCutDeadCap, previewSchedule, scheduleText } from "./rosterFormat";
import { confirmDialog } from "../ui/confirm";

const POS_ORDER = ["QB", "RB", "WR", "TE"];

function posSortKey(position) {
  const pos = String(position || "").toUpperCase();
  const idx = POS_ORDER.indexOf(pos);
  return idx >= 0 ? idx : POS_ORDER.length;
}

function activeRoster(roster) {
  return (roster || []).filter((r) => r.roster_status !== "cut_before_draft");
}

function teamCapStats(block, salaryCap, rules) {
  const active = activeRoster(block.roster);
  const cuts = (block.roster || []).filter((r) => r.roster_status === "cut_before_draft");
  const committed = active.reduce((sum, r) => sum + Number(r.salary || 0), 0);
  const deadCap = cuts.reduce((sum, r) => sum + preDraftCutDeadCap(r, rules), 0);
  const cap = Number(salaryCap) || 200;
  return {
    committed,
    deadCap,
    remaining: cap - committed - deadCap,
    cap,
    playerCount: active.length,
    cutCount: (block.roster?.length || 0) - active.length,
  };
}

function TeamRosterBlock({
  block,
  season,
  maxYears,
  salaryCap,
  rules,
  draftCompleted,
  defaultOpen,
  onSaved,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [edits, setEdits] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState("");
  const mobileLayout = useMobileLayout();

  useEffect(() => {
    setOpen(defaultOpen);
  }, [block.team.id, defaultOpen]);

  useEffect(() => {
    setEdits({});
  }, [block.team.id, block.roster]);

  const sorted = useMemo(
    () => [...(block.roster || [])].sort(
      (a, b) => posSortKey(a.position) - posSortKey(b.position)
        || String(a.player_name).localeCompare(String(b.player_name)),
    ),
    [block.roster],
  );

  const stepUp = leagueStepUp(rules);

  const getEdit = (r) => {
    if (edits[r.player_id]) return edits[r.player_id];
    return {
      salary: String(r.salary ?? ""),
      years: String(r.contract?.years_remaining ?? r.contract_years ?? 1),
    };
  };

  const saveRow = async (r, opts = {}) => {
    const edit = getEdit(r);
    setSavingId(r.player_id);
    setError("");
    try {
      const res = await apiFetch("/api/hub/roster", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player_id: r.player_id,
          salary: Number(edit.salary),
          contract_years: Number(edit.years),
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      onSaved?.(opts);
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setSavingId(null);
    }
  };

  const setCutStatus = async (r, cut) => {
    setSavingId(r.player_id);
    setError("");
    try {
      const res = await apiFetch("/api/hub/roster", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player_id: r.player_id,
          roster_status: cut ? "cut_before_draft" : "active",
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      onSaved?.({ syncHub: true });
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setSavingId(null);
    }
  };

  const dropPlayer = async (r) => {
    if (!(await confirmDialog({
      title: "Drop player",
      message: `Drop ${r.player_name} from ${block.team.name}?`,
      confirmLabel: "Drop player",
      danger: true,
    }))) {
      return;
    }
    setSavingId(r.player_id);
    setError("");
    try {
      const res = await apiFetch("/api/hub/roster", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: r.player_id }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      onSaved?.({ syncHub: true });
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setSavingId(null);
    }
  };

  const team = block.team;
  const stats = teamCapStats(block, salaryCap, rules);
  const committedPct = Math.min(100, (stats.committed / stats.cap) * 100);
  const deadCapPct = Math.min(100 - committedPct, (stats.deadCap / stats.cap) * 100);
  const capPct = Math.min(100, Math.round(committedPct + deadCapPct));

  return (
    <details
      className="hub-league-team-card"
      open={open}
      id={`team-${team.id}`}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="hub-league-team-card-head">
        <div className="hub-league-team-card-title">
          <strong>{team.name}</strong>
          <span className="hub-league-team-badges">
            {team.user_sub ? (
              <span className="hub-badge hub-badge-claimed">Claimed</span>
            ) : (
              <span className="hub-badge hub-badge-open">Unclaimed</span>
            )}
            {team.sleeper_roster_id && (
              <span className="hub-badge hub-badge-sleeper">Sleeper</span>
            )}
          </span>
        </div>
        <div className="hub-league-team-card-stats">
          <span>{stats.playerCount} players</span>
          <span>{fmtSal(stats.committed)} committed</span>
          {stats.deadCap > 0 && (
            <span className="hub-league-cut-count">{fmtSal(stats.deadCap)} dead cap</span>
          )}
          <span className="hub-league-cap-free">{fmtSal(stats.remaining)} free</span>
          {stats.cutCount > 0 && (
            <span className="hub-league-cut-count">{stats.cutCount} cut pre-draft</span>
          )}
          {!open && stats.playerCount > 0 && (
            <span className="hub-league-expand-hint hub-league-expand-hint--desktop">Tap to edit</span>
          )}
        </div>
        <div
          className="hub-cap-bar"
          role="progressbar"
          aria-valuenow={capPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${capPct}% of salary cap used`}
        >
          <div className="hub-cap-bar-committed" style={{ width: `${committedPct}%` }} />
          {deadCapPct > 0 && (
            <div className="hub-cap-bar-dead" style={{ width: `${deadCapPct}%` }} />
          )}
        </div>
      </summary>

      {open && error && <div className="error hub-league-team-error">{error}</div>}

      {open && (
      mobileLayout ? (
        <MobileDataList
          emptyMessage={!sorted.length ? "No players. Sync from Sleeper above." : null}
        >
          {sorted.map((r) => {
            const edit = getEdit(r);
            const saving = savingId === r.player_id;
            const isCut = r.roster_status === "cut_before_draft";
            const yrsLeft = Number(r.contract?.years_remaining ?? r.contract_years ?? 1);
            const storedSchedule = scheduleText(r);
            const livePreview = previewSchedule(edit.salary, edit.years, stepUp) || storedSchedule;
            const actions = [];
            if (!draftCompleted) {
              actions.push(
                <button
                  key="cut"
                  type="button"
                  className={`btn-ghost btn-sm${isCut ? " hub-uncut-btn" : ""}`}
                  disabled={saving}
                  onClick={() => setCutStatus(r, !isCut)}
                >
                  {isCut ? "Undo cut" : "Cut"}
                </button>,
              );
            }
            actions.push(
              <button
                key="drop"
                type="button"
                className="btn-ghost btn-sm hub-drop-btn"
                disabled={saving}
                onClick={() => dropPlayer(r)}
              >
                Drop
              </button>,
            );
            return (
              <MobilePlayerCard
                key={r.player_id}
                className={isCut ? "hub-cut-row" : ""}
                name={r.player_name}
                meta={[r.team, r.position].filter(Boolean).join(" · ") || "—"}
                heroValue={fmtSal(edit.salary)}
                heroLabel="cap"
                badge={(
                  <>
                    {isCut && <span className="hub-sleeper-badge hub-cut-badge">Cut</span>}
                    {!draftCompleted && yrsLeft <= 1 && !isCut && (
                      <span className="hub-sleeper-badge hub-expiring-badge">Expires before draft</span>
                    )}
                  </>
                )}
                expanded={(
                  <div className="mobile-stat-grid hub-roster-mobile-grid">
                    <label className="hub-roster-mobile-field">
                      <span className="mobile-stat-label">Cap hit ({season})</span>
                      <input
                        type="number"
                        className="hub-roster-edit-input"
                        min={0}
                        value={edit.salary}
                        disabled={saving || isCut}
                        onChange={(e) => setEdits((prev) => ({
                          ...prev,
                          [r.player_id]: { ...getEdit(r), salary: e.target.value },
                        }))}
                        onBlur={() => saveRow(r, { syncHub: false })}
                        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                      />
                    </label>
                    <label className="hub-roster-mobile-field">
                      <span className="mobile-stat-label">Yrs left</span>
                      <input
                        type="number"
                        className="hub-roster-edit-input hub-roster-edit-input-sm"
                        min={1}
                        max={maxYears}
                        value={edit.years}
                        disabled={saving || isCut}
                        onChange={(e) => setEdits((prev) => ({
                          ...prev,
                          [r.player_id]: { ...getEdit(r), years: e.target.value },
                        }))}
                        onBlur={() => saveRow(r, { syncHub: false })}
                        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                      />
                    </label>
                    <MobileStat
                      label="Schedule"
                      value={livePreview || "—"}
                      className="hub-roster-mobile-schedule"
                    />
                  </div>
                )}
                actions={actions}
              />
            );
          })}
        </MobileDataList>
      ) : (
      <div className="table-wrap hub-league-table-wrap">
        <table className="data-table hub-table hub-roster-table hub-league-roster-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Pos</th>
              <th>Cap hit ({season})</th>
              <th>Yrs left</th>
              <th>Schedule</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const edit = getEdit(r);
              const saving = savingId === r.player_id;
              const isCut = r.roster_status === "cut_before_draft";
              const yrsLeft = Number(r.contract?.years_remaining ?? r.contract_years ?? 1);
              const storedSchedule = scheduleText(r);
              const livePreview = previewSchedule(edit.salary, edit.years, stepUp) || storedSchedule;
              return (
                <tr key={r.player_id} className={isCut ? "hub-cut-row" : ""}>
                  <td>
                    <div className="hub-league-player-cell">
                      <span className="hub-roster-player-name">{r.player_name}</span>
                      <span className="hub-league-player-meta">
                        {r.team || "—"}
                        {isCut && <span className="hub-sleeper-badge hub-cut-badge">Cut</span>}
                        {!draftCompleted && yrsLeft <= 1 && !isCut && (
                          <span className="hub-sleeper-badge hub-expiring-badge">Expires before draft</span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td><span className="hub-roster-pos-tag">{r.position}</span></td>
                  <td>
                    <input
                      type="number"
                      className="hub-roster-edit-input"
                      min={0}
                      value={edit.salary}
                      disabled={saving || isCut}
                      onChange={(e) => setEdits((prev) => ({
                        ...prev,
                        [r.player_id]: { ...getEdit(r), salary: e.target.value },
                      }))}
                      onBlur={() => saveRow(r, { syncHub: false })}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className="hub-roster-edit-input hub-roster-edit-input-sm"
                      min={1}
                      max={maxYears}
                      value={edit.years}
                      disabled={saving || isCut}
                      onChange={(e) => setEdits((prev) => ({
                        ...prev,
                        [r.player_id]: { ...getEdit(r), years: e.target.value },
                      }))}
                      onBlur={() => saveRow(r, { syncHub: false })}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                    />
                  </td>
                  <td className="chart-note hub-schedule-preview">{livePreview}</td>
                  <td className="hub-roster-actions">
                    {!draftCompleted && (
                      <button
                        type="button"
                        className={`btn-ghost btn-sm${isCut ? " hub-uncut-btn" : ""}`}
                        disabled={saving}
                        onClick={() => setCutStatus(r, !isCut)}
                        title={isCut ? "Restore to active roster" : "Mark as cut before draft"}
                      >
                        {isCut ? "Undo cut" : "Cut"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-ghost btn-sm hub-drop-btn"
                      disabled={saving}
                      onClick={() => dropPlayer(r)}
                      title="Remove from league"
                    >
                      Drop
                    </button>
                  </td>
                </tr>
              );
            })}
            {!sorted.length && (
              <tr>
                <td colSpan={6} className="chart-note hub-roster-empty">
                  No players. Sync from Sleeper above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )
      )}
    </details>
  );
}

function LeagueRostersSkeleton() {
  return (
    <div className="hub-league-team-list" aria-busy="true" aria-label="Loading league rosters">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="hub-league-team-card hub-league-team-skeleton">
          <div className="hub-league-team-card-head">
            <div className="hub-league-skeleton-line hub-league-skeleton-title" />
            <div className="hub-league-skeleton-line hub-league-skeleton-stats" />
            <div className="hub-cap-bar"><div className="hub-cap-bar-committed" style={{ width: `${20 + i * 12}%` }} /></div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CommissionerLeagueRosters({ leagueId, season, workspace, hubContext, onChanged }) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const loadGenRef = React.useRef(0);
  const overviewRef = React.useRef(null);
  overviewRef.current = overview;

  const load = useCallback(async (opts = {}) => {
    if (!leagueId) return;
    const cached = !opts.refresh ? getAnyLeagueRostersCache(leagueId) : null;
    if (cached && !overviewRef.current) {
      setOverview(cached);
      setLoading(false);
    }
    const hasUi = Boolean(overviewRef.current || cached);
    const background = Boolean(opts.background || (hasUi && !opts.refresh));
    if (!background && !hasUi) setLoading(true);
    setError("");
    const generation = ++loadGenRef.current;
    try {
      const params = new URLSearchParams();
      if (opts.refresh) params.set("refresh", "1");
      const q = params.toString() ? `?${params.toString()}` : "";
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/rosters${q}`);
      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      if (generation !== loadGenRef.current) return;
      setOverview(payload);
      setLeagueRostersCache(leagueId, payload.source_version || "", payload);
    } catch (e) {
      if (generation !== loadGenRef.current) return;
      if (!overviewRef.current && !cached) {
        setError(connectionErrorMessage(e));
      }
    } finally {
      if (generation === loadGenRef.current) setLoading(false);
    }
  }, [leagueId]);

  useEffect(() => {
    load();
  }, [leagueId]); // eslint-disable-line react-hooks/exhaustive-deps

  const maxYears = Number(workspace?.rules?.contracts?.max_years ?? 3);
  const salaryCap = Number(overview?.salary_cap ?? workspace?.rules?.salary_cap ?? 200);
  const targetSeason = season || overview?.league?.season || workspace?.season;
  const draftCompleted = Boolean(hubContext?.draft_completed);

  const handleSaved = useCallback(async (opts = {}) => {
    await load({ background: Boolean(overviewRef.current), refresh: true });
    if (opts.syncHub) onChanged?.();
  }, [load, onChanged]);

  const refresh = useCallback(async () => {
    await load({ refresh: true });
    onChanged?.();
  }, [load, onChanged]);

  const teams = overview?.teams || [];
  const filteredTeams = useMemo(() => {
    const q = search.trim().toLowerCase();
    return teams
      .filter((block) => !teamFilter || block.team.id === teamFilter)
      .map((block) => {
        if (!q) return block;
        const roster = (block.roster || []).filter(
          (r) => String(r.player_name || "").toLowerCase().includes(q)
            || String(r.position || "").toLowerCase().includes(q)
            || String(r.team || "").toLowerCase().includes(q),
        );
        return roster.length ? { ...block, roster } : null;
      })
      .filter(Boolean);
  }, [teams, search, teamFilter]);

  const leagueRules = workspace?.rules;

  const leagueTotals = useMemo(() => {
    let players = 0;
    let committed = 0;
    let deadCap = 0;
    for (const block of teams) {
      const s = teamCapStats(block, salaryCap, leagueRules);
      players += s.playerCount;
      committed += s.committed;
      deadCap += s.deadCap;
    }
    return { teams: teams.length, players, committed, deadCap };
  }, [teams, salaryCap, leagueRules]);

  const initialLoad = loading && !overview;
  const refreshing = loading && Boolean(overview);

  if (error && !overview) {
    return (
      <section className="hub-page hub-league-rosters panel wide">
        <div className="error">{error}</div>
      </section>
    );
  }

  return (
    <section className="hub-page hub-league-rosters panel wide">
      <header className="hub-league-rosters-head">
        <div className="hub-league-rosters-intro">
          <h2>League rosters</h2>
          <p className="hub-league-rosters-lead hub-league-rosters-lead--desktop">
            Edit teams · cut = refund · drop = remove
          </p>
        </div>
        <div className="hub-league-rosters-summary" aria-label="League totals">
          {refreshing && <span className="hub-league-refresh-badge">Updating…</span>}
          <span className="hub-league-summary-stat">
            <strong>{leagueTotals.teams || "—"}</strong> teams
          </span>
          <span className="hub-league-summary-stat">
            <strong>{leagueTotals.players || "—"}</strong> players
          </span>
          <span className="hub-league-summary-stat">
            <strong>{overview ? fmtSal(leagueTotals.committed) : "—"}</strong> committed
          </span>
          {leagueTotals.deadCap > 0 && (
            <span className="hub-league-summary-stat">
              <strong>{fmtSal(leagueTotals.deadCap)}</strong> dead cap
            </span>
          )}
        </div>
      </header>

      {error && overview && <div className="error hub-league-inline-error">{error}</div>}

      {overview && (
        <LeagueSleeperConnect
          leagueId={leagueId}
          hubContext={hubContext}
          overview={overview}
          onConnected={refresh}
        />
      )}

      {initialLoad ? (
        <LeagueRostersSkeleton />
      ) : (
        <>
      {teams.length > 0 && (
        <div className="hub-league-rosters-toolbar">
          <label className="hub-league-search">
            <span className="hub-field-label">Search players</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, position, NFL team…"
            />
          </label>
          <div className="hub-league-team-jump" role="group" aria-label="Filter by team">
            {teams.map((block) => {
              const s = teamCapStats(block, salaryCap, leagueRules);
              return (
                <button
                  key={block.team.id}
                  type="button"
                  className={`hub-league-jump-pill${teamFilter === block.team.id ? " active" : ""}`}
                  onClick={() => setTeamFilter((id) => (id === block.team.id ? "" : block.team.id))}
                  title={`${block.team.name} · ${fmtSal(s.committed)} committed`}
                >
                  {block.team.name}
                  <span className="hub-league-jump-meta">{fmtSal(s.committed)}</span>
                </button>
              );
            })}
            {teamFilter && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => setTeamFilter("")}>
                Show all
              </button>
            )}
          </div>
        </div>
      )}

      <div className="hub-league-team-list">
        {filteredTeams.map((block, idx) => (
          <TeamRosterBlock
            key={block.team.id}
            block={block}
            season={targetSeason}
            maxYears={maxYears}
            salaryCap={salaryCap}
            rules={leagueRules}
            draftCompleted={draftCompleted}
            defaultOpen={!teamFilter ? idx === 0 : true}
            onSaved={handleSaved}
          />
        ))}
        {!filteredTeams.length && (
          <p className="chart-note">No teams match your search.</p>
        )}
      </div>
        </>
      )}
    </section>
  );
}

export { scheduleText, fmtSal } from "./rosterFormat";
