import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { useAuth } from "../AuthContext";
import { connectionErrorMessage, parseApiError } from "../format";
import { isAbortError } from "../fetchAbort";
import HubSeasonStatus from "./HubSeasonStatus";
import { HubPage } from "./HubUILayout";
import { ValueSheetTableSkeleton } from "../TableSkeleton";
import AccountAuth from "../AccountAuth";
import VerifyEmailBanner from "../VerifyEmailBanner";
import HubSetup from "./HubSetup";
import ValueSheetTable from "./ValueSheetTable";
import RosterBuilder from "./RosterBuilder";
import DraftRoom from "./DraftRoom";
import CapPlanner from "./CapPlanner";
import CommissionerLeagueRosters from "./CommissionerLeagueRosters";
import LeagueInsights from "./LeagueInsights";
import LeagueLiveScoring from "./LeagueLiveScoring";
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
import { fetchHubMemberships, setHubFocus, effectiveMemberships } from "./hubLeagues";

const EMPTY_VALUE_ROWS = [];

/** Tabs that need the heavy value-sheet / draft-pool payload. */
const TABS_NEED_VALUE_SHEET = new Set(["value", "room"]);
/** Tabs that need cap-sheet (also hits roster on the server). */
const TABS_NEED_CAP_SHEET = new Set(["planner", "roster"]);

