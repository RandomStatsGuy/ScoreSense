import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import MobileDataList from "../MobileDataList";
import MobilePlayerCard from "../MobilePlayerCard";
import { HubFilterMenu } from "./HubUILayout";
import { OFFICE_CONTRACTS_COPY } from "./officeContractsPresentation";
import {
  SLEEPER_LINK_COPY,
  SLEEPER_SYNC_PAUSE_COPY,
  SLEEPER_UNLINK_COPY,
  sleeperSyncPaused,
  sleeperUnlinkSummary,
} from "./leagueAccessCopy";

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
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [unlinkPreview, setUnlinkPreview] = useState(null);
  const [unlinkBusy, setUnlinkBusy] = useState(false);
  const [keepRosters, setKeepRosters] = useState(false);
  const serverPaused = sleeperSyncPaused({ overview, hubContext });
  const [paused, setPaused] = useState(serverPaused);
  const [pauseBusy, setPauseBusy] = useState(false);
  const mobileLayout = useMobileLayout();

  useEffect(() => {
    setPaused(serverPaused);
  }, [serverPaused]);

  const keepSleeperRosters = keepRosters || paused;

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
        data.sleeper_sync_paused
          ? data.message
          : `Synced ${data.teams_synced ?? 0} team(s) from Sleeper`
            + (data.trade_count ? ` · ${SLEEPER_LINK_COPY.movedPlayers(data.trade_count)}` : "")
            + ".",
      );
      onConnected?.(data);
    } catch (e) {
      setError(e.message || "Could not sync from Sleeper");
    } finally {
      setSyncing(false);
    }
  };

  const setSyncPaused = async (nextPaused) => {
    setPauseBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/sleeper/sync-mode`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: nextPaused ? "off" : "live" }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setPaused(Boolean(data.sleeper_sync?.paused));
      setMsg(data.sleeper_sync?.paused ? SLEEPER_SYNC_PAUSE_COPY.pausedDone : SLEEPER_SYNC_PAUSE_COPY.resumedDone);
      onConnected?.(data);
    } catch (e) {
      setError(e.message || "Could not change Sleeper roster sync");
    } finally {
      setPauseBusy(false);
    }
  };

  const openUnlink = async () => {
    setUnlinkOpen(true);
    setError("");
    setMsg("");
    try {
      const res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/sleeper/disconnect`,
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      setUnlinkPreview(await res.json());
    } catch (e) {
      setError(e.message || "Could not read the Sleeper link");
    }
  };

  const runUnlink = async () => {
    setUnlinkBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/sleeper/disconnect`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clear_sleeper_roster: !keepSleeperRosters }),
        },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setUnlinkOpen(false);
      setUnlinkPreview(null);
      setSleeperTeams([]);
      setSleeperMeta(null);
      setMsg(SLEEPER_UNLINK_COPY.done);
      onConnected?.(data);
    } catch (e) {
      setError(e.message || "Could not unlink Sleeper");
    } finally {
      setUnlinkBusy(false);
    }
  };

  const unlinkRows = Number(unlinkPreview?.sleeper_roster_rows) || 0;

  return (
    <section className="hub-league-sleeper-connect">
      <h3>Link Sleeper</h3>
      <p className="chart-note">
        {SLEEPER_LINK_COPY.importSupport}
      </p>

      {needsFullImport && (
        <div className="hub-league-sleeper-alert">
          <strong>Only {linkedCount} of {sleeperTeamCount} Sleeper teams linked.</strong>
          <p className="chart-note">
            Import to add all teams and rosters.
          </p>
          <button type="button" className="btn-primary" onClick={connectAll} disabled={connecting || loading || paused}>
            {connecting ? "Importing…" : `Import all ${sleeperTeamCount} Sleeper teams`}
          </button>
          {paused && <p className="chart-note">{SLEEPER_SYNC_PAUSE_COPY.importPaused}</p>}
        </div>
      )}

      {hasSleeperLink && fullyLinked && !needsFullImport && (
        <div className="hub-sleeper-connected hub-league-sleeper-status">
          <span className="hub-roster-cap-pill hub-roster-cap-pill-ok">
            {OFFICE_CONTRACTS_COPY.sleeperLinked(linkedCount, hubTeamCount)}
          </span>
          {!paused && (
            <button type="button" className="btn-ghost btn-sm" onClick={syncAll} disabled={syncing}>
              {syncing ? "Syncing…" : OFFICE_CONTRACTS_COPY.refreshAction}
            </button>
          )}
          {!paused && (
            <p className="chart-note hub-sleeper-refresh-support">
              {OFFICE_CONTRACTS_COPY.refreshSupport}
            </p>
          )}
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
          {!paused && (
            <button type="button" className="btn-ghost btn-sm" onClick={syncAll} disabled={syncing}>
              {syncing ? "Syncing…" : OFFICE_CONTRACTS_COPY.refreshAction}
            </button>
          )}
          {!paused && (
            <p className="chart-note hub-sleeper-refresh-support">
              {OFFICE_CONTRACTS_COPY.refreshSupport}
            </p>
          )}
        </div>
      )}

      {hasSleeperLink && (
        <div className="hub-league-sleeper-pause">
          <h4>{SLEEPER_SYNC_PAUSE_COPY.title}</h4>
          {paused && (
            <span className="hub-roster-cap-pill">{SLEEPER_SYNC_PAUSE_COPY.pausedPill}</span>
          )}
          <p className="chart-note">
            {paused ? SLEEPER_SYNC_PAUSE_COPY.pausedSupport : SLEEPER_SYNC_PAUSE_COPY.liveSupport}
          </p>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => setSyncPaused(!paused)}
            disabled={pauseBusy}
          >
            {pauseBusy
              ? SLEEPER_SYNC_PAUSE_COPY.busy
              : paused
                ? SLEEPER_SYNC_PAUSE_COPY.resume
                : SLEEPER_SYNC_PAUSE_COPY.pause}
          </button>
        </div>
      )}

      {!hasSleeperLink && (
        <div className="hub-form-row hub-league-sleeper-row">
          <label>
            Sleeper league ID
            <input
              value={sleeperLeagueId}
              onChange={(e) => setSleeperLeagueId(e.target.value)}
              placeholder="e.g. 1257419072740644612"
            />
          </label>
          <button type="button" className="btn-ghost btn-sm" onClick={() => loadSleeperTeams()} disabled={loading || !sleeperLeagueId.trim()}>
            {loading ? "Loading…" : "Load teams"}
          </button>
        </div>
      )}

      {hasSleeperLink && (
        <details className="hub-league-sleeper-remap">
          <summary>{OFFICE_CONTRACTS_COPY.changeMapping}</summary>
          <div className="hub-form-row hub-league-sleeper-row">
            <label>
              Sleeper league ID
              <input
                value={sleeperLeagueId}
                onChange={(e) => setSleeperLeagueId(e.target.value)}
                placeholder="e.g. 1257419072740644612"
              />
            </label>
            <button type="button" className="btn-ghost btn-sm" onClick={() => loadSleeperTeams()} disabled={loading || !sleeperLeagueId.trim()}>
              {loading ? "Loading…" : "Load teams"}
            </button>
          </div>
        </details>
      )}

      {hasSleeperLink && (
        <div className="hub-league-sleeper-unlink">
          <h4>{SLEEPER_UNLINK_COPY.title}</h4>
          <p className="chart-note">{SLEEPER_UNLINK_COPY.support}</p>
          {!unlinkOpen ? (
            <button type="button" className="btn-ghost btn-sm" onClick={openUnlink}>
              {SLEEPER_UNLINK_COPY.start}
            </button>
          ) : (
            <div className="hub-league-sleeper-unlink-confirm">
              <p className="chart-note">
                {sleeperUnlinkSummary({
                  teamsLinked: unlinkPreview?.teams_linked ?? linkedCount,
                  rosterRows: unlinkRows,
                  clearRoster: !keepSleeperRosters,
                })}
              </p>
              <label className="hub-league-sleeper-unlink-keep">
                <input
                  type="checkbox"
                  checked={keepSleeperRosters}
                  disabled={paused}
                  onChange={(e) => setKeepRosters(e.target.checked)}
                />
                {SLEEPER_UNLINK_COPY.keepRosters}
              </label>
              <p className={keepSleeperRosters ? "chart-note" : "chart-note is-warn"}>
                {paused
                  ? SLEEPER_SYNC_PAUSE_COPY.unlinkKeepsRosters
                  : keepSleeperRosters
                    ? SLEEPER_UNLINK_COPY.rosterKept
                    : SLEEPER_UNLINK_COPY.rosterWarning(unlinkRows)}
              </p>
              <div className="hub-league-sleeper-unlink-actions">
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  onClick={runUnlink}
                  disabled={unlinkBusy}
                >
                  {unlinkBusy ? SLEEPER_UNLINK_COPY.busy : SLEEPER_UNLINK_COPY.confirm}
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    setUnlinkOpen(false);
                    setUnlinkPreview(null);
                  }}
                  disabled={unlinkBusy}
                >
                  {SLEEPER_UNLINK_COPY.cancel}
                </button>
              </div>
              <p className="chart-note">{SLEEPER_UNLINK_COPY.relinkHint}</p>
            </div>
          )}
        </div>
      )}

      {sleeperMeta && (
        <p className="chart-note">
          Found <strong>{sleeperMeta.name}</strong> ({sleeperMeta.season}) · {sleeperTeams.length} teams in Sleeper
        </p>
      )}

      {sleeperTeams.length > 0 && (
        <>
          <HubFilterMenu
            label="Your Sleeper team"
            value={commRosterId}
            options={[
              { id: "", label: "Auto-match by name" },
              ...sleeperTeams.map((t) => ({
                id: t.roster_id,
                label: `${t.team_name} (${t.player_count} players${t.owner_name ? ` · ${t.owner_name}` : ""})`,
              })),
            ]}
            onChange={setCommRosterId}
          />

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
                    heroLabel="Seat"
                    heroMuted
                    expanded={(
                      <HubFilterMenu
                        label="Fantasy team"
                        value={mappings[st.roster_id] ?? ""}
                        options={[
                          { id: "", label: "Create new team" },
                          ...hubTeams.map((ht) => ({
                            id: ht.id,
                            label: `${ht.name}${ht.user_sub ? " · claimed" : ""}`,
                          })),
                        ]}
                        onChange={(id) => setMappings((prev) => ({ ...prev, [st.roster_id]: id }))}
                      />
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
                        <HubFilterMenu
                          label="Fantasy team"
                          value={mappings[st.roster_id] ?? ""}
                          options={[
                            { id: "", label: "Create new team" },
                            ...hubTeams.map((ht) => ({
                              id: ht.id,
                              label: `${ht.name}${ht.user_sub ? " · claimed" : ""}`,
                            })),
                          ]}
                          onChange={(id) => setMappings((prev) => ({ ...prev, [st.roster_id]: id }))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </details>

          <button type="button" className="btn-primary" onClick={connectAll} disabled={connecting || loading || paused}>
            {connecting ? "Connecting…" : needsFullImport ? `Import all ${sleeperTeams.length} teams` : "Update links & import rosters"}
          </button>
          {paused && <p className="chart-note">{SLEEPER_SYNC_PAUSE_COPY.importPaused}</p>}
        </>
      )}

      {msg && <p className="hub-status-msg">{msg}</p>}
      {error && <div className="error">{error}</div>}
    </section>
  );
}
