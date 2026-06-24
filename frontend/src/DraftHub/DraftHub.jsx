import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { useAuth } from "../AuthContext";
import { connectionErrorMessage, parseApiError } from "../format";
import { isAbortError } from "../fetchAbort";
import { ValueSheetTableSkeleton } from "../TableSkeleton";
import AccountAuth from "../AccountAuth";
import HubSetup from "./HubSetup";
import ValueSheetTable from "./ValueSheetTable";
import RosterBuilder from "./RosterBuilder";
import DraftRoom from "./DraftRoom";
import CapPlanner from "./CapPlanner";
import CommissionerLeagueRosters from "./CommissionerLeagueRosters";
import LeagueInsights from "./LeagueInsights";
import LeagueContextBanner from "./LeagueContextBanner";
import {
  clearHubDataCache,
  getCachedPool,
  mergePoolAndOverlay,
  poolPayloadFromSheet,
  setCachedOverlay,
  setCachedPool,
} from "./hubDataCache";
import { effectiveHubContext } from "./hubContext";

const EMPTY_VALUE_ROWS = [];

/** Tabs that need the heavy value-sheet / draft-pool payload. */
const TABS_NEED_VALUE_SHEET = new Set(["value", "room"]);
/** Tabs that need cap-sheet (also hits roster on the server). */
const TABS_NEED_CAP_SHEET = new Set(["planner", "roster"]);

