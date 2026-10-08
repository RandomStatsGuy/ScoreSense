import { createPortal } from "react-dom";
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, formatRelativeTime, parseApiError } from "../format";
import useDataRevision from "../useDataRevision";
import useMobileLayout from "../useMobileLayout";
import LeagueSwitcher from "./LeagueSwitcher";
import { effectiveMemberships, isSoloContext } from "./hubLeagues";
import { FANTASY_HEADER_COPY, LEAGUE_CREATE_COPY, PROJECTION_SYNC_COPY, PROJECTION_HEALTH_COPY, projectionHealthLabel, SLEEPER_SYNC_PAUSE_COPY } from "./leagueAccessCopy";
import {
  getFreshnessCache,
  invalidateFreshnessCache,
  invalidateInsightsAfterCapSync,
} from "./hubDataCache";
import { ensureLeagueFreshness, syncLeagueProjections } from "./leagueFreshness";
import { fmtSal } from "./rosterFormat";
import TeamIdentityMark from "./TeamIdentityMark";
import { identityFor, useTeamIdentities } from "./TeamIdentityContext";
import {
  buildLeagueAttentionItems,
  filterAttentionForView,
  leagueDisplayName,
  leaguePhaseLabel,
  leagueRoleLabel,
} from "./leagueAttention";
import { useLeagueChrome } from "./leagueChromeContext";
import { leagueUsesSalaries } from "./leagueCapabilities";

function ageShort(at) {
  if (!at) return null;
  const ms = typeof at === "number" ? at : Date.parse(at);
  if (!Number.isFinite(ms)) return null;
  const diffSec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 48) return `${diffHr}h`;
  return `${Math.round(diffHr / 24)}d`;
}

function sourceStatusLabel({ at, stale, missing, available }) {
  if (missing || available === false) return "Not available";
  if (stale) {
    const age = ageShort(at);
    return age ? `Stale ${age}` : "Stale";
  }
  if (at) return formatRelativeTime(at) || "Up to date";
  return "Not synced yet";
}

/**
 * Slim persistent League context bar (SCORE-9).
 * Replaces the large hero + equal-weight freshness chip strip.
 */
