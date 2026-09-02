import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { useAuth } from "../AuthContext";
import { connectionErrorMessage, parseApiError } from "../format";
import { isAbortError } from "../fetchAbort";
import { HubPage } from "./HubUILayout";
import { ValueSheetTableSkeleton } from "../TableSkeleton";
import AccountAuth from "../AccountAuth";
import VerifyEmailBanner from "../VerifyEmailBanner";
import HubSetup from "./HubSetup";
import RulesWizard from "./RulesWizard";
import ValueSheetTable from "./ValueSheetTable";
import RosterBuilder from "./RosterBuilder";
import DraftRoom from "./DraftRoom";
import CapPlanner from "./CapPlanner";
import InsightsFallback from "./insights/InsightsChrome";
import LeagueOffice from "./LeagueOffice";
import LeagueTrades from "./LeagueTrades";
import LeagueRostersBrowser from "./LeagueRostersBrowser";
import LeagueContextBanner from "./LeagueContextBanner";
import HubDemoBanner from "./HubDemoBanner";
import GameCenter from "./GameCenter";
import WeeklyCommandCenter from "./WeeklyCommandCenter";
import LeagueHome from "./LeagueHome";
import LeagueCreateJoinDialog from "./LeagueCreateJoinDialog";
import FantasyChatDock from "./FantasyChatDock";
import { defaultInsightTab, isInsightTabAllowed } from "./hubInsightsTabs";
import { defaultOfficeTab, isOfficeTabAllowed } from "./hubOfficeTabs";
import {
  clearHubDataCache,
  getCachedPool,
  invalidateFreshnessCache,
  mergePoolAndOverlay,
  poolPayloadFromSheet,
  setCachedOverlay,
  setCachedPool,
} from "./hubDataCache";
import { effectiveHubContext } from "./hubContext";
import { fetchHubMemberships, setHubFocus, effectiveMemberships } from "./hubLeagues";
import { isPickDraft } from "./draftEntryStatus";
import { loadWatchIds, toggleWatchId } from "./draftLiveConsole";
import AtmosphereLayer from "./AtmosphereLayer";
import { TeamIdentityProvider } from "./TeamIdentityContext";
import { mergeAtmospherePrefs } from "./atmosphereCatalog";

const LeagueInsights = lazy(() => import("./LeagueInsights"));

const EMPTY_VALUE_ROWS = [];

/** Tabs that need the heavy value-sheet / draft-pool payload. */
const TABS_NEED_VALUE_SHEET = new Set(["value", "available", "room", "rosters", "trades"]);
/** Tabs that need cap-sheet (also hits roster on the server). */
const TABS_NEED_CAP_SHEET = new Set(["planner", "roster", "rosters"]);
/** Tabs that read the hub roster ("value" marks my players via rosterIds). */
const TABS_NEED_ROSTER = new Set(["home", "setup", "value", "available", "roster", "rosters", "planner", "room", "trades"]);

