import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import MobileDataList from "../MobileDataList";
import MobilePlayerCard from "../MobilePlayerCard";

export default function LeagueSleeperConnect({ leagueId, hubContext, overview, onConnected }) {
  const linkedLeagueId = overview?.league?.sleeper_league_id || hubContext?.sleeper_league_id || "";
  const hubTeams = useMemo(
    () => (overview?.teams || []).map((b) => b.team),
    [overview?.teams],
  );

  const [sleeperLeagueId, setSleeperLeagueId] = useState(linkedLeagueId);
  const [sleeperTeams, setSleeperTeams] = useState([]);
  const [sleeperMeta, setSleeperMeta] = useState(null);
  const [commRosterId, setCommRosterId] = useState(hubContext?.sleeper_roster_id || "");
  const [mappings, setMappings] = useState({});
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const mobileLayout = useMobileLayout();

  useEffect(() => {
    setSleeperLeagueId(linkedLeagueId);
  }, [linkedLeagueId]);

  useEffect(() => {
    if (hubContext?.sleeper_roster_id) {
      setCommRosterId(hubContext.sleeper_roster_id);
    }
  }, [hubContext?.sleeper_roster_id]);

  const loadSleeperTeams = useCallback(async (leagueIdOverride) => {
    const slId = String(leagueIdOverride ?? sleeperLeagueId ?? "").trim();
    if (!slId) return [];
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/hub/sleeper/league/${encodeURIComponent(slId)}/teams`);
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      const teams = data.teams || [];
      setSleeperTeams(teams);
      setSleeperMeta({ name: data.league_name, season: data.season });
      const initial = {};
      const byName = Object.fromEntries(hubTeams.map((t) => [String(t.name).toLowerCase(), t.id]));
      const bySl = Object.fromEntries(
        hubTeams.filter((t) => t.sleeper_roster_id).map((t) => [String(t.sleeper_roster_id), t.id]),
      );
      for (const st of teams) {
        const rid = st.roster_id;
        if (bySl[rid]) initial[rid] = bySl[rid];
        else if (byName[String(st.team_name).toLowerCase()]) initial[rid] = byName[String(st.team_name).toLowerCase()];
        else initial[rid] = "";
      }
      setMappings(initial);
      return teams;
    } catch (e) {
      setError(e.message || "Could not load Sleeper league");
      setSleeperTeams([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [hubTeams, sleeperLeagueId]);

  const linkedCount = hubTeams.filter((t) => t.sleeper_roster_id).length;
  const hubTeamCount = hubTeams.length;
  const fullyLinked = Boolean(linkedLeagueId && hubTeamCount > 0 && linkedCount >= hubTeamCount);
  const sleeperTeamCount = sleeperTeams.length || (fullyLinked ? linkedCount : 0);
  const needsFullImport = sleeperTeamCount > 0 && linkedCount < sleeperTeamCount;
  const hasSleeperLink = Boolean(linkedLeagueId);

  const connectWithTeams = async (teams, slId) => {
    const payload = {
      sleeper_league_id: slId.trim(),
      commissioner_sleeper_roster_id: commRosterId || hubContext?.sleeper_roster_id || undefined,
      mappings: teams.map((st) => {
        const hubId = mappings[st.roster_id];
        if (hubId) return { sleeper_roster_id: st.roster_id, hub_team_id: hubId };
        return { sleeper_roster_id: st.roster_id, team_name: st.team_name };
      }),
    };
    const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/sleeper/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await parseApiError(res));
    return res.json();
  };

  const connectAll = async () => {
    if (!sleeperLeagueId.trim()) {
      setError("Enter your Sleeper league ID.");
      return;
    }
    setConnecting(true);
    setError("");
    setMsg("");
    try {
      const teams = sleeperTeams.length ? sleeperTeams : await loadSleeperTeams(sleeperLeagueId.trim());
      if (!teams.length) {
        setError("No Sleeper teams found — check the league ID.");
        return;
      }
      const data = await connectWithTeams(teams, sleeperLeagueId);
      const added = data.merge?.added ?? 0;
      const connected = data.teams_connected ?? 0;
      setMsg(
        `Imported ${connected} team(s) from ${data.sleeper_league_name || "Sleeper"}`
        + ` — ${added} new players added. Edit salaries for each team below.`,
      );
      onConnected?.(data);
    } catch (e) {
      setError(e.message || "Could not connect Sleeper league");
    } finally {
      setConnecting(false);
    }
  };

  const syncAll = async () => {
    setSyncing(true);
    setError("");
    setMsg("");
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/sleeper/sync`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setMsg(
        `Synced ${data.teams_synced ?? 0} team(s) from Sleeper`
        + (data.trade_count ? ` · ${data.trade_count} contract move(s)` : "")
        + ".",
      );
      onConnected?.(data);
    } catch (e) {
      setError(e.message || "Could not sync from Sleeper");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <section className="hub-league-sleeper-connect">
      <h3>Import Sleeper league</h3>
      <p className="chart-note">
        Import full Sleeper league for all contracts.
      </p>

      {needsFullImport && (
        <div className="hub-league-sleeper-alert">
          <strong>Only {linkedCount} of {sleeperTeamCount} Sleeper teams linked.</strong>
          <p className="chart-note">
            Import to add all teams and rosters.
          </p>
          <button type="button" className="btn-primary" onClick={connectAll} disabled={connecting || loading}>
            {connecting ? "Importing…" : `Import all ${sleeperTeamCount} Sleeper teams`}
          </button>
        </div>
      )}

      {hasSleeperLink && fullyLinked && !needsFullImport && (
        <div className="hub-sleeper-connected hub-league-sleeper-status">
          <span className="hub-roster-cap-pill hub-roster-cap-pill-ok">
            Sleeper linked · {linkedCount}/{hubTeamCount} teams
          </span>
          <button type="button" className="btn-primary" onClick={syncAll} disabled={syncing}>
            {syncing ? "Syncing…" : "Refresh all teams from Sleeper"}
          </button>
        </div>
      )}

      {hasSleeperLink && !fullyLinked && !needsFullImport && linkedCount > 0 && (
        <div className="hub-sleeper-connected hub-league-sleeper-status">
          <span className="hub-roster-cap-pill hub-roster-cap-pill-ok">
            {sleeperMeta?.name || "Sleeper league"} · {linkedCount}/{hubTeamCount} teams linked
          </span>
          <button type="button" className="btn-ghost btn-sm" onClick={() => loadSleeperTeams(linkedLeagueId)} disabled={loading}>
            {loading ? "Loading…" : "Check Sleeper status"}
          </button>
          <button type="button" className="btn-primary" onClick={syncAll} disabled={syncing}>
            {syncing ? "Syncing…" : "Refresh all teams from Sleeper"}
          </button>
        </div>
      )}

      <div className="hub-form-row hub-league-sleeper-row">
        <label>
          Sleeper league ID
          <input
            value={sleeperLeagueId}
            onChange={(e) => setSleeperLeagueId(e.target.value)}
            placeholder="e.g. 1257419072740644612"
          />
        </label>
        <button type="button" className="btn-ghost" onClick={() => loadSleeperTeams()} disabled={loading || !sleeperLeagueId.trim()}>
          {loading ? "Loading…" : "Load teams"}
        </button>
      </div>

      {sleeperMeta && (
        <p className="chart-note">
          Found <strong>{sleeperMeta.name}</strong> ({sleeperMeta.season}) · {sleeperTeams.length} teams in Sleeper
        </p>
      )}

      {sleeperTeams.length > 0 && (
        <>
          <label className="hub-league-sleeper-comm">
            Your Sleeper team
            <select value={commRosterId} onChange={(e) => setCommRosterId(e.target.value)}>
              <option value="">Auto-match by name</option>
              {sleeperTeams.map((t) => (
                <option key={t.roster_id} value={t.roster_id}>
                  {t.team_name} ({t.player_count} players{t.owner_name ? ` · ${t.owner_name}` : ""})
                </option>
              ))}
            </select>
          </label>

          <details className="hub-league-sleeper-details" open={needsFullImport}>
            <summary>Team mapping ({sleeperTeams.length})</summary>
            {mobileLayout ? (
              <MobileDataList>
                {sleeperTeams.map((st) => (
                  <MobilePlayerCard
                    key={st.roster_id}
                    name={st.team_name}
                    meta={[
                      `${st.player_count} players`,
                      st.owner_name,
                    ].filter(Boolean).join(" · ")}
                    heroValue={mappings[st.roster_id] ? "Mapped" : "New"}
                    heroLabel="hub"
                    heroMuted
                    expanded={(
                      <label className="hub-league-sleeper-mobile-map">
                        <span className="mobile-stat-label">Hub team</span>
                        <select
                          value={mappings[st.roster_id] ?? ""}
                          onChange={(e) => setMappings((prev) => ({ ...prev, [st.roster_id]: e.target.value }))}
                        >
                          <option value="">Create new team</option>
                          {hubTeams.map((ht) => (
                            <option key={ht.id} value={ht.id}>
                              {ht.name}{ht.user_sub ? " · claimed" : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  />
                ))}
              </MobileDataList>
            ) : (
            <div className="table-wrap">
              <table className="data-table hub-table">
                <thead>
                  <tr>
                    <th>Sleeper team</th>
                    <th>Players</th>
                    <th>Hub team</th>
                  </tr>
                </thead>
                <tbody>
                  {sleeperTeams.map((st) => (
                    <tr key={st.roster_id}>
                      <td>
                        {st.team_name}
                        {st.owner_name && <span className="table-meta"> · {st.owner_name}</span>}
                      </td>
                      <td>{st.player_count}</td>
                      <td>
                        <select
                          value={mappings[st.roster_id] ?? ""}
                          onChange={(e) => setMappings((prev) => ({ ...prev, [st.roster_id]: e.target.value }))}
                        >
                          <option value="">Create new team</option>
                          {hubTeams.map((ht) => (
                            <option key={ht.id} value={ht.id}>
                              {ht.name}{ht.user_sub ? " · claimed" : ""}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </details>

          <button type="button" className="btn-primary" onClick={connectAll} disabled={connecting || loading}>
            {connecting ? "Connecting…" : needsFullImport ? `Import all ${sleeperTeams.length} teams` : "Update links & import rosters"}
          </button>
        </>
      )}

      {msg && <p className="hub-status-msg">{msg}</p>}
      {error && <div className="error">{error}</div>}
    </section>
  );
}
