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
import {
  CONTRACT_TYPE_OPTIONS,
  contractScheduleHint,
  contractTypeBadgeClass,
  contractTypeLabel,
  fmtSal,
  leagueStepUp,
  preDraftCutDeadCap,
  previewSchedule,
  scheduleText,
  seasonCapYearHint,
  YEARS_LEFT_HINT,
} from "./rosterFormat";
import { confirmDialog } from "../ui/confirm";
import { promptDialog } from "../ui/prompt";

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
  const [typeOverrides, setTypeOverrides] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mobileLayout = useMobileLayout();

  useEffect(() => {
    setOpen(defaultOpen);
  }, [block.team.id, defaultOpen]);

  useEffect(() => {
    setEdits({});
    setTypeOverrides({});
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
    const nextSal = Number(edit.salary);
    const nextYears = Number(edit.years);
    const curSal = Number(r.salary);
    const curYears = Number(r.contract?.years_remaining ?? r.contract_years ?? 1);
    if (nextSal === curSal && nextYears === curYears) return;

    // SCORE-43: commissioner Office Current overrides require a reason + before/after.
    const note = await promptDialog({
      title: "Commissioner override",
      message: `Update ${r.player_name || "player"} on the live roster?`,
      label: "Override reason",
      placeholder: "Why are you changing this live contract?",
      confirmLabel: "Apply override",
      beforeAfter: {
        before: `${fmtSal(curSal)} · ${curYears} yr`,
        after: `${fmtSal(Number.isFinite(nextSal) ? nextSal : curSal)} · ${Number.isFinite(nextYears) ? nextYears : curYears} yr`,
      },
    });
    if (note == null) return;

    setSavingId(r.player_id);
    setError("");
    setNotice("");
    try {
      const res = await apiFetch("/api/hub/roster", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player_id: r.player_id,
          salary: Number.isFinite(nextSal) ? nextSal : curSal,
          contract_years: Number.isFinite(nextYears) ? nextYears : curYears,
          note,
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      if (data?.before && data?.after) {
        const rev = data.live_roster_revision != null ? ` · rev ${data.live_roster_revision}` : "";
        setNotice(
          `Override saved: ${fmtSal(data.before.salary)} → ${fmtSal(data.after.salary)}${rev}`,
        );
        setTimeout(() => setNotice(""), 3500);
      }
      onSaved?.(opts);
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setSavingId(null);
    }
  };

  const saveContractType = async (r, nextType) => {
    const cur = String(r.contract?.contract_type || "veteran");
    if (nextType === cur && !r.contract?.pending_type) return;
    setTypeOverrides((prev) => ({ ...prev, [r.player_id]: nextType }));
    setSavingId(r.player_id);
    setError("");
    try {
      const res = await apiFetch("/api/hub/roster/contract-type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: r.player_id, contract_type: nextType }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      const savedType = data.saved_contract_type
        || data.slot?.contract?.contract_type
        || (data.pending_type ? nextType : null);
      if (!data.pending_type && savedType !== nextType) {
        throw new Error(
          `Type did not save (still ${savedType || "unknown"}; received ${data.received_contract_type || "?"})`,
        );
      }
      setTypeOverrides((prev) => ({ ...prev, [r.player_id]: data.pending_type ? cur : savedType }));
      onSaved?.({ syncHub: true });
      if (data.pending_type) {
        setError("Submitted — waiting on commissioner.");
        setTimeout(() => setError(""), 2500);
      }
    } catch (e) {
      setTypeOverrides((prev) => {
        const next = { ...prev };
        delete next[r.player_id];
        return next;
      });
      setError(connectionErrorMessage(e));
    } finally {
      setSavingId(null);
    }
  };

  const setCutStatus = async (r, cut) => {
    const nextStatus = cut ? "cut_before_draft" : "active";
    const note = await promptDialog({
      title: "Commissioner override",
      message: cut
        ? `Mark ${r.player_name} as cut before draft?`
        : `Restore ${r.player_name} to active roster?`,
      label: "Override reason",
      placeholder: "Why is roster status changing?",
      confirmLabel: cut ? "Mark cut" : "Restore",
      beforeAfter: {
        before: r.roster_status === "cut_before_draft" ? "cut_before_draft" : "active",
        after: nextStatus,
      },
    });
    if (note == null) return;

    setSavingId(r.player_id);
    setError("");
    setNotice("");
    try {
      const res = await apiFetch("/api/hub/roster", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player_id: r.player_id,
          roster_status: nextStatus,
          note,
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      if (data?.before && data?.after) {
        setNotice(
          `Status override: ${data.before.roster_status || "active"} → ${data.after.roster_status || nextStatus}`,
        );
        setTimeout(() => setNotice(""), 3500);
      }
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
      {open && notice && <p className="chart-note hub-league-team-notice" role="status">{notice}</p>}

      {open && (
        <details className="hub-roster-contract-rules hub-roster-contract-help">
          <summary>How this works</summary>
          <div className="hub-roster-contract-rules-body chart-note">
            <p title={seasonCapYearHint(season)}>
              Cap hit is for the {season} season (after the {season} draft).{" "}
              {contractScheduleHint(stepUp)}.
            </p>
            <p>{YEARS_LEFT_HINT}</p>
          </div>
        </details>
      )}

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
            const ctype = String(
              typeOverrides[r.player_id] || r.contract?.contract_type || "veteran",
            );
            const pendingType = r.contract?.pending_type;
            const inferredMeta = !r.contract?.contract_type_manual && r.contract?.inferred_from
              ? String(r.contract.inferred_from).replace("nfl_yr_", "NFL yr ")
              : null;
            const storedSchedule = scheduleText(r, rules);
            const livePreview = previewSchedule(edit.salary, edit.years, stepUp, ctype) || storedSchedule;
            const expiringBadge = !draftCompleted && yrsLeft <= 1 && !isCut
              ? (ctype === "rookie" ? "Extend to keep" : "Expires — FA")
              : null;
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
                heroLabel={`${season} $`}
                badge={(
                  <>
                    <span className={contractTypeBadgeClass(ctype)}>{contractTypeLabel(ctype)}</span>
                    {pendingType && <span className="hub-sleeper-badge hub-pending-badge">Pending</span>}
                    {inferredMeta && <span className="hub-contract-infer-meta">Auto · {inferredMeta}</span>}
                    {isCut && <span className="hub-sleeper-badge hub-cut-badge">Cut</span>}
                    {expiringBadge && <span className="hub-sleeper-badge hub-expiring-badge">{expiringBadge}</span>}
                  </>
                )}
                expanded={(
                  <div className="mobile-stat-grid hub-roster-mobile-grid">
                    <label className="hub-roster-mobile-field">
                      <span className="mobile-stat-label">Contract type</span>
                      <select
                        className="hub-roster-edit-input"
                        value={pendingType || ctype}
                        disabled={saving || isCut}
                        onChange={(e) => saveContractType(r, e.target.value)}
                      >
                        {CONTRACT_TYPE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="hub-roster-mobile-field">
                      <span className="mobile-stat-label" title={seasonCapYearHint(season)}>
                        Cap hit ({season} season)
                      </span>
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
                      <span className="mobile-stat-label" title={YEARS_LEFT_HINT}>Yrs left</span>
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
      <div className="table-wrap table-sticky hub-league-table-wrap">
        <table className="data-table hub-table hub-roster-table hub-league-roster-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Pos</th>
              <th>Type</th>
              <th title={seasonCapYearHint(season)}>{season} season $</th>
              <th title={YEARS_LEFT_HINT}>Yrs left</th>
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
              const ctype = String(
                typeOverrides[r.player_id] || r.contract?.contract_type || "veteran",
              );
              const pendingType = r.contract?.pending_type;
              const inferredMeta = !r.contract?.contract_type_manual && r.contract?.inferred_from
                ? String(r.contract.inferred_from).replace("nfl_yr_", "NFL yr ")
                : null;
              const storedSchedule = scheduleText(r, rules);
              const livePreview = previewSchedule(edit.salary, edit.years, stepUp, ctype) || storedSchedule;
              const expiringBadge = !draftCompleted && yrsLeft <= 1 && !isCut
                ? (ctype === "rookie" ? "Extend to keep" : "Expires — FA")
                : null;
              return (
                <tr key={r.player_id} className={isCut ? "hub-cut-row" : ""}>
                  <td>
                    <div className="hub-league-player-cell">
                      <span className="hub-roster-player-name">{r.player_name}</span>
                      <span className="hub-league-player-meta">
                        {r.team || "—"}
                        {pendingType && <span className="hub-sleeper-badge hub-pending-badge">Pending</span>}
                        {inferredMeta && <span className="hub-contract-infer-meta">Auto · {inferredMeta}</span>}
                        {isCut && <span className="hub-sleeper-badge hub-cut-badge">Cut</span>}
                        {expiringBadge && (
                          <span className="hub-sleeper-badge hub-expiring-badge">{expiringBadge}</span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td><span className="hub-roster-pos-tag">{r.position}</span></td>
                  <td>
                    <select
                      className="hub-roster-edit-input hub-roster-type-select"
                      value={pendingType || ctype}
                      disabled={saving || isCut}
                      onChange={(e) => saveContractType(r, e.target.value)}
                      aria-label={`Contract type for ${r.player_name}`}
                    >
                      {CONTRACT_TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </td>
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
                      title={seasonCapYearHint(season)}
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
                      title={YEARS_LEFT_HINT}
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
                <td colSpan={7} className="chart-note hub-roster-empty">
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

  const maxYears = Number(
    workspace?.rules?.contracts?.max_years
    ?? overview?.league?.rules?.contracts?.max_years
    ?? 3,
  );
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

  const salaryCap = Number(overview?.salary_cap ?? workspace?.rules?.salary_cap ?? 200);
  const leagueRules = workspace?.rules || overview?.league?.rules;

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
            Pick a team to edit · Type / {targetSeason || "season"} season $ / Yrs left · cut = refund · drop = remove
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
        {!teamFilter && !search.trim() ? (
          <p className="chart-note">
            No team selected — click a team above to edit salaries, years, and contract type.
          </p>
        ) : (
          <>
            {filteredTeams.map((block) => (
              <TeamRosterBlock
                key={block.team.id}
                block={block}
                season={targetSeason}
                maxYears={maxYears}
                salaryCap={salaryCap}
                rules={leagueRules}
                draftCompleted={draftCompleted}
                defaultOpen={Boolean(teamFilter) || Boolean(search.trim())}
                onSaved={handleSaved}
              />
            ))}
            {!filteredTeams.length && (
              <p className="chart-note">No teams match your search.</p>
            )}
          </>
        )}
      </div>
        </>
      )}
    </section>
  );
}

export { scheduleText, fmtSal } from "./rosterFormat";
