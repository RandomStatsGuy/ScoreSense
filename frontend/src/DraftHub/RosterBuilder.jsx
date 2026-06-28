import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import MobileDataList, { MobileStat } from "../MobileDataList";
import MobilePlayerCard from "../MobilePlayerCard";
import HubTabIntro from "./HubTabIntro";
import { HubPage, HubTableCard } from "./HubUILayout";
import { fmtSal, leagueStepUp, previewSchedule, scheduleText } from "./rosterFormat";
import { HUB_POS_ORDER, normalizeHubPosition } from "./hubPositions";
const TEAM_LOGO_ALIASES = { JAX: "jax", JAC: "jax", LA: "lar", LAR: "lar", WSH: "wsh", WAS: "wsh" };

function teamLogoUrl(team) {
  const abbr = String(team || "").trim().toUpperCase();
  if (!abbr) return null;
  const slug = TEAM_LOGO_ALIASES[abbr] || abbr.toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${slug}.png`;
}

function posSortKey(position) {
  const pos = normalizeHubPosition(position);
  const idx = HUB_POS_ORDER.indexOf(pos);
  return idx >= 0 ? idx : HUB_POS_ORDER.length;
}

export default function RosterBuilder({
  roster,
  onChanged,
  valueRows,
  sleeper,
  workspace,
  hubContext,
  capSheet,
  readOnly = false,
  showManagerTeam = false,
}) {
  const [playerId, setPlayerId] = useState("");
  const [salary, setSalary] = useState("");
  const [years, setYears] = useState(1);
  const [error, setError] = useState("");
  const [mediaById, setMediaById] = useState({});
  const [draftEdits, setDraftEdits] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const [search, setSearch] = useState("");

  const mobileLayout = useMobileLayout();
  const maxYears = Number(workspace?.rules?.contracts?.max_years ?? 3);
  const defaultStepUp = leagueStepUp(workspace?.rules);
  const salaryCap = Number(workspace?.rules?.salary_cap ?? 200);
  const season = workspace?.season ?? new Date().getFullYear();
  const draftCompleted = Boolean(hubContext?.draft_completed);
  const preDraft = !draftCompleted ? capSheet?.pre_draft : null;
  const linked = Boolean(sleeper?.sleeper_league_id && sleeper?.sleeper_roster_id);
  const teamName = sleeper?.sleeper_team_name;

  const isSleeperPlayer = (r) => r.source === "sleeper" || Boolean(r.sleeper_player_id);
  const lookup = valueRows?.find((r) => r.player_id === playerId);

  const sortedRoster = useMemo(
    () => [...(roster || [])].sort(
      (a, b) => posSortKey(a.position) - posSortKey(b.position)
        || String(a.player_name).localeCompare(String(b.player_name)),
    ),
    [roster],
  );

  const filteredRoster = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedRoster;
    return sortedRoster.filter((r) => {
      const name = String(r.player_name || "").toLowerCase();
      const team = String(r.team || "").toLowerCase();
      const pos = String(r.position || "").toLowerCase();
      return name.includes(q) || team.includes(q) || pos.includes(q);
    });
  }, [search, sortedRoster]);

  const posCounts = useMemo(() => {
    const counts = {};
    for (const row of roster || []) {
      const pos = String(row.position || "?").toUpperCase();
      counts[pos] = (counts[pos] || 0) + 1;
    }
    return counts;
  }, [roster]);

  const totalSalary = useMemo(() => {
    if (preDraft) return preDraft.season_committed;
    return (roster || []).reduce((sum, r) => sum + Number(r.salary || 0), 0);
  }, [preDraft, roster]);

  const toggleCut = useCallback(async (r, cut) => {
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
      onChanged?.();
    } catch (e) {
      setError(e.message || "Could not update cut status");
    } finally {
      setSavingId(null);
    }
  }, [onChanged]);

  useEffect(() => {
    if (!roster?.length) {
      setMediaById({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/hub/draft-room/enrichment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            season: workspace?.season,
            players: roster.map((r) => ({
              player_id: r.player_id,
              player_name: r.player_name,
              team: r.team,
              position: r.position,
            })),
          }),
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setMediaById(data.media_by_player_id || {});
      } catch {
        if (!cancelled) setMediaById({});
      }
    })();
    return () => { cancelled = true; };
  }, [roster, workspace?.season]);

  useEffect(() => {
    setDraftEdits({});
  }, [roster]);

  const getEdit = useCallback((r) => {
    const d = draftEdits[r.player_id];
    if (d) return d;
    return {
      salary: String(r.salary ?? ""),
      years: String(r.contract?.years_remaining ?? r.contract_years ?? 1),
    };
  }, [draftEdits]);

  const setEdit = (pid, patch) => {
    setDraftEdits((prev) => {
      const row = roster.find((x) => x.player_id === pid);
      const base = prev[pid] || {
        salary: String(row?.salary ?? ""),
        years: String(row?.contract?.years_remaining ?? row?.contract_years ?? 1),
      };
      return { ...prev, [pid]: { ...base, ...patch } };
    });
  };

  const saveRow = useCallback(async (r) => {
    const edit = getEdit(r);
    const nextSal = Number(edit.salary);
    const nextYears = Number(edit.years);
    const curSal = Number(r.salary);
    const curYears = Number(r.contract?.years_remaining ?? r.contract_years ?? 1);
    if (nextSal === curSal && nextYears === curYears) return;

    setSavingId(r.player_id);
    setError("");
    setSavedId(null);
    try {
      const res = await apiFetch("/api/hub/roster", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player_id: r.player_id,
          salary: Number.isFinite(nextSal) ? nextSal : curSal,
          contract_years: Number.isFinite(nextYears) ? nextYears : curYears,
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      setSavedId(r.player_id);
      setTimeout(() => setSavedId((id) => (id === r.player_id ? null : id)), 1500);
      onChanged?.();
    } catch (e) {
      setError(e.message || "Could not save changes");
    } finally {
      setSavingId(null);
    }
  }, [getEdit, onChanged]);

  const remove = async (pid) => {
    const res = await apiFetch("/api/hub/roster", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player_id: pid }),
    });
    if (!res.ok) setError(await parseApiError(res));
    else onChanged?.();
  };

  const addManual = async () => {
    setError("");
    const row = lookup;
    if (!row) {
      setError("Pick a player from the value sheet list first.");
      return;
    }
    const res = await apiFetch("/api/hub/roster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        player_id: row.player_id,
        player_name: row.player,
        team: row.team,
        position: row.position,
        salary: Number(salary) || row.model_bid_hint || 1,
        contract_years: Number(years) || 1,
      }),
    });
    if (!res.ok) setError(await parseApiError(res));
    else {
      setPlayerId("");
      setSalary("");
      onChanged?.();
    }
  };

  return (
    <HubPage className="hub-roster-builder">
      <HubTabIntro
        title="Roster"
        compact
        learnMore={readOnly ? <p>Read-only — ask commish to edit.</p> : null}
      />

      <div className="hub-roster-hero">
        <div className="hub-roster-hero-top">
          {linked && teamName && (
            <div className="hub-roster-team-banner">
              <span className="hub-roster-team-avatar" aria-hidden="true">
                {teamName.slice(0, 2).toUpperCase()}
              </span>
              <div>
                <div className="hub-roster-team-name">{teamName}</div>
                <div className="hub-roster-team-meta">
                  {roster.length} players
                  {roster.filter(isSleeperPlayer).length > 0
                    ? ` · ${roster.filter(isSleeperPlayer).length} from Sleeper`
                    : ""}
                </div>
              </div>
            </div>
          )}
          <div className="hub-stat-card hub-stat-card--accent" style={{ minWidth: "9rem" }}>
            <span className="hub-stat-label">Cap ({season})</span>
            <strong className="hub-stat-value">
              ${totalSalary.toFixed(0)}
              <span className="hub-stat-value-note"> / ${salaryCap}</span>
            </strong>
            {preDraft && (
              <span className="hub-stat-sub">
                ${preDraft.draft_budget_available?.toFixed(0)} for draft
              </span>
            )}
          </div>
        </div>
        <div className="hub-chip-row">
          {HUB_POS_ORDER.filter((p) => posCounts[p]).map((pos) => (
            <span key={pos} className="hub-pos-chip">
              {pos} <strong>{posCounts[pos]}</strong>
            </span>
          ))}
        </div>
      </div>

      {!readOnly && !mobileLayout && (
        <p className="chart-note hub-roster-contract-help">
          Saves on blur · step-up +${defaultStepUp}/yr
          {!draftCompleted && " · 1yr deals expire after draft"}
        </p>
      )}

      {!readOnly && (
      <details className="hub-roster-add">
        <summary>Add player manually</summary>
        <div className="hub-form-row hub-roster-add-row">
          <label>
            Player
            <select value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
              <option value="">Select…</option>
              {(valueRows || []).slice(0, 300).map((r) => (
                <option key={r.player_id} value={r.player_id}>{r.player} ({r.position})</option>
              ))}
            </select>
          </label>
          <label>
            Cap hit ($)
            <input type="number" min={0} value={salary} onChange={(e) => setSalary(e.target.value)} placeholder={lookup?.model_bid_hint || "1"} />
          </label>
          <label>
            Years left
            <input type="number" min={1} max={maxYears} value={years} onChange={(e) => setYears(e.target.value)} />
          </label>
          <button type="button" className="btn-primary" onClick={addManual}>Add</button>
        </div>
      </details>
      )}

      {readOnly && !mobileLayout && (
        <p className="chart-note">Salaries set by commish. Sync Sleeper after trades.</p>
      )}

      {error && <div className="error">{error}</div>}

      {mobileLayout && (
        <input
          type="search"
          className="search-input hub-filter-search hub-roster-mobile-search"
          placeholder="Search roster…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search roster"
        />
      )}

      <HubTableCard className="hub-roster-table-wrap">
        {mobileLayout ? (
          <MobileDataList
            emptyMessage={
              !filteredRoster.length
                ? (sortedRoster.length
                  ? "No players match your search."
                  : "No players. Link Sleeper or add from Players.")
                : null
            }
          >
            {filteredRoster.map((r) => {
              const edit = getEdit(r);
              const isSaving = savingId === r.player_id;
              const justSaved = savedId === r.player_id;
              const yrsLeft = Number(r.contract?.years_remaining ?? r.contract_years ?? 1);
              const isCut = r.roster_status === "cut_before_draft";
              const storedSchedule = scheduleText(r);
              const livePreview = readOnly
                ? storedSchedule
                : (previewSchedule(edit.salary, edit.years, defaultStepUp) || storedSchedule);
              const expiringBadge = !draftCompleted && yrsLeft <= 1 && !isCut
                ? (mobileLayout ? "Expires soon" : "Expires after draft")
                : (yrsLeft === 1 ? "Final year" : null);
              const actions = [];
              if (!draftCompleted) {
                actions.push(
                  <button
                    key="cut"
                    type="button"
                    className={`btn-ghost btn-sm${isCut ? " hub-uncut-btn" : ""}`}
                    disabled={isSaving}
                    onClick={() => toggleCut(r, !isCut)}
                  >
                    {isCut ? "Undo" : (mobileLayout ? "Cut" : "Cut pre-draft")}
                  </button>,
                );
              }
              if (!readOnly) {
                actions.push(
                  <button
                    key="remove"
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={isSaving}
                    onClick={() => remove(r.player_id)}
                  >
                    Remove
                  </button>,
                );
              }
              return (
                <MobilePlayerCard
                  key={r.player_id}
                  className={`${isSleeperPlayer(r) ? "hub-sleeper-row" : ""}${isCut ? " hub-cut-row" : ""}`.trim()}
                  name={r.player_name}
                  meta={[r.team, normalizeHubPosition(r.position)].filter(Boolean).join(" · ") || "—"}
                  heroValue={fmtSal(edit.salary)}
                  heroLabel="cap"
                  badge={(
                    <>
                      {isSleeperPlayer(r) && <span className="hub-sleeper-badge">Sleeper</span>}
                      {r.contract?.contract_type === "rookie" && <span className="hub-sleeper-badge">Rookie</span>}
                      {isCut && <span className="hub-sleeper-badge hub-cut-badge">Cut before draft</span>}
                      {expiringBadge && <span className="hub-sleeper-badge hub-expiring-badge">{expiringBadge}</span>}
                    </>
                  )}
                  expanded={(
                    <div className="mobile-stat-grid hub-roster-mobile-grid">
                      {readOnly ? (
                        <MobileStat label={`Cap hit (${season})`} value={fmtSal(edit.salary)} />
                      ) : (
                        <label className="hub-roster-mobile-field">
                          <span className="mobile-stat-label">Cap hit ({season})</span>
                          <input
                            type="number"
                            className="hub-roster-edit-input"
                            min={0}
                            step={1}
                            value={edit.salary}
                            disabled={isSaving}
                            onChange={(e) => setEdit(r.player_id, { salary: e.target.value })}
                            onBlur={() => saveRow(r)}
                            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                          />
                        </label>
                      )}
                      {readOnly ? (
                        <MobileStat label="Yrs left" value={edit.years} />
                      ) : (
                        <label className="hub-roster-mobile-field">
                          <span className="mobile-stat-label">Yrs left</span>
                          <input
                            type="number"
                            className="hub-roster-edit-input hub-roster-edit-input-sm"
                            min={1}
                            max={maxYears}
                            step={1}
                            value={edit.years}
                            disabled={isSaving}
                            onChange={(e) => setEdit(r.player_id, { years: e.target.value })}
                            onBlur={() => saveRow(r)}
                            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                          />
                        </label>
                      )}
                      {showManagerTeam && (
                        <MobileStat label="Manager" value={r.manager_team || "—"} />
                      )}
                      <MobileStat
                        label="Schedule"
                        value={livePreview || "—"}
                        className="hub-roster-mobile-schedule"
                      />
                      {!readOnly && isSaving && (
                        <span className="hub-roster-save-hint hub-roster-mobile-save">Saving…</span>
                      )}
                      {!readOnly && !isSaving && justSaved && (
                        <span className="hub-roster-save-hint hub-roster-save-ok hub-roster-mobile-save">Saved</span>
                      )}
                    </div>
                  )}
                  actions={actions.length > 0 ? actions : null}
                />
              );
            })}
          </MobileDataList>
        ) : (
        <div className="table-wrap">
          <table className="data-table hub-table hub-roster-table">
          <thead>
            <tr>
              <th>Player</th>
              {showManagerTeam && <th>Manager</th>}
              <th>Pos</th>
              <th>Cap hit ({season})</th>
              <th>Yrs left</th>
              <th>Schedule</th>
              {(!readOnly || !draftCompleted) && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {sortedRoster.map((r) => {
              const media = mediaById[r.player_id] || {};
              const edit = getEdit(r);
              const logo = media.team_logo_url || teamLogoUrl(r.team);
              const thumb = media.headshot_url || logo;
              const isSaving = savingId === r.player_id;
              const justSaved = savedId === r.player_id;
              const yrsLeft = Number(r.contract?.years_remaining ?? r.contract_years ?? 1);
              const isCut = r.roster_status === "cut_before_draft";
              const storedSchedule = scheduleText(r);
              const livePreview = readOnly
                ? storedSchedule
                : (previewSchedule(edit.salary, edit.years, defaultStepUp) || storedSchedule);
              const expiringBadge = !draftCompleted && yrsLeft <= 1 && !isCut
                ? (mobileLayout ? "Expires soon" : "Expires after draft")
                : (yrsLeft === 1 ? "Final year" : null);
              return (
                <tr key={r.player_id} className={`${isSleeperPlayer(r) ? "hub-sleeper-row" : ""}${isCut ? " hub-cut-row" : ""}`}>
                  <td>
                    <div className="hub-roster-player-cell">
                      {thumb ? (
                        <img
                          className="hub-roster-player-thumb"
                          src={thumb}
                          alt=""
                          onError={(e) => {
                            if (logo && e.currentTarget.src !== logo) e.currentTarget.src = logo;
                            else e.currentTarget.style.visibility = "hidden";
                          }}
                        />
                      ) : (
                        <span className="hub-roster-player-thumb hub-roster-player-thumb-empty" />
                      )}
                      <div className="hub-roster-player-text">
                        <span className="hub-roster-player-name">{r.player_name}</span>
                        <span className="hub-roster-player-team">
                          {logo && (
                            <img className="hub-roster-inline-logo" src={logo} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                          )}
                          {r.team || "—"}
                          {isSleeperPlayer(r) && <span className="hub-sleeper-badge">Sleeper</span>}
                          {r.contract?.contract_type === "rookie" && <span className="hub-sleeper-badge">Rookie</span>}
                          {isCut && <span className="hub-sleeper-badge hub-cut-badge">Cut before draft</span>}
                          {expiringBadge && <span className="hub-sleeper-badge hub-expiring-badge">{expiringBadge}</span>}
                        </span>
                      </div>
                    </div>
                  </td>
                  {showManagerTeam && <td>{r.manager_team || "—"}</td>}
                  <td><span className="hub-roster-pos-tag">{r.position}</span></td>
                  <td>
                    {readOnly ? (
                      <span>{fmtSal(edit.salary)}</span>
                    ) : (
                    <input
                      type="number"
                      className="hub-roster-edit-input"
                      min={0}
                      step={1}
                      value={edit.salary}
                      disabled={isSaving}
                      onChange={(e) => setEdit(r.player_id, { salary: e.target.value })}
                      onBlur={() => saveRow(r)}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                    />
                    )}
                  </td>
                  <td>
                    {readOnly ? (
                      <span>{edit.years}</span>
                    ) : (
                    <input
                      type="number"
                      className="hub-roster-edit-input hub-roster-edit-input-sm"
                      min={1}
                      max={maxYears}
                      step={1}
                      value={edit.years}
                      disabled={isSaving}
                      onChange={(e) => setEdit(r.player_id, { years: e.target.value })}
                      onBlur={() => saveRow(r)}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                    />
                    )}
                  </td>
                  <td className="chart-note hub-schedule-preview">{livePreview || "—"}</td>
                  {(!readOnly || !draftCompleted) && (
                  <td className="hub-roster-actions">
                    {!readOnly && isSaving && <span className="hub-roster-save-hint">Saving…</span>}
                    {!readOnly && !isSaving && justSaved && <span className="hub-roster-save-hint hub-roster-save-ok">Saved</span>}
                    {!draftCompleted && (
                      <button
                        type="button"
                        className={`btn-ghost btn-sm${isCut ? " hub-uncut-btn" : ""}`}
                        disabled={isSaving}
                        onClick={() => toggleCut(r, !isCut)}
                      >
                        {isCut ? "Undo" : (mobileLayout ? "Cut" : "Cut pre-draft")}
                      </button>
                    )}
                    {!readOnly && (
                    <button type="button" className="btn-ghost btn-sm" disabled={isSaving} onClick={() => remove(r.player_id)}>
                      Remove
                    </button>
                    )}
                  </td>
                  )}
                </tr>
              );
            })}
            {!sortedRoster.length && (
              <tr>
                <td colSpan={showManagerTeam ? (readOnly ? 6 : 8) : (readOnly ? 5 : 7)} className="chart-note hub-roster-empty">
                  No players yet. Link Sleeper in Setup or add from Values.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        )}
      </HubTableCard>
    </HubPage>
  );
}
