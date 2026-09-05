import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../auth";
import { formatRelativeTime, parseApiError } from "../format";
import { HubFilterMenu } from "./HubUILayout";
import useMobileLayout from "../useMobileLayout";

export default function SleeperLink({ workspace, hubContext, onLinked, onRosterChanged }) {
  const mobileLayout = useMobileLayout();
  const inLeague = hubContext?.mode === "league";
  const leagueSleeperId = hubContext?.sleeper_league_id || workspace?.sleeper_league_id || "";
  const [teams, setTeams] = useState([]);
  const [leagueMeta, setLeagueMeta] = useState(null);
  const [leagueId, setLeagueId] = useState(leagueSleeperId);
  const [rosterId, setRosterId] = useState(workspace?.sleeper_roster_id || "");
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [showConnectionForm, setShowConnectionForm] = useState(false);
  const [lookupMode, setLookupMode] = useState("id");
  const [sleeperUsername, setSleeperUsername] = useState("");
  const [lookupSeason, setLookupSeason] = useState(String(new Date().getFullYear()));
  const [userLeagues, setUserLeagues] = useState([]);
  const [loadingLeagues, setLoadingLeagues] = useState(false);

  useEffect(() => {
    setLeagueId(hubContext?.sleeper_league_id || workspace?.sleeper_league_id || "");
    setRosterId(workspace?.sleeper_roster_id || "");
  }, [workspace, hubContext]);

  const loadTeams = useCallback(async () => {
    if (!leagueId.trim()) return;
    setLoadingTeams(true);
    setError("");
    try {
      const res = await apiFetch(`/api/hub/sleeper/league/${encodeURIComponent(leagueId.trim())}/teams`);
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setTeams(data.teams || []);
      setLeagueMeta({ name: data.league_name, season: data.season });
      if (!rosterId && data.teams?.length === 1) {
        setRosterId(data.teams[0].roster_id);
      }
    } catch (e) {
      setError(e.message || "Could not load Sleeper league");
      setTeams([]);
    } finally {
      setLoadingTeams(false);
    }
  }, [leagueId, rosterId]);

  const loadUserLeagues = async () => {
    const user = sleeperUsername.trim().replace(/^@/, "");
    if (!user) {
      setError("Enter your Sleeper username.");
      return;
    }
    setLoadingLeagues(true);
    setError("");
    setUserLeagues([]);
    try {
      const res = await apiFetch(
        `/api/hub/sleeper/user/${encodeURIComponent(user)}/leagues?season=${encodeURIComponent(lookupSeason)}`,
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setUserLeagues(data.leagues || []);
      if (!(data.leagues || []).length) {
        setError(`No leagues found for @${data.username || user} in ${lookupSeason}.`);
      }
    } catch (e) {
      setError(e.message || "Could not load leagues");
    } finally {
      setLoadingLeagues(false);
    }
  };

  const pickUserLeague = async (lg) => {
    const lid = lg.league_id;
    setLeagueId(lid);
    setLeagueMeta({ name: lg.name, season: lg.season });
    setLoadingTeams(true);
    setError("");
    try {
      const res = await apiFetch(`/api/hub/sleeper/league/${encodeURIComponent(lid)}/teams`);
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setTeams(data.teams || []);
      setLeagueMeta({ name: data.league_name || lg.name, season: data.season || lg.season });
      if (!rosterId && data.teams?.length === 1) {
        setRosterId(data.teams[0].roster_id);
      }
    } catch (e) {
      setError(e.message || "Could not load teams for league");
      setTeams([]);
    } finally {
      setLoadingTeams(false);
    }
  };

  const saveLink = async () => {
    if (!leagueId.trim() || !rosterId) {
      setError("Enter your Sleeper league ID and pick your team.");
      return;
    }
    setSaving(true);
    setError("");
    setMsg("");
    try {
      const team = teams.find((t) => t.roster_id === rosterId);
      const res = await apiFetch("/api/hub/sleeper/link", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sleeper_league_id: leagueId.trim(),
          sleeper_roster_id: rosterId,
          sleeper_team_name: team?.team_name,
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      const imported = data.imported_to_hub ?? 0;
      const trades = data.trade_count ?? 0;
      const teamsSynced = data.teams_synced ?? 0;
      let statusMsg = `Connected to ${data.sleeper?.sleeper_team_name || "your team"}.`;
      if (data.full_league_import && teamsSynced > 0) {
        statusMsg = `Imported all ${teamsSynced} Sleeper teams (${imported} players). Open All teams to review.`;
      } else if (imported) {
        statusMsg += ` ${imported} players synced.`;
      }
      if (trades) statusMsg += ` ${trades} contract move(s) from Sleeper trades.`;
      setMsg(statusMsg);
      if (data.snapshot?.unmatched?.length) {
        setMsg((m) => `${m} (${data.snapshot.unmatched.length} DEF/K skipped.)`);
      }
      setShowConnectionForm(false);
      onLinked?.(data.hub_context ? data : data.workspace);
      onRosterChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const syncRoster = async () => {
    setSyncing(true);
    setError("");
    setMsg("");
    try {
      const res = await apiFetch("/api/hub/sleeper/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ import_to_hub: true }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      const n = data.snapshot?.count ?? 0;
      const pruned = data.pruned_junk ?? 0;
      const trades = data.trade_count ?? 0;
      const teamsSynced = data.teams_synced ?? 0;
      let statusMsg = data.message
        || (data.full_league_import && teamsSynced > 0
          ? `Imported all ${teamsSynced} Sleeper teams (${data.imported_to_hub ?? n} players).`
          : `Updated from Sleeper: ${data.imported_to_hub ?? n} players synced`);
      if (trades && !data.full_league_import) statusMsg += ` · ${trades} contract move(s)`;
      if (pruned) statusMsg += ` (removed ${pruned} stale rows)`;
      setMsg(`${statusMsg}.`);
      onLinked?.(data.hub_context ? data : data.workspace);
      onRosterChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  };

  const clearHubRoster = async () => {
    setSyncing(true);
    try {
      const res = await apiFetch("/api/hub/sleeper/clear-roster", { method: "POST" });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setMsg(`Roster cleaned. ${data.roster_count ?? 0} players remain.`);
      onRosterChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  };

  const repairRoster = async () => {
    setSyncing(true);
    setError("");
    try {
      const res = await apiFetch("/api/hub/sleeper/repair-roster", { method: "POST" });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setMsg(`Repaired roster. ${data.roster_count ?? 0} players remain.`
        + (data.reattach?.reattached ? ` (${data.reattach.reattached} reassigned to your team)` : "")
        + (data.sync?.merge?.added ? ` · ${data.sync.merge.added} added from Sleeper` : "")
        + ".");
      onRosterChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  };

  const clearLink = async () => {
    setSaving(true);
    try {
      const res = await apiFetch("/api/hub/sleeper/link", { method: "DELETE" });
      if (!res.ok) throw new Error(await parseApiError(res));
      setTeams([]);
      setRosterId("");
      setLeagueId("");
      setShowConnectionForm(false);
      setMsg("Sleeper disconnected.");
      onLinked?.((await res.json()).workspace);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const linked = Boolean(
    (hubContext?.sleeper_league_id || workspace?.sleeper_league_id)
    && (hubContext?.sleeper_roster_id || workspace?.sleeper_roster_id),
  );
  const playerCount = (workspace?.sleeper_player_ids?.length ?? hubContext?.sleeper_player_ids?.length) || 0;
  const syncedLabel = formatRelativeTime(workspace?.sleeper_synced_at || hubContext?.sleeper_synced_at);
  const showForm = !linked || showConnectionForm;

  return (
    <section className={`hub-sleeper-panel${mobileLayout ? " hub-sleeper-panel--mobile" : ""}`}>
      <p className="chart-note hub-sleeper-desc">
        {inLeague && hubContext?.is_commissioner
          ? "Link your team; sync imports all rosters."
          : inLeague
            ? "Link your team. Sync after trades."
            : "Enter league ID, pick your team."}
      </p>

      {linked && !showForm && (
        <div className="hub-sleeper-connected">
          <div className="hub-sleeper-banner" role="status">
            <div className="hub-sleeper-banner-main">
              <span className="hub-sleeper-status-dot" aria-hidden="true" />
              <div>
                <strong>{hubContext?.sleeper_team_name || workspace.sleeper_team_name || "Your team"}</strong>
                <span className="table-meta hub-sleeper-banner-meta">
                  {playerCount} players in ScoreSense
                  {syncedLabel ? ` · ${syncedLabel}` : " · not synced yet"}
                </span>
              </div>
            </div>
          </div>
          <div className="hub-sleeper-actions">
            <button type="button" className="btn-primary" onClick={syncRoster} disabled={syncing}>
              {syncing ? "Syncing from Sleeper…" : "Sync from Sleeper"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setShowConnectionForm(true)}>
              Change league or team
            </button>
          </div>
          <details className="hub-setup-troubleshoot">
            <summary>Roster looks wrong? Troubleshoot</summary>
            <p className="chart-note">
              Missing or wrong players after import.
            </p>
            <div className="hub-toolbar">
              <button type="button" className="btn-ghost btn-sm" onClick={repairRoster} disabled={syncing}>
                Repair roster
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={clearHubRoster} disabled={syncing}>
                Clear imported players
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={clearLink} disabled={saving}>
                Disconnect Sleeper
              </button>
            </div>
          </details>
        </div>
      )}

      {showForm && (
        <div className="hub-sleeper-wizard">
          {linked && (
            <p className="chart-note">Update connection below.</p>
          )}
          <div className="hub-sleeper-lookup-toggle">
            <button
              type="button"
              className={`btn-ghost btn-sm${lookupMode === "username" ? " active" : ""}`}
              onClick={() => setLookupMode("username")}
            >
              Find by username
            </button>
            <button
              type="button"
              className={`btn-ghost btn-sm${lookupMode === "id" ? " active" : ""}`}
              onClick={() => setLookupMode("id")}
            >
              Enter league ID
            </button>
          </div>
          <ol className="hub-sleeper-steps">
            {lookupMode === "username" ? (
              <>
                <li>
                  <label>
                    <span className="hub-field-label">Sleeper username</span>
                    <span className="hub-field-hint">Your @handle on Sleeper</span>
                    <input
                      value={sleeperUsername}
                      onChange={(e) => setSleeperUsername(e.target.value)}
                      placeholder="e.g. yourhandle"
                    />
                  </label>
                  <label>
                    <span className="hub-field-label">Season</span>
                    <input
                      type="number"
                      min={2015}
                      max={2035}
                      value={lookupSeason}
                      onChange={(e) => setLookupSeason(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={loadUserLeagues}
                    disabled={loadingLeagues || !sleeperUsername.trim()}
                  >
                    {loadingLeagues ? "Searching…" : "Find my leagues"}
                  </button>
                </li>
                {userLeagues.length > 0 && (
                  <li>
                    <span className="hub-field-label">Pick a league</span>
                    <ul className="hub-sleeper-league-pick-list">
                      {userLeagues.map((lg) => (
                        <li key={lg.league_id}>
                          <button
                            type="button"
                            className={`hub-sleeper-league-pick${leagueId === lg.league_id ? " active" : ""}`}
                            onClick={() => pickUserLeague(lg)}
                            disabled={loadingTeams}
                          >
                            <strong>{lg.name}</strong>
                            <span className="table-meta">
                              {lg.season} · {lg.total_rosters || "?"} teams
                              {lg.status ? ` · ${lg.status}` : ""}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                )}
              </>
            ) : (
              <li>
                <label>
                  <span className="hub-field-label">Sleeper league ID</span>
                  <span className="hub-field-hint">
                    {inLeague && leagueSleeperId
                      ? "Must match commissioner’s Sleeper league."
                      : "Sleeper → League settings → copy ID"}
                  </span>
                  <input
                    value={leagueId}
                    onChange={(e) => setLeagueId(e.target.value)}
                    placeholder="e.g. 1257419072740644612"
                    readOnly={inLeague && Boolean(leagueSleeperId)}
                  />
                </label>
                <button type="button" className="btn-ghost btn-sm" onClick={loadTeams} disabled={loadingTeams || !leagueId.trim()}>
                  {loadingTeams ? "Loading…" : "Find teams"}
                </button>
              </li>
            )}
            {leagueMeta && (
              <li className="hub-sleeper-league-meta">
                Found <strong>{leagueMeta.name}</strong> ({leagueMeta.season} season, {teams.length} teams)
              </li>
            )}
            {teams.length > 0 && (
              <li>
                <HubFilterMenu
                  label="Your team"
                  value={rosterId}
                  options={[
                    { id: "", label: "Select your team…" },
                    ...teams.map((t) => ({
                      id: t.roster_id,
                      label: `${t.team_name} (${t.player_count} players${t.owner_name ? ` · ${t.owner_name}` : ""})`,
                    })),
                  ]}
                  onChange={setRosterId}
                />
              </li>
            )}
          </ol>
          <div className="hub-toolbar">
            <button type="button" className="btn-primary" onClick={saveLink} disabled={saving || !rosterId}>
              {saving ? "Connecting…" : linked ? "Save connection" : "Connect & import roster"}
            </button>
            {linked && (
              <button type="button" className="btn-ghost" onClick={() => setShowConnectionForm(false)}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {msg && <p className="hub-status-msg">{msg}</p>}
      {error && <div className="error">{error}</div>}
    </section>
  );
}
