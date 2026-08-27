import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, formatRelativeTime, parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import LeagueSwitcher from "./LeagueSwitcher";
import { effectiveMemberships, isSoloContext } from "./hubLeagues";
import {
  getFreshnessCache,
  invalidateFreshnessCache,
  invalidateInsightsAfterCapSync,
  setFreshnessCache,
} from "./hubDataCache";
import { fmtSal } from "./rosterFormat";

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
  onNavigateManage,
  onLeagueSync,
  syncing,
  syncMessage,
  syncError,
  switchBusy = false,
  capSheet = null,
  onNavigate,
  onProjectionsRefresh,
  showAttention = true,
  currentView = null,
}) {
  const leagues = useMemo(
    () => effectiveMemberships(memberships, hubContext),
    [memberships, hubContext],
  );
  const inLeague = !isSoloContext(hubContext);
  const hasLeagues = leagues.length > 0;
  const mobileLayout = useMobileLayout();
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

  const leagueId = hubContext?.league_id;
  const isDemo = Boolean(hubContext?.demo);
  const isCommish = Boolean(hubContext?.is_commissioner);

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
      const root = isDemo ? "/api/hub/demo" : "/api/hub";
      const res = await apiFetch(
        `${root}/league/${encodeURIComponent(leagueId)}/freshness`,
        { signal },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      setFreshnessCache(leagueId, payload);
      setFreshness(payload);
    } catch (e) {
      if (signal?.aborted) return;
      setFreshnessError(connectionErrorMessage(e));
    } finally {
      if (!signal?.aborted) setFreshnessLoading(false);
    }
  }, [leagueId, hubContext?.mode, isDemo]);

  useEffect(() => {
    const ctrl = new AbortController();
    loadFreshness(ctrl.signal);
    return () => ctrl.abort();
  }, [loadFreshness]);

  useEffect(() => {
    if (!syncOpen) return undefined;
    const onDoc = (event) => {
      if (syncWrapRef.current && !syncWrapRef.current.contains(event.target)) {
        setSyncOpen(false);
      }
    };
    const onKey = (event) => {
      if (event.key === "Escape") setSyncOpen(false);
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
    if (!onProjectionsRefresh) {
      invalidateFreshnessCache(leagueId);
      await loadFreshness(undefined);
      return;
    }
    setProjRefreshing(true);
    setFreshnessError("");
    try {
      await onProjectionsRefresh();
      invalidateFreshnessCache(leagueId);
      await loadFreshness(undefined);
    } catch (e) {
      setFreshnessError(connectionErrorMessage(e));
    } finally {
      setProjRefreshing(false);
    }
  }, [onProjectionsRefresh, leagueId, loadFreshness]);

  const runSleeperSync = useCallback(async () => {
    if (!leagueId || !onLeagueSync) return;
    await onLeagueSync(leagueId);
    invalidateFreshnessCache(leagueId);
    await loadFreshness(undefined);
  }, [leagueId, onLeagueSync, loadFreshness]);

  if (!inLeague && !hasLeagues) return null;

  const phaseLabel = inLeague
    ? (hubContext.draft_completed ? "In season" : "Pre-draft")
    : "Solo";
  const roleLabel = inLeague
    ? (isCommish ? "Commissioner" : "Member")
    : null;
  const leagueName = inLeague
    ? (hubContext.league_name || "League")
    : "Solo prep";

  const preDraft = inLeague && !hubContext.draft_completed ? capSheet?.pre_draft : null;
  const mustExtend = preDraft?.must_extend ?? [];
  const dropping = preDraft?.dropping_at_draft ?? [];
  const remaining = capSheet?.summary?.remaining;
  const overCapBy = Number.isFinite(Number(remaining)) && Number(remaining) < 0
    ? Math.abs(Number(remaining))
    : null;

  const poolStale = Boolean(freshness?.projections?.stale)
    || (freshness && freshness.projections?.available === false);
  const projAge = ageShort(freshness?.projections?.built_at);
  const capSheetsStale = Boolean(freshness?.cap_sheets?.stale);

  const attentionItems = [];
  if (inLeague && poolStale) {
    attentionItems.push({
      id: "projections",
      tone: "attention",
      label: freshness?.projections?.available === false
        ? "Projections missing"
        : (projAge ? `Projections stale ${projAge}` : "Projections stale"),
      actionLabel: "Sync projections",
      onAction: () => {
        setSyncOpen(true);
        runProjectionsRefresh();
      },
    });
  }
  if (inLeague && overCapBy != null) {
    attentionItems.push({
      id: "over-cap",
      tone: "attention",
      label: `Over cap ${fmtSal(overCapBy)}`,
      actionLabel: "Cap planner",
      onAction: onNavigate ? () => onNavigate("planner") : null,
      target: "planner",
    });
  }
  if (inLeague && mustExtend.length > 0) {
    attentionItems.push({
      id: "extend",
      tone: "attention",
      label: `${mustExtend.length} need extension`,
      actionLabel: "Cap planner",
      onAction: onNavigate ? () => onNavigate("planner") : null,
      target: "planner",
    });
  } else if (inLeague && dropping.length > 0) {
    attentionItems.push({
      id: "expire",
      tone: "attention",
      label: `${dropping.length} expire → FA`,
      actionLabel: "Cap planner",
      onAction: onNavigate ? () => onNavigate("planner") : null,
      target: "planner",
    });
  }
  if (inLeague && capSheetsStale && isCommish) {
    attentionItems.push({
      id: "cap-sheets",
      tone: "attention",
      label: "Cap sheets stale",
      actionLabel: "Sync sheets",
      onAction: () => {
        setSyncOpen(true);
        runSheetSync();
      },
    });
  }

  const busy = syncing || switchBusy || sheetSyncing || projRefreshing;
  const visibleAttentionItems = showAttention
    ? attentionItems.filter((item) => item.target !== currentView)
    : [];
  const sleeperLinked = Boolean(
    freshness?.sleeper?.linked || hubContext?.sleeper_league_id,
  );

  const showSwitcher = Boolean((hasLeagues || inLeague) && onLeagueSwitch);
  const identityLine = (
    <div className="hub-league-context-identity">
      {showSwitcher && (
        <LeagueSwitcher
          memberships={memberships}
          hubContext={hubContext}
          onSwitch={onLeagueSwitch}
          variant="compact"
          disabled={busy}
        />
      )}
      <p className="hub-league-context-line">
        {!showSwitcher && (
          <>
            <span className="hub-league-context-kicker">League</span>
            <span className="hub-league-context-name">{leagueName}</span>
            <span className="hub-league-context-sep" aria-hidden="true">·</span>
          </>
        )}
        <span className="hub-league-context-phase">{phaseLabel}</span>
        {roleLabel && (
          <>
            <span className="hub-league-context-sep" aria-hidden="true">·</span>
            <span className="hub-league-context-role">{roleLabel}</span>
          </>
        )}
        {inLeague
          && hubContext.team_name
          && !mobileLayout
          && String(hubContext.team_name).trim().toLowerCase() !== String(roleLabel || "").toLowerCase()
          && (
          <>
            <span className="hub-league-context-sep" aria-hidden="true">·</span>
            <span className="hub-league-context-team">{hubContext.team_name}</span>
          </>
        )}
      </p>
    </div>
  );

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
        {syncing || sheetSyncing || projRefreshing ? "Syncing…" : "Sync league"}
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
                  : sourceStatusLabel({
                    at: freshness?.sleeper?.synced_at,
                    missing: freshness && !sleeperLinked,
                  })}
              </span>
            </div>
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={runSleeperSync}
              disabled={busy || !sleeperLinked}
              title="Sync rosters from Sleeper"
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
              `hub-league-context-sync-row${poolStale ? " hub-league-context-sync-row--attention" : ""}`
            }
          >
            <div className="hub-league-context-sync-meta">
              <strong>Projections</strong>
              <span>
                {sourceStatusLabel({
                  at: freshness?.projections?.built_at,
                  stale: freshness?.projections?.stale,
                  available: freshness?.projections?.available,
                  missing: freshness && freshness.projections?.available === false,
                })}
              </span>
            </div>
            <button
              type="button"
              className={poolStale ? "btn-primary btn-sm" : "btn-ghost btn-sm"}
              onClick={runProjectionsRefresh}
              disabled={busy}
              title="Reload draft-pool projections for this league"
            >
              {projRefreshing ? "Refreshing…" : "Sync projections"}
            </button>
          </div>

          {(syncMessage || syncError || freshnessError) && (
            <div className="hub-league-context-sync-footer">
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

  return (
    <section
      className="hub-league-context-bar"
      role="status"
      aria-busy={busy || freshnessLoading}
    >
      <div className="hub-league-context-top">
        {identityLine}
        {syncPopover}
      </div>
      {attentionRow}
      {(syncError || freshnessError) && !syncOpen && (
        <p className="error hub-league-context-inline-error">{syncError || freshnessError}</p>
      )}
    </section>
  );
}