export default function DraftHub({ subView, onSubViewChange, onHubContextChange, insightTab, onInsightTabChange, officeTab, onOfficeTabChange, onOpenContractHistory }) {
  const { authenticated, refreshAuth, hubAuthRequired, hubDemo, ready: authReady, user, termsUrl, privacyUrl, patreonConfigured } = useAuth();
  const [demoMode, setDemoMode] = useState(() => {
    try {
      return sessionStorage.getItem("ss_hub_demo") === "1";
    } catch {
      return false;
    }
  });
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
  const [weekReloadToken, setWeekReloadToken] = useState(0);
  const [valueSheetLoading, setValueSheetLoading] = useState(false);
  const subViewRef = React.useRef(subView);
  subViewRef.current = subView;
  /** Roster fetch runs once per boot, on first entry to a tab that reads it. */
  const rosterBootRef = React.useRef(false);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [memberships, setMemberships] = useState([]);
  const [leagueSwitchBusy, setLeagueSwitchBusy] = useState(false);
  const [createLeagueOpen, setCreateLeagueOpen] = useState(false);
  const watchLeagueKey = leagueId || hubContext?.league_id || workspace?.league_id || "solo";
  const [watchIds, setWatchIds] = useState([]);
  useEffect(() => {
    setWatchIds(loadWatchIds(watchLeagueKey));
  }, [watchLeagueKey]);
  const toggleWatch = useCallback((row) => {
    if (!row?.player_id) return;
    setWatchIds(toggleWatchId(watchLeagueKey, row.player_id));
  }, [watchLeagueKey]);

  const setSubView = onSubViewChange;
  const applyHubContext = useCallback((ctx) => {
    if (!ctx || typeof ctx !== "object") return;
    setHubContext(ctx);
    onHubContextChange?.(ctx);
  }, [onHubContextChange]);

  const goToRosterManagement = useCallback(() => {
    setSubView("office");
    onOfficeTabChange?.("current");
  }, [setSubView, onOfficeTabChange]);

  const goCreateLeague = useCallback(() => {
    setCreateLeagueOpen(true);
  }, []);

  useEffect(() => {
    if (subView === "live") {
      // Legacy live-scoring view — Game center owns the matchup now.
      setSubView("game");
    } else if (subView === "league-rosters") {
      setSubView("office");
      onOfficeTabChange?.("current");
    }
  }, [subView, setSubView, onInsightTabChange, onOfficeTabChange]);

  // Insights/Trades stay mounted (display:none) after first visit so revisits
  // skip refetch + chart remount. Heavy tabs (value sheet, draft room) still unmount.
  const [visitedTabs, setVisitedTabs] = useState(() => new Set());
  useEffect(() => {
    if (subView !== "insights" && subView !== "trades" && subView !== "office") return;
    setVisitedTabs((prev) => {
      if (prev.has(subView)) return prev;
      const next = new Set(prev);
      next.add(subView);
      return next;
    });
  }, [subView]);

  const rosterIds = useMemo(
    () => new Set(roster.map((r) => r.player_id)),
    [roster],
  );

  const loadWorkspace = useCallback(async (signal) => {
    const path = demoMode ? "/api/hub/demo/workspace" : "/api/hub/workspace";
    const res = await apiFetch(path, { signal });
    if (!res.ok) throw new Error(await parseApiError(res));
    return res.json();
  }, [demoMode]);

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

  const enterDemo = useCallback(() => {
    try {
      sessionStorage.setItem("ss_hub_demo", "1");
    } catch {
      /* ignore */
    }
    setDemoMode(true);
    clearHubDataCache();
    setSubView("insights");
  }, [setSubView]);

  const exitDemo = useCallback(() => {
    try {
      sessionStorage.removeItem("ss_hub_demo");
    } catch {
      /* ignore */
    }
    setDemoMode(false);
    clearHubDataCache();
  }, []);

  const refreshAll = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    try {
      if (!demoMode && !authenticated && hubAuthRequired !== false) {
        return;
      }
      const requests = [loadWorkspace(signal)];
      if (!demoMode) {
        requests.push(apiFetch("/api/hub/presets", { signal }));
      }
      const results = await Promise.all(requests);
      const ws = results[0];
      const presetsRes = results[1];
      if (signal?.aborted) return;
      const ctx = ws.hub_context || null;
      setWorkspace({ ...ws, hub_context: ctx });
      applyHubContext(ctx);
      setLeagueId((prev) => prev || ctx?.league_id || "");
      const merged = effectiveMemberships(ws.memberships || [], ctx);
      if (!signal?.aborted) setMemberships(merged);
      if (presetsRes?.ok) {
        const p = await presetsRes.json();
        if (!signal?.aborted) setPresets(p.presets || []);
      }
    } catch (e) {
      if (isAbortError(e)) return;
      const msg = connectionErrorMessage(e);
      if (demoMode && /demo|404|not configured/i.test(msg)) {
        exitDemo();
      }
      if (/sign in|login required|401/i.test(msg)) {
        setError("");
      } else {
        setError(msg);
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
    // Roster load is deferred to the first roster-needing tab (see effect below).
    rosterBootRef.current = false;
  }, [
    authenticated,
    applyHubContext,
    demoMode,
    exitDemo,
    hubAuthRequired,
    loadWorkspace,
  ]);

  useEffect(() => {
    if (!workspace || loading) return undefined;
    if (rosterBootRef.current || !TABS_NEED_ROSTER.has(subView)) return undefined;
    const controller = new AbortController();
    rosterBootRef.current = true;
    refreshRoster(controller.signal).finally(() => {
      if (controller.signal.aborted) rosterBootRef.current = false;
    });
    return () => controller.abort();
  }, [subView, workspace, loading, refreshRoster]);

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

  useEffect(() => {
    if (!demoMode) return;
    const controller = new AbortController();
    refreshAll(controller.signal);
    return () => controller.abort();
  }, [demoMode, refreshAll]);

  useEffect(() => {
    if (demoMode && !hubDemo?.available) {
      exitDemo();
    }
  }, [demoMode, hubDemo?.available, exitDemo]);

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

  const onOfficeChanged = useCallback(async (maybeCtx) => {
    if (maybeCtx?.mode) applyHubContext(maybeCtx);
    const lid = maybeCtx?.league_id || hubContext?.league_id;
    clearHubDataCache();
    if (lid) invalidateFreshnessCache(lid);
    await onRosterChanged();
  }, [applyHubContext, hubContext?.league_id, onRosterChanged]);

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
      if (lid) invalidateFreshnessCache(lid);
      await onRosterChanged();
      setWeekReloadToken((n) => n + 1);
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

  useEffect(() => {
    if (subView !== "insights" || !effectiveCtx) return;
    const isCommish = Boolean(effectiveCtx.is_commissioner);
    if (!isInsightTabAllowed(insightTab, isCommish)) {
      onInsightTabChange?.(defaultInsightTab(isCommish));
    }
  }, [subView, insightTab, effectiveCtx, onInsightTabChange]);

  useEffect(() => {
    if (subView !== "office" || !effectiveCtx) return;
    const isCommish = Boolean(effectiveCtx.is_commissioner);
    if (!isCommish) {
      setSubView("rules");
      return;
    }
    if (!isOfficeTabAllowed(officeTab, isCommish)) {
      onOfficeTabChange?.(defaultOfficeTab(isCommish));
    }
  }, [subView, officeTab, effectiveCtx, onOfficeTabChange, setSubView]);

  if (authReady && !authenticated && hubAuthRequired !== false && !demoMode) {
    return (
      <div className="draft-hub draft-hub-auth">
        <AccountAuth
          onAuthed={async () => {
            exitDemo();
            await refreshAuth();
            await refreshAll();
          }}
          title="Sign in"
          subtitle="Save league & rosters."
          compact
          termsUrl={termsUrl}
          privacyUrl={privacyUrl}
          patreonConfigured={patreonConfigured}
        />
        {hubDemo?.available && (
          <div className="hub-demo-cta">
            <p className="chart-note">
              Or explore a sample league with Spend, Scoring, and Trades — no account required.
            </p>
            <button type="button" className="btn-ghost" onClick={enterDemo}>
              Explore demo league
            </button>
          </div>
        )}
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
          <h2 className="hub-tab-intro-title">Fantasy</h2>
          <ValueSheetTableSkeleton rows={12} colSpan={12} />
        </HubPage>
      </div>
    );
  }

  const atmosphere = mergeAtmospherePrefs(
    workspace?.prefs || { atmosphere: effectiveCtx?.atmosphere },
  ).atmosphere;

  return (
    <div className="draft-hub">
      <AtmosphereLayer theme={atmosphere} liveDraft={subView === "room"} />
      <TeamIdentityProvider leagueId={effectiveCtx?.mode === "league" ? effectiveCtx?.league_id : ""}>
      {demoMode && (
        <HubDemoBanner
          leagueName={effectiveCtx?.league_name}
          onExit={exitDemo}
        />
      )}
      {subView !== "room" && subView !== "setup" && !demoMode && (
        <LeagueContextBanner
          hubContext={effectiveCtx}
          memberships={memberships}
          capSheet={capSheet}
          onNavigate={setSubView}
          onLeagueSwitch={onLeagueSwitch}
          onCreateLeague={goCreateLeague}
          onNavigateSetup={() => setSubView(effectiveCtx?.is_commissioner ? "rules" : "setup")}
          onNavigateManage={goToRosterManagement}
          onLeagueSync={onLeagueSleeperSync}
          syncing={leagueSyncing}
          syncMessage={leagueSyncMessage}
          syncError={leagueSyncError}
          switchBusy={leagueSwitchBusy}
          showAttention={subView !== "home"}
          currentView={subView}
          onProjectionsRefresh={async () => {
            clearHubDataCache();
            await refreshValueSheet(
              workspace?.season || effectiveCtx?.season,
              workspace?.rules || effectiveCtx?.rules,
              { forcePool: true },
            );
            setWeekReloadToken((n) => n + 1);
          }}
        />
      )}

      {error && <div className="error">{error}</div>}

      {subView === "home" && !demoMode && (
        <LeagueHome
          hubContext={effectiveCtx}
          reloadToken={weekReloadToken}
          onNavigate={setSubView}
          onNavigateSetup={() => setSubView(effectiveCtx?.is_commissioner ? "rules" : "setup")}
        />
      )}

      {subView === "rules" && !demoMode && (
        <RulesWizard
          workspace={workspace}
          hubContext={effectiveCtx}
          presets={presets}
          onSaved={onWorkspaceSaved}
          readOnlyRules={effectiveCtx?.mode === "league" && !effectiveCtx?.is_commissioner}
        />
      )}

      {subView === "setup" && !demoMode && (
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
          onCreateLeague={goCreateLeague}
          onNavigate={setSubView}
          onLeagueSync={onLeagueSleeperSync}
          leagueSyncing={leagueSyncing}
          leagueSyncMessage={leagueSyncMessage}
          leagueSyncError={leagueSyncError}
        />
      )}

      {(subView === "value" || subView === "available") && (
        <ValueSheetTable
          mode={subView === "available" ? "available" : "all"}
          title={subView === "available" ? "Free agents" : "Strategy"}
          rows={valueRows}
          season={valueSheet?.season || workspace?.season}
          onAddToRoster={onRosterChanged}
          rosterIds={rosterIds}
          sleeper={valueSleeper}
          loading={valueSheetLoading}
          isCommissioner={Boolean(effectiveCtx?.is_commissioner)}
          riskTolerance={
            effectiveCtx?.rules?.risk_tolerance
            ?? workspace?.rules?.risk_tolerance
            ?? 0
          }
          rules={effectiveCtx?.rules || workspace?.rules || null}
          pickDraft={isPickDraft(effectiveCtx?.rules || workspace?.rules)}
          acquisitionWindow={effectiveCtx?.acquisition_window}
          inLeague={effectiveCtx?.mode === "league"}
          onOpenContractHistory={onOpenContractHistory}
          showAdd={subView === "available"}
          onWatchPlayer={toggleWatch}
          watchIds={watchIds}
        />
      )}

      {subView === "week" && (
        <WeeklyCommandCenter
          hubContext={effectiveCtx}
          reloadToken={weekReloadToken}
          onSynced={async (result) => {
            if (result?.hub_context) applyHubContext(result.hub_context);
            const lid = effectiveCtx?.league_id;
            if (lid) invalidateFreshnessCache(lid);
            clearHubDataCache();
            await onRosterChanged();
          }}
          onNavigateSetup={() => setSubView("setup")}
          onNavigate={setSubView}
        />
      )}

      {subView === "game" && (
        effectiveCtx?.mode === "league" && effectiveCtx?.league_id ? (
          <GameCenter
            leagueId={effectiveCtx.league_id}
            hubContext={effectiveCtx}
            onNavigate={setSubView}
          />
        ) : (
          <HubPage>
            <h2 className="hub-tab-intro-title">Game center</h2>
            <p className="chart-note">
              Game center follows your head-to-head matchup. Open a shared league to use it.
              {" "}
              <button type="button" className="btn-link" onClick={() => setSubView("setup")}>
                League settings
              </button>
            </p>
          </HubPage>
        )
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
          onEditInOffice={goToRosterManagement}
          onOpenContractHistory={onOpenContractHistory}
        />
      )}

      {subView === "rosters" && (
        effectiveCtx?.mode === "league" && effectiveCtx?.league_id ? (
          <LeagueRostersBrowser
            leagueId={effectiveCtx.league_id}
            hubContext={effectiveCtx}
            onNavigateTrade={() => setSubView("trades")}
            onOpenContractHistory={onOpenContractHistory}
          />
        ) : (
          <HubPage>
            <h2 className="hub-tab-intro-title">Rosters</h2>
            <p className="chart-note">
              Open a shared league to browse every team&apos;s contracts.
              {" "}
              <button type="button" className="btn-link" onClick={() => setSubView("setup")}>
                League settings
              </button>
            </p>
          </HubPage>
        )
      )}

      {(subView === "trades" || visitedTabs.has("trades")) && effectiveCtx?.mode === "league" && (
        <div className={subView === "trades" ? undefined : "app-view-pane-hidden"}>
          <LeagueTrades
            leagueId={effectiveCtx.league_id}
            hubContext={effectiveCtx}
          />
        </div>
      )}


      {(subView === "office" || visitedTabs.has("office")) && effectiveCtx?.mode === "league" && (
        <div className={subView === "office" ? undefined : "app-view-pane-hidden"}>
          <LeagueOffice
            leagueId={effectiveCtx.league_id}
            hubContext={effectiveCtx}
            workspace={workspace}
            officeTab={officeTab}
            onOfficeTabChange={onOfficeTabChange}
            onChanged={onOfficeChanged}
            onNavigate={setSubView}
            active={subView === "office"}
          />
        </div>
      )}

      {(subView === "insights" || visitedTabs.has("insights")) && effectiveCtx?.mode === "league" && (
        <div className={subView === "insights" ? undefined : "app-view-pane-hidden"}>
          <Suspense fallback={<InsightsFallback />}>
            <LeagueInsights
              leagueId={effectiveCtx.league_id}
              hubContext={effectiveCtx}
              onNavigate={setSubView}
              activeTab={insightTab}
              onActiveTabChange={onInsightTabChange}
              onWorkspaceSaved={onWorkspaceSaved}
            />
          </Suspense>
        </div>
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

      {subView === "room" && !demoMode && (
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
          watchIds={watchIds}
          onWatchPlayer={toggleWatch}
        />
      )}

      {!demoMode && effectiveCtx?.mode === "league" && (
        <FantasyChatDock
          leagueId={leagueId || effectiveCtx?.league_id || ""}
          hubContext={effectiveCtx}
          hidden={subView === "room"}
        />
      )}
      {!demoMode && (
        <LeagueCreateJoinDialog
          open={createLeagueOpen}
          onClose={() => setCreateLeagueOpen(false)}
          season={workspace?.season ?? new Date().getFullYear()}
          presets={presets}
          onCreated={onLeagueChanged}
        />
      )}
      </TeamIdentityProvider>
    </div>
  );
}
