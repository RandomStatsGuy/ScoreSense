import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import { effectiveHubContext } from "./hubContext";
import LeagueSwitcher from "./LeagueSwitcher";
import { effectiveMemberships, isSoloContext } from "./hubLeagues";

const TYPE_LABEL = { rookie: "Rookie deal", veteran: "Veteran", extension: "Extension" };

export default function LeagueSetup({
  workspace,
  hubContext,
  memberships = [],
  presets,
  onLeagueCreated,
  onLeagueSwitch,
  onNavigate,
  onLeagueSync,
  leagueSyncing = false,
  leagueSyncMessage,
  leagueSyncError,
  hideActiveHero = false,
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

  const [leagueName, setLeagueName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamCount, setTeamCount] = useState(12);
  const [roomCode, setRoomCode] = useState("");
  const [joinTeamName, setJoinTeamName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [showAddLeague, setShowAddLeague] = useState(false);
  const [pendingTypes, setPendingTypes] = useState([]);

  const season = workspace?.season ?? new Date().getFullYear();
  const presetLabel = presets?.find((p) => p.id === "salary_cap_auction_v1")?.label || "Salary cap auction";

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

  const createLeague = async () => {
    if (!leagueName.trim()) {
      setError("Enter a league name.");
      return;
    }
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await apiFetch("/api/hub/league", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: leagueName.trim(),
          season,
          team_count: Number(teamCount) || 12,
          commissioner_team_name: teamName.trim() || "Commissioner",
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setMsg(`Created "${data.name}". Room code: ${data.room_code}. Switched to this league.`);
      setLeagueName("");
      setTeamName("");
      setShowAddLeague(false);
      onLeagueCreated?.(data);
    } catch (e) {
      setError(e.message || "Could not create league");
    } finally {
      setBusy(false);
    }
  };

  const joinLeague = async () => {
    if (!roomCode.trim() || !joinTeamName.trim()) {
      setError("Room code and team name are required to join.");
      return;
    }
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await apiFetch("/api/hub/league/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_code: roomCode.trim().toUpperCase(),
          team_name: joinTeamName.trim(),
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setMsg(`Joined as ${joinTeamName.trim()}. Switched to this league.`);
      setRoomCode("");
      setJoinTeamName("");
      setShowAddLeague(false);
      onLeagueCreated?.(data);
    } catch (e) {
      setError(e.message || "Could not join league");
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

  return (
    <section className={`hub-league-setup${mobileLayout ? " hub-league-setup--mobile" : ""}`}>
      <LeagueSwitcher
        memberships={memberships}
        hubContext={ctx}
        onSwitch={onLeagueSwitch}
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
          className="btn-ghost btn-sm hub-league-setup-add-toggle"
          onClick={() => setShowAddLeague((v) => !v)}
          aria-expanded={showAddLeague}
        >
          {showAddLeague ? "Hide" : "+ Create / join"}
        </button>

        {showAddLeague && (
          <>
            {leagues.length === 0 && soloActive && (
              <p className="chart-note hub-league-setup-lead">
                Create a league or join with a room code.
              </p>
            )}
            <div className="hub-league-setup-grid">
              <div className="hub-league-setup-card">
                <h3>Create league</h3>
                <p className="chart-note">You're commish · {presetLabel}</p>
                <div className="hub-form-col">
                  <label>
                    League name
                    <input value={leagueName} onChange={(e) => setLeagueName(e.target.value)} placeholder="Sunday Night Cap League" />
                  </label>
                  <label>
                    Your team name
                    <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="My Team" />
                  </label>
                  <label>
                    Teams
                    <input type="number" min={2} max={20} value={teamCount} onChange={(e) => setTeamCount(e.target.value)} />
                  </label>
                  <button type="button" className="btn-primary" disabled={busy} onClick={createLeague}>
                    {busy ? "Creating…" : "Create league"}
                  </button>
                </div>
              </div>

              <div className="hub-league-setup-card">
                <h3>Join with room code</h3>
                <p className="chart-note">Room code + team name from commish.</p>
                <div className="hub-form-col">
                  <label>
                    Room code
                    <input
                      value={roomCode}
                      onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                      placeholder="ABC123"
                    />
                  </label>
                  <label>
                    Team name
                    <input value={joinTeamName} onChange={(e) => setJoinTeamName(e.target.value)} placeholder="As listed by commissioner" />
                  </label>
                  <button type="button" className="btn-ghost" disabled={busy} onClick={joinLeague}>
                    Join league
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {msg && <p className="chart-note hub-league-setup-msg">{msg}</p>}
      {error && <div className="error">{error}</div>}
    </section>
  );
}
