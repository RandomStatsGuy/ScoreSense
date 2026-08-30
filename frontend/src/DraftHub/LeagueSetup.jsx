import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import { effectiveHubContext } from "./hubContext";
import LeagueSwitcher from "./LeagueSwitcher";
import { effectiveMemberships, isSoloContext } from "./hubLeagues";
import {
  DRAFT_TZ_OPTIONS,
  browserTimeZone,
  formatDraftScheduleLabel,
  utcIsoToWall,
} from "./draftEntryStatus";
import LeagueCreateJoinForm from "./LeagueCreateJoinForm";

const TYPE_LABEL = { rookie: "Rookie deal", veteran: "Veteran Deal", extension: "Rookie Extension" };

export default function LeagueSetup({
  workspace,
  hubContext,
  memberships = [],
  presets,
  onLeagueCreated,
  onLeagueSwitch,
  onCreateLeague,
  onNavigate,
  onLeagueSync,
  leagueSyncing = false,
  leagueSyncMessage,
  leagueSyncError,
  hideActiveHero = false,
  startCreateOpen = false,
}) {
  const ctx = effectiveHubContext(hubContext, workspace);
  const mobileLayout = useMobileLayout();
  const inLeague = ctx?.mode === "league";
  const isCommissioner = ctx?.is_commissioner;
  const draftCompleted = Boolean(ctx?.draft_completed);
  const soloActive = isSoloContext(ctx);
  const leagues = useMemo(
    () => effectiveMemberships(memberships, ctx),
    [memberships, ctx],
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [showAddLeague, setShowAddLeague] = useState(
    () => Boolean(startCreateOpen) || (memberships.length === 0 && soloActive),
  );
  const [pendingTypes, setPendingTypes] = useState([]);
  const [draftTz, setDraftTz] = useState(ctx?.draft_timezone || browserTimeZone());
  const [draftWall, setDraftWall] = useState(() => utcIsoToWall(ctx?.draft_starts_at, ctx?.draft_timezone || browserTimeZone()));

  const season = workspace?.season ?? new Date().getFullYear();

  useEffect(() => {
    if (startCreateOpen) setShowAddLeague(true);
  }, [startCreateOpen]);

  useEffect(() => {
    if (!isCommissioner || !ctx?.league_id) {
      setPendingTypes([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/hub/contract/pending-types");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setPendingTypes(data.pending || []);
      } catch {
        if (!cancelled) setPendingTypes([]);
      }
    })();
    return () => { cancelled = true; };
  }, [isCommissioner, ctx?.league_id, msg]);

  useEffect(() => {
    const tz = ctx?.draft_timezone || browserTimeZone();
    setDraftTz(tz);
    setDraftWall(utcIsoToWall(ctx?.draft_starts_at, tz));
  }, [ctx?.draft_starts_at, ctx?.draft_timezone]);

  const decidePending = async (playerId, approve) => {
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch("/api/hub/contract/pending-types/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: playerId, approve }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      setPendingTypes((prev) => prev.filter((p) => p.player_id !== playerId));
      setMsg(approve ? "Contract type approved." : "Contract type rejected.");
      onLeagueCreated?.();
    } catch (e) {
      setError(e.message || "Could not update pending type");
    } finally {
      setBusy(false);
    }
  };

  const toggleDraftCompleted = async () => {
    if (!ctx?.league_id) return;
    if (!draftCompleted) {
      const ok = window.confirm(
        "This starts the new contract year. Every active player’s years left will drop by 1. Anyone at 0 leaves as a free agent. Continue?",
      );
      if (!ok) return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch(`/api/hub/league/${ctx.league_id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft_completed: !draftCompleted }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      onLeagueCreated?.(data);
      const tick = data.contract_year_tick;
      if (!draftCompleted && tick) {
        const parts = [`Contracts updated: ${tick.advanced || 0} players −1 year`];
        if (tick.expired) parts.push(`${tick.expired} became FA`);
        setMsg(parts.join("; ") + ".");
      } else {
        setMsg(draftCompleted ? "Back to pre-draft mode." : "Draft marked complete.");
      }
    } catch (e) {
      setError(e.message || "Could not update league settings");
    } finally {
      setBusy(false);
    }
  };

  const saveDraftNight = async (clear = false) => {
    if (!ctx?.league_id) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await apiFetch(`/api/hub/league/${ctx.league_id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          clear
            ? { clear_draft_start: true }
            : { draft_starts_at: draftWall, draft_timezone: draftTz },
        ),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      onLeagueCreated?.(data);
      setMsg(clear ? "Draft time cleared." : "Draft night saved.");
    } catch (e) {
      setError(e.message || "Could not save draft time");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`hub-league-setup${mobileLayout ? " hub-league-setup--mobile" : ""}`}>
      <LeagueSwitcher
        memberships={memberships}
        hubContext={ctx}
        onSwitch={onLeagueSwitch}
        onCreateLeague={onCreateLeague}
        variant="panel"
        disabled={busy}
        hideActiveHero={hideActiveHero}
      />

      {inLeague && (
        <div className="hub-league-setup-toolbar">
          <div className="hub-league-setup-badges">
            <span className={`hub-draft-phase-pill${draftCompleted ? " is-post" : " is-pre"}`}>
              {draftCompleted ? "Post-draft" : "Pre-draft"}
            </span>
            {isCommissioner && <span className="hub-commish-badge">Commissioner</span>}
            {!isCommissioner && <span className="hub-member-badge">Member</span>}
          </div>
          <div className="hub-league-setup-toolbar-actions">
            {isCommissioner && onLeagueSync && ctx.league_id && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={leagueSyncing || busy}
                onClick={() => onLeagueSync(ctx.league_id)}
              >
                {leagueSyncing ? "Syncing…" : "Sync Sleeper"}
              </button>
            )}
            {isCommissioner && (
              <>
                <label className="hub-toggle-row hub-toggle-row-compact">
                  <input
                    type="checkbox"
                    checked={draftCompleted}
                    disabled={busy}
                    onChange={toggleDraftCompleted}
                  />
                  <span>Draft done</span>
                </label>
                {onNavigate && (
                  <button type="button" className="btn-ghost btn-sm" onClick={() => onNavigate("league-rosters")}>
                    All teams
                  </button>
                )}
              </>
            )}
          </div>
          {leagueSyncMessage && <p className="chart-note hub-league-sync-msg">{leagueSyncMessage}</p>}
          {leagueSyncError && <div className="error hub-league-sync-error">{leagueSyncError}</div>}
        </div>
      )}

      {inLeague && isCommissioner && !draftCompleted && (
        <div className="hub-draft-schedule hub-draft-schedule--setup">
          <h3 className="hub-pending-types-title">Draft night</h3>
          <p className="chart-note">
            {ctx?.draft_starts_at
              ? formatDraftScheduleLabel(ctx.draft_starts_at, draftTz)
              : "Set a date so managers can plan. The room auto-starts at that time."}
          </p>
          <label>
            Date & time
            <input
              type="datetime-local"
              value={draftWall}
              onChange={(e) => setDraftWall(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            Timezone
            <select value={draftTz} onChange={(e) => setDraftTz(e.target.value)} disabled={busy}>
              {(DRAFT_TZ_OPTIONS.includes(draftTz) ? DRAFT_TZ_OPTIONS : [draftTz, ...DRAFT_TZ_OPTIONS]).map((tz) => (
                <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
              ))}
            </select>
          </label>
          <div className="hub-draft-schedule-actions">
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={busy || !draftWall}
              onClick={() => saveDraftNight(false)}
            >
              Save draft time
            </button>
            {ctx?.draft_starts_at && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={busy}
                onClick={() => saveDraftNight(true)}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {isCommissioner && pendingTypes.length > 0 && (
        <div className="hub-pending-types">
          <h3 className="hub-pending-types-title">Pending contract types</h3>
          <ul className="hub-pending-types-list">
            {pendingTypes.map((p) => (
              <li key={p.player_id} className="hub-pending-types-item">
                <div>
                  <strong>{p.player_name}</strong>
                  <span className="table-meta">
                    {" · "}{p.team_name || "Team"}
                    {" · "}{TYPE_LABEL[p.current_type] || p.current_type}
                    {" → "}{TYPE_LABEL[p.pending_type] || p.pending_type}
                  </span>
                </div>
                <div className="hub-pending-types-actions">
                  <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => decidePending(p.player_id, true)}>
                    Approve
                  </button>
                  <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => decidePending(p.player_id, false)}>
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="hub-league-setup-add">
        <button
          type="button"
          className={`${showAddLeague ? "btn-ghost" : "btn-primary"} btn-sm hub-league-setup-add-toggle`}
          onClick={() => setShowAddLeague((v) => !v)}
          aria-expanded={showAddLeague}
        >
          {showAddLeague ? "Hide create / join" : "Create or join a league"}
        </button>

        {showAddLeague && (
          <>
            <p className="chart-note hub-league-setup-lead">
              {leagues.length === 0
                ? "Start a ScoreSense league room, or join with a room code from your commissioner."
                : "Create another league without leaving this one. You can switch back from the league menu."}
            </p>
            <LeagueCreateJoinForm
              season={season}
              presets={presets}
              busy={busy}
              onBusy={setBusy}
              onSuccess={(data, message) => {
                setError("");
                setMsg(message || "League ready.");
                setShowAddLeague(false);
                onLeagueCreated?.(data);
              }}
            />
          </>
        )}
      </div>

      {msg && <p className="chart-note hub-league-setup-msg">{msg}</p>}
      {error && <div className="error">{error}</div>}
    </section>
  );
}