export default function DraftHub({ subView, onSubViewChange, onHubContextChange }) {
  const { authenticated, refreshAuth, hubAuthRequired, ready: authReady } = useAuth();
  const [workspace, setWorkspace] = useState(null);
  const [valueSheet, setValueSheet] = useState(null);
  const [roster, setRoster] = useState([]);
  const [capSheet, setCapSheet] = useState(null);
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [leagueId, setLeagueId] = useState("");
  const [hubContext, setHubContext] = useState(null);
  const [leagueSyncing, setLeagueSyncing] = useState(false);
  const [leagueSyncMessage, setLeagueSyncMessage] = useState("");
  const [leagueSyncError, setLeagueSyncError] = useState("");
  const [valueSheetLoading, setValueSheetLoading] = useState(false);

  const setSubView = onSubViewChange;
  const applyHubContext = useCallback((ctx) => {
    setHubContext(ctx);
    onHubContextChange?.(ctx);
  }, [onHubContextChange]);

  useEffect(() => {
    if (subView === "available") setSubView("value");
  }, [subView, setSubView]);

  const rosterIds = useMemo(
    () => new Set(roster.map((r) => r.player_id)),
    [roster],
  );

  const loadWorkspace = useCallback(async (signal) => {
    const res = await apiFetch("/api/hub/workspace", { signal });
    if (!res.ok) throw new Error(await parseApiError(res));
    return res.json();
  }, []);

  const loadHubContext = useCallback(async (signal) => {
    const res = await apiFetch("/api/hub/context", { signal });
    if (!res.ok) throw new Error(await parseApiError(res));
    return res.json();
  }, []);

  const loadRoster = useCallback(async (signal) => {
    const res = await apiFetch("/api/hub/roster", { signal });
    if (!res.ok) throw new Error(await parseApiError(res));
    const data = await res.json();
    return data.roster || [];
  }, []);

  const loadCapSheet = useCallback(async (signal) => {
    const res = await apiFetch("/api/hub/cap-sheet", { signal });
    if (!res.ok) throw new Error(await parseApiError(res));
    return res.json();
  }, []);

  const ensureCapSheet = useCallback(async (signal) => {
    try {
      const cap = await loadCapSheet(signal);
      if (!signal?.aborted) setCapSheet(cap);
      return cap;
    } catch (e) {
      if (!isAbortError(e)) {
        const msg = connectionErrorMessage(e);
        if (!/sign in|login required|401/i.test(msg)) setError(msg);
      }
      return null;
    }
  }, [loadCapSheet]);

  const loadValueOverlay = useCallback(async (season, signal) => {
    const q = season ? `?season=${season}&overlay_only=1` : "?overlay_only=1";
    const res = await apiFetch(`/api/hub/value-sheet${q}`, { signal });
    if (!res.ok) throw new Error(await parseApiError(res));
    const data = await res.json();
    setCachedOverlay(season, data);
    return data;
  }, []);

  const refreshValueSheet = useCallback(async (season, rules, { forcePool = false, signal } = {}) => {
    setValueSheetLoading(true);
    try {
      const cachedPool = !forcePool ? getCachedPool(season, rules) : null;
      if (cachedPool) {
        const overlay = await loadValueOverlay(season, signal);
        if (signal?.aborted) return null;
        const sheet = mergePoolAndOverlay(cachedPool, overlay);
        sheet.sleeper = overlay.sleeper;
        if (overlay.hub_context) applyHubContext(overlay.hub_context);
        setValueSheet(sheet);
        return sheet;
      }

      const q = season ? `?season=${season}` : "";
      const res = await apiFetch(`/api/hub/value-sheet${q}`, { signal });
      if (!res.ok) throw new Error(await parseApiError(res));
      const sheet = await res.json();
      if (signal?.aborted) return null;
      setCachedPool(season, rules, poolPayloadFromSheet(sheet));
      setCachedOverlay(season, sheet);
      if (sheet.hub_context) applyHubContext(sheet.hub_context);
      setValueSheet(sheet);
      return sheet;
    } catch (e) {
      if (isAbortError(e)) return null;
      const msg = connectionErrorMessage(e);
      if (!/sign in|login required|401/i.test(msg)) {
        setError(msg);
      }
      return null;
    } finally {
      setValueSheetLoading(false);
    }
  }, [loadValueOverlay, applyHubContext]);

  const refreshOverlayOnly = useCallback(async (season, rules, signal) => {
    setValueSheetLoading(true);
    try {
      const pool = getCachedPool(season, rules);
      const overlay = await loadValueOverlay(season, signal);
      if (signal?.aborted) return null;
      const sheet = mergePoolAndOverlay(pool, overlay);
      sheet.sleeper = overlay.sleeper;
      if (overlay.hub_context) applyHubContext(overlay.hub_context);
      setValueSheet(sheet);
      return sheet;
    } catch (e) {
      if (isAbortError(e)) return null;
      const msg = connectionErrorMessage(e);
      if (!/sign in|login required|401/i.test(msg)) {
        setError(msg);
      }
      return null;
    } finally {
      setValueSheetLoading(false);
    }
  }, [loadValueOverlay, applyHubContext]);

  const refreshAll = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    try {
      if (!authenticated && hubAuthRequired !== false) {
        return;
      }
      const [ws, presetsRes, rosterRows] = await Promise.all([
        loadWorkspace(signal),
        apiFetch("/api/hub/presets", { signal }),
        loadRoster(signal),
      ]);
      if (signal?.aborted) return;
      const ctx = ws.hub_context || null;
      setWorkspace({ ...ws, hub_context: ctx });
      applyHubContext(ctx);
      setLeagueId((prev) => prev || ctx?.league_id || "");
      if (presetsRes.ok) {
        const p = await presetsRes.json();
        if (!signal?.aborted) setPresets(p.presets || []);
      }
      setRoster(rosterRows);
    } catch (e) {
      if (isAbortError(e)) return;
      const msg = connectionErrorMessage(e);
      if (/sign in|login required|401/i.test(msg)) {
        setError("");
      } else {
        setError(msg);
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [
    authenticated,
    applyHubContext,
    hubAuthRequired,
    loadRoster,
    loadWorkspace,
  ]);

  /** Load heavy payloads in the background for the active tab only. */
  useEffect(() => {
    if (!workspace || loading) return undefined;
    const controller = new AbortController();
    const { signal } = controller;

    if (TABS_NEED_CAP_SHEET.has(subView) && !capSheet) {
      ensureCapSheet(signal);
    }
    if (TABS_NEED_VALUE_SHEET.has(subView) && !valueSheet) {
      refreshValueSheet(workspace.season, workspace.rules, { signal });
    }

    return () => controller.abort();
  }, [
    subView,
    workspace,
    loading,
    capSheet,
    valueSheet,
    ensureCapSheet,
    refreshValueSheet,
  ]);

  useEffect(() => {
    if (!authReady) return undefined;
    const controller = new AbortController();
    refreshAll(controller.signal);
    return () => controller.abort();
  }, [authReady, refreshAll]);

  useEffect(() => {
    const onAuthChanged = () => {
      clearHubDataCache();
      refreshAll();
    };
    window.addEventListener("scoresense-auth-changed", onAuthChanged);
    return () => window.removeEventListener("scoresense-auth-changed", onAuthChanged);
  }, [refreshAll]);

  const onWorkspaceSaved = useCallback(async (updated) => {
    setWorkspace(updated);
    if (updated?.hub_context) applyHubContext(updated.hub_context);
    clearHubDataCache();
    const cap = await loadCapSheet();
    setCapSheet(cap);
    await refreshValueSheet(updated.season, updated.rules, { forcePool: true });
  }, [applyHubContext, loadCapSheet, refreshValueSheet]);

  const onSleeperLinked = useCallback(async (payload) => {
    if (payload?.hub_context) {
      applyHubContext(payload.hub_context);
      if (payload.hub_context.league_id) setLeagueId(payload.hub_context.league_id);
    }
    const [wsRes, ctxRes] = await Promise.all([
      loadWorkspace(),
      loadHubContext().catch(() => null),
    ]);
    const ctx = ctxRes?.mode ? ctxRes : (wsRes.hub_context || payload?.hub_context || null);
    setWorkspace({ ...wsRes, hub_context: ctx });
    if (ctx) applyHubContext(ctx);
    const [rows, cap] = await Promise.all([loadRoster(), loadCapSheet()]);
    setRoster(rows);
    setCapSheet(cap);
    await refreshOverlayOnly(wsRes?.season, wsRes?.rules);
  }, [applyHubContext, loadCapSheet, loadHubContext, loadRoster, loadWorkspace, refreshOverlayOnly]);

  const onRosterChanged = useCallback(async () => {
    const [rows, cap] = await Promise.all([loadRoster(), loadCapSheet()]);
    setRoster(rows);
    setCapSheet(cap);
    await refreshOverlayOnly(workspace?.season, workspace?.rules);
  }, [loadCapSheet, loadRoster, refreshOverlayOnly, workspace?.rules, workspace?.season]);

  const onLeagueSleeperSync = useCallback(async (lid) => {
    setLeagueSyncing(true);
    setLeagueSyncError("");
    setLeagueSyncMessage("");
    setError("");
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(lid)}/sleeper/sync`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      if (data.hub_context) applyHubContext(data.hub_context);
      setLeagueSyncMessage(data.message || `Synced ${data.teams_synced ?? 0} teams.`);
      clearHubDataCache();
      await onRosterChanged();
    } catch (e) {
      const msg = connectionErrorMessage(e);
      setLeagueSyncError(msg);
      setError(msg);
    } finally {
      setLeagueSyncing(false);
    }
  }, [applyHubContext, onRosterChanged]);

  const onLeagueJoined = useCallback(async (payload) => {
    if (payload?.league_id && !payload?.test_mode) {
      setLeagueId(payload.league_id);
    } else if (payload?.league_id && payload?.test_mode) {
      setLeagueId(payload.league_id);
    }
    await refreshAll();
  }, [refreshAll]);

  const onCapChanged = useCallback(async (opts = {}) => {
    if (opts.roster) {
      await onRosterChanged();
      return;
    }
    const cap = await loadCapSheet();
    setCapSheet(cap);
  }, [loadCapSheet, onRosterChanged]);

  const onRangesUpdated = useCallback(async () => {
    clearHubDataCache();
    await refreshValueSheet(workspace?.season, workspace?.rules, { forcePool: true });
  }, [refreshValueSheet, workspace?.rules, workspace?.season]);

  const onLeagueChanged = useCallback(async (payload) => {
    if (payload?.hub_context) applyHubContext(payload.hub_context);
    if (payload?.id) setLeagueId(payload.id);
    await refreshAll();
  }, [applyHubContext, refreshAll]);

  const effectiveCtx = effectiveHubContext(hubContext, workspace);
  const valueRows = valueSheet?.rows ?? EMPTY_VALUE_ROWS;
  const valueSleeper = valueSheet?.sleeper ?? workspace;

  if (authReady && !authenticated) {
    return (
      <div className="draft-hub">
        <AccountAuth
          onAuthed={async () => {
            await refreshAuth();
            await refreshAll();
          }}
          title="Sign in for Draft Hub"
          subtitle="Sign in to save your league, Sleeper link, and rosters."
        />
      </div>
    );
  }

  if (loading && !workspace) {
    return (
      <div className="draft-hub">
        <section className="panel wide hub-panel">
          <div className="panel-head"><h2>Draft Hub</h2></div>
          <ValueSheetTableSkeleton rows={12} colSpan={12} />
        </section>
      </div>
    );
  }

  return (
    <div className="draft-hub">
      {subView !== "insights" && (
        <LeagueContextBanner
          hubContext={effectiveCtx}
          onLeagueSync={onLeagueSleeperSync}
          syncing={leagueSyncing}
          syncMessage={leagueSyncMessage}
          syncError={leagueSyncError}
        />
      )}

      {error && <div className="error">{error}</div>}

      {subView === "setup" && (
        <HubSetup
          workspace={workspace}
          hubContext={effectiveCtx}
          roster={roster}
          presets={presets}
          onSleeperLinked={onSleeperLinked}
          onRosterChanged={onRosterChanged}
          onWorkspaceSaved={onWorkspaceSaved}
          onRangesUpdated={onRangesUpdated}
          onLeagueChanged={onLeagueChanged}
          onNavigate={setSubView}
        />
      )}

      {subView === "value" && (
        <ValueSheetTable
          mode="all"
          rows={valueRows}
          season={valueSheet?.season || workspace?.season}
          onAddToRoster={onRosterChanged}
          rosterIds={rosterIds}
          sleeper={valueSleeper}
          loading={valueSheetLoading}
        />
      )}

      {subView === "roster" && (
        <RosterBuilder
          roster={roster}
          onChanged={onRosterChanged}
          valueRows={valueRows}
          sleeper={workspace}
          workspace={workspace}
          hubContext={effectiveCtx}
          capSheet={capSheet}
          readOnly={effectiveCtx?.mode === "league" && !effectiveCtx?.can_edit_salaries}
        />
      )}

      {subView === "league-rosters" && effectiveCtx?.is_commissioner && (
        <CommissionerLeagueRosters
          leagueId={effectiveCtx.league_id}
          season={workspace?.season}
          workspace={workspace}
          hubContext={effectiveCtx}
          onChanged={onRosterChanged}
        />
      )}

      {subView === "insights" && effectiveCtx?.mode === "league" && (
        <LeagueInsights
          leagueId={effectiveCtx.league_id}
          hubContext={effectiveCtx}
          onNavigate={setSubView}
        />
      )}

      {subView === "planner" && (
        <CapPlanner
          capSheet={capSheet}
          roster={roster}
          workspace={workspace}
          hubContext={effectiveCtx}
          onChanged={onCapChanged}
          onNavigate={setSubView}
        />
      )}

      {subView === "room" && (
        <DraftRoom
          leagueId={leagueId || effectiveCtx?.league_id || ""}
          onLeagueIdChange={setLeagueId}
          onLeagueJoined={onLeagueJoined}
          valueRows={valueRows}
          hubRoster={roster}
          season={valueSheet?.season || workspace?.season}
          hubContext={effectiveCtx}
          onNavigate={setSubView}
        />
      )}
    </div>
  );
}