export default function LeagueContextBanner({
  hubContext,
  memberships = [],
  onLeagueSwitch,
  onNavigateSetup,
  onCreateLeague,
  onNavigateManage,
  onLeagueSync,
  syncing,
  syncMessage,
  syncError,
  switchBusy = false,
  capSheet = null,
  onNavigate,
  onProjectionsRefresh,
  onRosterFocus,
  showAttention = true,
  currentView = null,
}) {
  const { identities } = useTeamIdentities();
  const { setChrome } = useLeagueChrome();
  const leagues = useMemo(
    () => effectiveMemberships(memberships, hubContext),
    [memberships, hubContext],
  );
  const inLeague = !isSoloContext(hubContext);
  const hasLeagues = leagues.length > 0;
  const mobileLayout = useMobileLayout();
  const compactHeader = mobileLayout && ["home", "week", "game", "roster", "available", "trades", "planner", "insights", "vibes"].includes(currentView) && inLeague;
  const [headerSlot, setHeaderSlot] = useState(null);
  useEffect(() => {
    setHeaderSlot(compactHeader ? document.getElementById("mobile-home-league-slot") : null);
  }, [compactHeader]);
  const compactMenuRef = useRef(null);
  useEffect(() => {
    if (!mobileLayout) return undefined;
    const close = (event) => {
      const menu = compactMenuRef.current;
      if (!menu?.open) return;
      if (event.type === "keydown" && event.key === "Escape") {
        menu.open = false;
        menu.querySelector("summary")?.focus();
      } else if (event.type === "pointerdown" && !menu.contains(event.target)) menu.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, [mobileLayout]);
  useEffect(() => { if (compactMenuRef.current) compactMenuRef.current.open = false; }, [hubContext?.league_id, currentView]);
  const syncMenuId = useId();
  const syncWrapRef = useRef(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [sheetSyncing, setSheetSyncing] = useState(false);
  const [freshness, setFreshness] = useState(() => (
    getFreshnessCache(hubContext?.league_id)?.data || null
  ));
  const [freshnessLoading, setFreshnessLoading] = useState(false);
  const [freshnessError, setFreshnessError] = useState("");
  const [projRefreshing, setProjRefreshing] = useState(false);
  const [projectionSyncMessage, setProjectionSyncMessage] = useState("");
  const projectionSyncController = useRef(null);

  const dataRevision = useDataRevision();
  const leagueId = hubContext?.league_id;
  const isDemo = Boolean(hubContext?.demo);
  const isCommish = Boolean(hubContext?.is_commissioner);

  useEffect(() => {
    setProjectionSyncMessage("");
    setProjRefreshing(false);
    return () => {
      projectionSyncController.current?.abort();
      projectionSyncController.current = null;
    };
  }, [leagueId, hubContext?.season]);

  const loadFreshness = useCallback(async (signal) => {
    if (!leagueId || hubContext?.mode !== "league") {
      setFreshness(null);
      setFreshnessLoading(false);
      setFreshnessError("");
      return;
    }
    const cached = getFreshnessCache(leagueId);
    setFreshness(cached?.data || null);
    setFreshnessLoading(!cached?.data);
    setFreshnessError("");
    try {
      const payload = await ensureLeagueFreshness(leagueId, { demo: isDemo });
      if (signal?.aborted) return;
      if (payload) setFreshness(payload);
    } catch (e) {
      if (signal?.aborted) return;
      setFreshnessError(connectionErrorMessage(e));
    } finally {
      if (!signal?.aborted) setFreshnessLoading(false);
    }
  }, [leagueId, hubContext?.mode, isDemo]);

  useEffect(() => {
    const ctrl = new AbortController();
    if (dataRevision) invalidateFreshnessCache(leagueId);
    loadFreshness(ctrl.signal);
    return () => ctrl.abort();
  }, [loadFreshness, dataRevision, leagueId]);

  useEffect(() => {
    if (!syncOpen) return undefined;
    const onDoc = (event) => {
      if (syncWrapRef.current && !syncWrapRef.current.contains(event.target)) {
        setSyncOpen(false);
      }
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        setSyncOpen(false);
        syncWrapRef.current?.querySelector(".hub-league-context-sync-trigger")?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [syncOpen]);

  const runSheetSync = useCallback(async () => {
    if (!leagueId || isDemo) return;
    setSheetSyncing(true);
    setFreshnessError("");
    try {
      const res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/contract-history/sync`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      invalidateInsightsAfterCapSync(leagueId);
      invalidateFreshnessCache(leagueId);
      await loadFreshness(undefined);
    } catch (e) {
      setFreshnessError(connectionErrorMessage(e));
    } finally {
      setSheetSyncing(false);
    }
  }, [leagueId, isDemo, loadFreshness]);

  const runProjectionsRefresh = useCallback(async () => {
    if (!onProjectionsRefresh || isDemo || projectionSyncController.current) return;
    const controller = new AbortController();
    projectionSyncController.current = controller;
    setProjRefreshing(true);
    setFreshnessError("");
    setProjectionSyncMessage(PROJECTION_SYNC_COPY.pending);
    try {
      const payload = await syncLeagueProjections(leagueId, {
        refresh: onProjectionsRefresh,
        signal: controller.signal,
        onUpdate: setFreshness,
      });
      invalidateFreshnessCache(leagueId);
      setFreshness(payload);
      setProjectionSyncMessage(PROJECTION_SYNC_COPY.ready);
    } catch (e) {
      if (!controller.signal.aborted) {
        setProjectionSyncMessage("");
        setFreshnessError(connectionErrorMessage(e));
      }
    } finally {
      if (projectionSyncController.current === controller) {
        projectionSyncController.current = null;
        setProjRefreshing(false);
      }
    }
  }, [onProjectionsRefresh, leagueId, isDemo]);

  const runSleeperSync = useCallback(async () => {
    if (!leagueId || !onLeagueSync) return;
    await onLeagueSync(leagueId);
    invalidateFreshnessCache(leagueId);
    await loadFreshness(undefined);
  }, [leagueId, onLeagueSync, loadFreshness]);

  const phaseLabel = leaguePhaseLabel(hubContext, { inLeague });
  const roleLabel = leagueRoleLabel(hubContext, { inLeague });
  const leagueName = leagueDisplayName(hubContext, { inLeague });

  const preDraft = inLeague && !hubContext.draft_completed ? capSheet?.pre_draft : null;
  const mustExtend = preDraft?.must_extend ?? [];
  const dropping = preDraft?.dropping_at_draft ?? [];
  const remaining = capSheet?.summary?.remaining;
  const overCapBy = Number.isFinite(Number(remaining)) && Number(remaining) < 0
    ? Math.abs(Number(remaining))
    : null;

  const projectionNeedsAttention = Boolean(freshness?.projections?.needs_attention);
  const capSheetsStale = Boolean(freshness?.cap_sheets?.stale);

  const attentionItems = buildLeagueAttentionItems({
    inLeague,
    projectionNeedsAttention,
    projectionRefreshState: freshness?.projections?.refresh_state,
    projectionsAvailable: freshness?.projections?.available,
    overCapLabel: overCapBy != null ? fmtSal(overCapBy) : "",
    mustExtendCount: mustExtend.length,
    droppingCount: dropping.length,
    capSheetsStale,
    isCommish,
    usesSalaries: leagueUsesSalaries(hubContext),
  }).map((item) => {
    const withTone = { ...item, tone: "attention" };
    if (item.action === "projections") {
      return {
        ...withTone,
        label: projRefreshing ? PROJECTION_SYNC_COPY.updating : withTone.label,
        actionLabel: projRefreshing ? PROJECTION_SYNC_COPY.updating : withTone.actionLabel,
        onAction: () => {
          setSyncOpen(true);
          runProjectionsRefresh();
        },
      };
    }
    if (item.action === "roster-extend") {
      return {
        ...withTone,
        onAction: () => {
          onRosterFocus?.("extend");
          if (currentView !== "roster") onNavigate?.("roster");
        },
      };
    }
    if (item.action === "planner") {
      return {
        ...withTone,
        target: "planner",
        onAction: onNavigate ? () => onNavigate("planner") : null,
      };
    }
    if (item.action === "sheets") {
      return {
        ...withTone,
        onAction: () => {
          setSyncOpen(true);
          runSheetSync();
        },
      };
    }
    return withTone;
  });

  const busy = syncing || switchBusy || sheetSyncing || projRefreshing;
  const overflowAttentionItems = filterAttentionForView(attentionItems, currentView);
  const visibleAttentionItems = showAttention ? overflowAttentionItems : [];

  useEffect(() => {
    setChrome({
      leagueName,
      phaseLabel: !inLeague && !hasLeagues ? "No shared league yet" : phaseLabel,
      roleLabel,
      attentionItems: overflowAttentionItems,
    });
  }, [setChrome, leagueName, phaseLabel, roleLabel, overflowAttentionItems, inLeague, hasLeagues]);

  useEffect(() => () => setChrome(null), [setChrome]);

  if (!inLeague && !hasLeagues) {
    return (
      <section className="hub-league-context-bar">
        <div className="hub-league-context-top">
          <p className="hub-league-context-line">
            <span className="hub-league-context-name">Solo prep</span>
            <span className="hub-league-context-sep" aria-hidden="true">·</span>
            <span className="hub-league-context-phase">No shared league yet</span>
          </p>
          {onCreateLeague ? (
            <button type="button" className="btn-primary btn-sm" onClick={onCreateLeague}>
              {LEAGUE_CREATE_COPY.createOrJoin}
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  const sleeperLinked = Boolean(
    freshness?.sleeper?.linked || hubContext?.sleeper_league_id,
  );
  const rosterSyncPaused = Boolean(hubContext?.sleeper_sync_paused);

  const showSwitcher = Boolean((hasLeagues || inLeague) && onLeagueSwitch);
  const identityLine = (
    <div className="hub-league-context-identity">
      {showSwitcher && (
        <LeagueSwitcher
          memberships={memberships}
          hubContext={hubContext}
          onSwitch={onLeagueSwitch}
          onCreateLeague={onCreateLeague}
          variant="compact"
          disabled={syncing || switchBusy || sheetSyncing}
        />
      )}
      {!showSwitcher && <span className="hub-league-context-name">{leagueName}</span>}
      <span className="hub-league-context-phase">{phaseLabel}</span>
    </div>
  );

  const teamContext = <div className="fantasy-team-context">
    {inLeague && hubContext.team_name && <><span className="fantasy-team-context-label">{FANTASY_HEADER_COPY.yourTeam}</span><TeamIdentityMark team={{ id: hubContext.team_id, name: hubContext.team_name }} identity={identityFor(identities, { id: hubContext.team_id, identity: hubContext.team_identity })} size="sm" /><strong className="hub-league-context-team">{hubContext.team_name}</strong></>}
    {roleLabel && <span className="hub-league-context-role">{roleLabel}</span>}
  </div>;

  const attentionRow = visibleAttentionItems.length > 0 ? (
    <div className="hub-league-context-attention" role="status">
      <span className="hub-league-context-attention-label">Needs attention</span>
      <ul className="hub-league-context-attention-list">
        {visibleAttentionItems.map((item) => (
          <li key={item.id} className="hub-league-context-attention-item">
            <span className="hub-league-context-attention-text">{item.label}</span>
            {item.onAction && item.actionLabel && (
              <button
                type="button"
                className="btn-link hub-league-context-attention-action"
                onClick={item.onAction}
                disabled={busy}
              >
                {item.actionLabel}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  const syncPopover = inLeague && leagueId ? (
    <div className="hub-league-context-sync" ref={syncWrapRef}>
      <button
        type="button"
        className="btn-ghost btn-sm hub-league-context-sync-trigger"
        aria-haspopup="dialog"
        aria-expanded={syncOpen}
        aria-controls={syncMenuId}
        disabled={switchBusy}
        onClick={() => setSyncOpen((v) => !v)}
      >
        <svg className="fantasy-sync-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 2M4 16l2 2a7 7 0 0 0 12-1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {syncing || sheetSyncing || projRefreshing ? "Syncing…" : FANTASY_HEADER_COPY.sync}
        <span className="hub-league-context-sync-caret" aria-hidden="true">▾</span>
      </button>
      {syncOpen && (
        <div
          id={syncMenuId}
          className="hub-league-context-sync-panel"
          role="dialog"
          aria-label="Sync league sources"
        >
          <div className="hub-league-context-sync-row">
            <div className="hub-league-context-sync-meta">
              <strong>Sleeper</strong>
              <span>
                {freshnessLoading && !freshness
                  ? "Checking…"
                  : sleeperLinked && rosterSyncPaused
                    ? SLEEPER_SYNC_PAUSE_COPY.stripStatus
                    : sourceStatusLabel({
                      at: freshness?.sleeper?.synced_at,
                      missing: freshness && !sleeperLinked,
                    })}
              </span>
            </div>
            <button
              type="button"
              className={rosterSyncPaused ? "btn-ghost btn-sm" : "btn-primary btn-sm"}
              onClick={runSleeperSync}
              disabled={busy || !sleeperLinked}
              title={rosterSyncPaused ? SLEEPER_SYNC_PAUSE_COPY.stripTitle : "Sync rosters from Sleeper"}
            >
              {syncing ? "Syncing…" : "Sync"}
            </button>
          </div>

          <div className="hub-league-context-sync-row">
            <div className="hub-league-context-sync-meta">
              <strong>Scoring</strong>
              <span>
                {sourceStatusLabel({
                  at: freshness?.scoring?.synced_at,
                  missing: freshness && !freshness.scoring?.linked,
                })}
              </span>
            </div>
            <span className="hub-league-context-sync-note">Via Sleeper sync</span>
          </div>

          <div className="hub-league-context-sync-row">
            <div className="hub-league-context-sync-meta">
              <strong>Cap sheets</strong>
              <span>
                {sourceStatusLabel({
                  at: freshness?.cap_sheets?.last_imported_at,
                  stale: freshness?.cap_sheets?.stale,
                })}
              </span>
            </div>
            {isCommish && !isDemo ? (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={runSheetSync}
                disabled={busy}
                title="Re-import cap sheets and contract history"
              >
                {sheetSyncing ? "Syncing…" : "Sync sheets"}
              </button>
            ) : (
              <span className="hub-league-context-sync-note">Commissioner</span>
            )}
          </div>

          <div
            className={
              `hub-league-context-sync-row${projectionNeedsAttention ? " hub-league-context-sync-row--attention" : ""}`
            }
          >
            <div className="hub-league-context-sync-meta">
              <strong>Projections</strong>
              <span>
                {projectionHealthLabel(freshness?.projections)}
              </span>
            </div>
            {projectionNeedsAttention && <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={runProjectionsRefresh}
              disabled={busy}
              title="Update projections for this league"
            >
              {projRefreshing ? PROJECTION_SYNC_COPY.updating : PROJECTION_HEALTH_COPY.retry}
            </button>}
          </div>

          {(syncMessage || syncError || freshnessError || projectionSyncMessage) && (
            <div className="hub-league-context-sync-footer">
              {projectionSyncMessage && <p className="chart-note" role="status" aria-live="polite">{projectionSyncMessage}</p>}
              {syncMessage && <p className="chart-note">{syncMessage}</p>}
              {(syncError || freshnessError) && (
                <p className="error hub-league-context-sync-error">
                  {syncError || freshnessError}
                </p>
              )}
            </div>
          )}

          <div className="hub-league-context-sync-links">
            {onNavigateSetup && (
              <button type="button" className="btn-link" onClick={() => { setSyncOpen(false); onNavigateSetup(); }}>
                {isCommish ? "League rules" : "League settings"}
              </button>
            )}
            {isCommish && onNavigateManage && (
              <>
                {onNavigateSetup ? (
                  <span className="hub-league-context-sync-link-sep" aria-hidden="true">·</span>
                ) : null}
                <button type="button" className="btn-link" onClick={() => { setSyncOpen(false); onNavigateManage(); }}>
                  Roster management
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  ) : (
    <div className="hub-league-context-sync">
      {onNavigateSetup && (
        <button type="button" className="btn-ghost btn-sm" onClick={onNavigateSetup}>
          {isCommish ? "League rules" : "League settings"}
        </button>
      )}
    </div>
  );

  const attentionOneLine = visibleAttentionItems.length > 0 ? (
    <div className="hub-league-context-attention is-one-line" role="status">
      <span className="hub-league-context-attention-label">Needs attention</span>
      {visibleAttentionItems.slice(0, 1).map((item) => (
        <span key={item.id} className="hub-league-context-attention-item">
          <span className="hub-league-context-attention-text">{item.label}</span>
          {item.onAction && item.actionLabel ? (
            <button
              type="button"
              className="btn-link hub-league-context-attention-action"
              onClick={item.onAction}
              disabled={busy}
            >
              {item.actionLabel}
            </button>
          ) : null}
        </span>
      ))}
    </div>
  ) : null;

  const syncFeedback = (syncError || freshnessError || projectionSyncMessage) && !syncOpen ? (
    <p className={`${syncError || freshnessError ? "error" : "chart-note"} hub-league-context-inline-error`} role="status" aria-live="polite">
      {syncError || freshnessError || projectionSyncMessage}
    </p>
  ) : null;

  if (mobileLayout) {
    const strip = (
      <section
        className={`hub-league-context-bar is-compact${compactHeader && headerSlot ? " is-header-slot" : ""}`}
        aria-busy={busy || freshnessLoading}
      >
        <details className="hub-league-context-caret" ref={compactMenuRef}>
          <summary aria-label={`${leagueName} · switch league`} title={leagueName}>
            <span className="hub-league-context-name">{leagueName}</span>
            {compactHeader ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 10 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}
          </summary>
          <div className="hub-league-context-caret-menu">
            {showSwitcher ? (
              <LeagueSwitcher
                memberships={memberships}
                hubContext={hubContext}
                onSwitch={onLeagueSwitch}
                onCreateLeague={compactHeader ? undefined : onCreateLeague}
                variant="list"
                hideActiveHero
                hideCreate
                disabled={syncing || switchBusy || sheetSyncing}
                onSelect={() => { if (compactMenuRef.current) compactMenuRef.current.open = false; }}
              />
            ) : null}
            {onCreateLeague ? (
              <button
                type="button"
                className="btn-link hub-league-switcher-create"
                onClick={() => { if (compactMenuRef.current) compactMenuRef.current.open = false; onCreateLeague(); }}
                disabled={busy}
              >
                {LEAGUE_CREATE_COPY.newLeague}
              </button>
            ) : null}
            {syncPopover}
          </div>
        </details>
        {!compactHeader && attentionOneLine}
        {!(compactHeader && headerSlot) && syncFeedback}
      </section>
    );
    const projectionFeedback = compactHeader && projectionNeedsAttention ? (
      <p className="chart-note hub-league-context-inline-error" role="status" aria-live="polite">
        {projectionHealthLabel(freshness?.projections)}
      </p>
    ) : null;
    return compactHeader && headerSlot
      ? <>{createPortal(strip, headerSlot)}{projectionFeedback}{syncFeedback}</>
      : <>{strip}{projectionFeedback}</>;
  }

  return (
    <section
      className="hub-league-context-bar"
      aria-busy={busy || freshnessLoading}
    >
      <div className="hub-league-context-top">
        {identityLine}
        {teamContext}
        {syncPopover}
      </div>
      {attentionRow}
      {syncFeedback}
    </section>
  );
}