export default function DraftHub({ subView, onSubViewChange, onHubContextChange, insightTab, onInsightTabChange }) {
  const { authenticated, refreshAuth, hubAuthRequired, ready: authReady, user, termsUrl, privacyUrl } = useAuth();
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
  const subViewRef = React.useRef(subView);
  subViewRef.current = subView;
  const [rosterLoading, setRosterLoading] = useState(false);
  const [memberships, setMemberships] = useState([]);
  const [leagueSwitchBusy, setLeagueSwitchBusy] = useState(false);

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
    const q = season ? `?season=${season}` : "";
    let res = await apiFetch(`/api/hub/value-overlay${q}`, { signal });
    if (res.status === 503) {
      const poolQ = season ? `?season=${season}` : "";
      const warm = await apiFetch(`/api/hub/draft-pool${poolQ}`, { signal });
      if (!warm.ok) throw new Error(await parseApiError(warm));
      res = await apiFetch(`/api/hub/value-overlay${q}`, { signal });
    }
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

  const refreshRoster = useCallback(async (signal) => {
    setRosterLoading(true);
    try {
      const rows = await loadRoster(signal);
      if (!signal?.aborted) setRoster(rows);
      return rows;
    } catch (e) {
      if (isAbortError(e)) return null;
      const msg = connectionErrorMessage(e);
      if (!/sign in|login required|401/i.test(msg)) {
        setError(msg);
      }
      return null;
    } finally {
      if (!signal?.aborted) setRosterLoading(false);
    }
  }, [loadRoster]);

  const loadMemberships = useCallback(async (signal, hubCtx = null) => {
    let raw = [];
    try {
      const data = await fetchHubMemberships();
      raw = data.memberships || [];
    } catch {
      raw = [];
    }
    const merged = effectiveMemberships(raw, hubCtx);
    if (!signal?.aborted) setMemberships(merged);
    return merged;
  }, []);

  const refreshAll = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    try {
      if (!authenticated && hubAuthRequired !== false) {
        return;
      }
      const [ws, presetsRes] = await Promise.all([
        loadWorkspace(signal),
        apiFetch("/api/hub/presets", { signal }),
      ]);
      if (signal?.aborted) return;
      const ctx = ws.hub_context || null;
      setWorkspace({ ...ws, hub_context: ctx });
      applyHubContext(ctx);
      setLeagueId((prev) => prev || ctx?.league_id || "");
      const merged = effectiveMemberships(ws.memberships || [], ctx);
      if (!signal?.aborted) setMemberships(merged);
      if (presetsRes.ok) {
        const p = await presetsRes.json();
        if (!signal?.aborted) setPresets(p.presets || []);
      }
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
    if (!signal?.aborted) {
      void refreshRoster(signal);
    }
  }, [
    authenticated,
    applyHubContext,
    hubAuthRequired,
    loadWorkspace,
    refreshRoster,
  ]);

  /** Load cap sheet for league mode (season banner) and cap/roster tabs; value sheet per tab. */
  useEffect(() => {
    if (!workspace || loading) return undefined;
    const controller = new AbortController();
    const { signal } = controller;
    const inLeague = effectiveHubContext(hubContext, workspace)?.mode === "league";

    if (!capSheet && (inLeague || TABS_NEED_CAP_SHEET.has(subView))) {
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
    hubContext,
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
    const rows = await refreshRoster();
    const cap = await loadCapSheet();
    setCapSheet(cap);
    await refreshOverlayOnly(wsRes?.season, wsRes?.rules);
  }, [applyHubContext, loadCapSheet, loadHubContext, loadWorkspace, refreshOverlayOnly, refreshRoster]);

  const onRosterChanged = useCallback(async () => {
    await refreshRoster();
    const tab = subViewRef.current;
    const inLeague = hubContext?.mode === "league";
    if (inLeague || TABS_NEED_CAP_SHEET.has(tab)) {
      const cap = await loadCapSheet();
      setCapSheet(cap);
    }
    if (TABS_NEED_VALUE_SHEET.has(tab)) {
      await refreshOverlayOnly(workspace?.season, workspace?.rules);
    }
  }, [hubContext?.mode, loadCapSheet, refreshOverlayOnly, refreshRoster, workspace?.rules, workspace?.season]);

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
    if (payload?.league_id) {
      setLeagueId(payload.league_id);
    }
    if (payload?.test_mode) {
      if (!valueSheet && workspace) {
        await refreshValueSheet(workspace.season, workspace.rules);
      }
      return;
    }
    await refreshAll();
  }, [refreshAll, refreshValueSheet, valueSheet, workspace]);

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
    if (payload?.league_id) setLeagueId(payload.league_id);
    clearHubDataCache();
    setCapSheet(null);
    setValueSheet(null);
    await refreshAll();
  }, [applyHubContext, refreshAll]);

  const onLeagueSwitch = useCallback(async (opts) => {
    setLeagueSwitchBusy(true);
    setLeagueSyncError("");
    setError("");
    try {
      const data = await setHubFocus(opts);
      clearHubDataCache();
      setCapSheet(null);
      setValueSheet(null);
      if (data.hub_context) {
        applyHubContext(data.hub_context);
        setLeagueId(data.hub_context.league_id || "");
      }
      await refreshAll();
    } catch (e) {
      const msg = connectionErrorMessage(e);
      setError(msg);
      throw e;
    } finally {
      setLeagueSwitchBusy(false);
    }
  }, [applyHubContext, refreshAll]);

  const effectiveCtx = effectiveHubContext(hubContext, workspace);
  const valueRows = valueSheet?.rows ?? EMPTY_VALUE_ROWS;
  const valueSleeper = valueSheet?.sleeper ?? workspace;

  if (authReady && !authenticated && hubAuthRequired !== false) {
    return (
      <div className="draft-hub draft-hub-auth">
        <AccountAuth
          onAuthed={async () => {
            await refreshAuth();
            await refreshAll();
          }}
          title="Sign in"
          subtitle="Save league & rosters."
          compact
          termsUrl={termsUrl}
          privacyUrl={privacyUrl}
        />
      </div>
    );
  }

  if (
    authReady
    && authenticated
    && hubAuthRequired !== false
    && user?.auth_type === "native"
    && user?.email_verified === false
  ) {
    return (
      <div className="draft-hub draft-hub-auth">
        <VerifyEmailBanner
          user={user}
          onVerified={async () => {
            await refreshAuth();
            await refreshAll();
          }}
        />
      </div>
    );
  }

  if (loading && !workspace) {
    return (
      <div className="draft-hub">
        <HubPage>
          <h2 className="hub-tab-intro-title">League</h2>
          <ValueSheetTableSkeleton rows={12} colSpan={12} />
        </HubPage>
      </div>
    );
  }

  return (
    <div className="draft-hub">
      {effectiveCtx?.mode === "league" && subView !== "setup" && (
        <HubSeasonStatus
          workspace={workspace}
          hubContext={effectiveCtx}
          capSheet={capSheet}
          rosterLoading={rosterLoading}
          onNavigate={setSubView}
        />
      )}

      {(memberships.length > 0 || effectiveCtx?.mode === "league")
        && subView !== "insights"
        && subView !== "room"
        && subView !== "setup" && (
        <LeagueContextBanner
          hubContext={effectiveCtx}
          memberships={memberships}
          onLeagueSwitch={onLeagueSwitch}
          onNavigateSetup={() => setSubView("setup")}
          onLeagueSync={onLeagueSleeperSync}
          syncing={leagueSyncing}
          syncMessage={leagueSyncMessage}
          syncError={leagueSyncError}
          switchBusy={leagueSwitchBusy}
        />
      )}

      {error && <div className="error">{error}</div>}

      {subView === "setup" && (
        <HubSetup
          workspace={workspace}
          hubContext={effectiveCtx}
          memberships={memberships}
          roster={roster}
          rosterLoading={rosterLoading}
          presets={presets}
          onSleeperLinked={onSleeperLinked}
          onRosterChanged={onRosterChanged}
          onWorkspaceSaved={onWorkspaceSaved}
          onRangesUpdated={onRangesUpdated}
          onLeagueChanged={onLeagueChanged}
          onLeagueSwitch={onLeagueSwitch}
          onNavigate={setSubView}
          onLeagueSync={onLeagueSleeperSync}
          leagueSyncing={leagueSyncing}
          leagueSyncMessage={leagueSyncMessage}
          leagueSyncError={leagueSyncError}
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
          activeTab={insightTab}
          onActiveTabChange={onInsightTabChange}
        />
      )}

      {subView === "live" && effectiveCtx?.mode === "league" && (
        <LeagueLiveScoring
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
          valueSheetLoading={valueSheetLoading}
          hubRoster={roster}
          season={valueSheet?.season || workspace?.season}
          hubContext={effectiveCtx}
          onNavigate={setSubView}
        />
      )}
    </div>
  );
}
