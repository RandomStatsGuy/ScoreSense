import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, formatRelativeTime, parseApiError } from "../format";
import { isAbortError } from "../fetchAbort";
import {
  HubExperienceHero,
  HubExperienceLayout,
  HubExperienceSummary,
  HubPage,
} from "./HubUILayout";
import {
  isPoorProjectionCoverage,
  projectionCoverageRatio,
} from "./projectionCoverage";
import WeekCulturePanel from "./WeekCulturePanel";
import WeekLineupBoard from "./WeekLineupBoard";
import {
  buildStarterSlotPlan,
  fillStarterSlots,
  weekHeroCopy,
  weekPrimaryAction,
  weekRailItems,
  weekRailNote,
} from "./weekBoard";

export default function WeeklyCommandCenter({
  hubContext,
  onSynced,
  onNavigateSetup,
  onNavigate,
  reloadToken,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [syncError, setSyncError] = useState("");
  const [weekOverride, setWeekOverride] = useState("");

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (weekOverride !== "") params.set("week", String(weekOverride));
      const q = params.toString();
      const res = await apiFetch(`/api/hub/week${q ? `?${q}` : ""}`, { signal });
      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      if (!signal?.aborted) setData(payload);
    } catch (e) {
      if (isAbortError(e) || signal?.aborted) return;
      setError(connectionErrorMessage(e));
      setData(null);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [weekOverride]);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load, hubContext?.league_id, hubContext?.team_id, hubContext?.mode, reloadToken]);

  const runSync = useCallback(async () => {
    const endpoint = data?.sync?.sync_endpoint;
    if (!endpoint) return;
    setSyncing(true);
    setSyncError("");
    setSyncMessage("");
    try {
      const isSolo = endpoint === "/api/hub/sleeper/sync";
      const res = await apiFetch(endpoint, {
        method: data?.sync?.sync_action || "POST",
        ...(isSolo
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ import_to_hub: true }),
            }
          : {}),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const result = await res.json();
      setSyncMessage(
        result.message
        || (result.teams_synced != null
          ? `Synced ${result.teams_synced} team(s) from Sleeper.`
          : "League synced from Sleeper."),
      );
      await onSynced?.(result);
      await load();
    } catch (e) {
      setSyncError(connectionErrorMessage(e));
    } finally {
      setSyncing(false);
    }
  }, [data?.sync?.sync_action, data?.sync?.sync_endpoint, load, onSynced]);

  const meta = data?.meta || {};
  const status = data?.status || {};
  const sync = data?.sync || {};
  const counts = data?.counts || {};
  const summary = data?.summary || {};
  const decisions = data?.decisions || [];
  const wideRanges = data?.wide_ranges || [];
  const starters = data?.roster?.starters || [];
  const bench = data?.roster?.bench || [];
  const projectionChanges = data?.projection_changes || { available: false, items: [] };
  const materialMoves = (projectionChanges.items || []).filter(
    (item) => item.material === true || item.movement_material === true,
  );
  const projectionChangeItems = materialMoves.length
    ? materialMoves
    : (projectionChanges.items || []).slice(0, 8);

  const syncedLabel = sync.sleeper_synced_at
    ? formatRelativeTime(sync.sleeper_synced_at)
    : (sync.linked ? "Synced — time unknown" : "Not linked");

  const weekLabel = meta.week != null ? `Week ${meta.week}` : "This week";
  const teamLabel = data?.hub_context?.team_name || hubContext?.team_name;
  const leagueLabel = data?.hub_context?.league_name || hubContext?.league_name;
  const emptyRoster = Boolean(status.empty_roster);
  const unlinked = Boolean(status.unlinked_league);
  const canSync = Boolean(sync.sync_endpoint) && Boolean(sync.linked);
  const poorCoverage = Boolean(data) && isPoorProjectionCoverage({ counts, status });
  const rosterCount = Number(counts.roster) || 0;
  const missingCount = Number(counts.missing_projections) || 0;
  const coveredCount = Math.max(0, rosterCount - missingCount);
  const coveragePct = Math.round(projectionCoverageRatio(counts) * 100);
  const boardReady = !emptyRoster && !unlinked;

  const slots = useMemo(() => {
    const plan = buildStarterSlotPlan(hubContext?.rules);
    return fillStarterSlots(plan, starters);
  }, [hubContext?.rules, starters]);

  const hero = weekHeroCopy({
    emptyRoster,
    unlinked,
    poorCoverage,
    decisionCount: poorCoverage ? 0 : decisions.length,
    weekLabel,
  });
  const railItems = weekRailItems({ emptyRoster, unlinked, poorCoverage, counts });
  const railNote = weekRailNote({
    emptyRoster,
    unlinked,
    poorCoverage,
    headline: summary.headline,
    syncedLabel,
  });
  const primary = weekPrimaryAction({ emptyRoster, unlinked, canSync });

  const runPrimary = () => {
    if (primary.kind === "sync") return runSync();
    if (primary.kind === "setup") return onNavigateSetup?.();
    if (primary.kind === "roster") return onNavigate?.("roster");
    return load();
  };

  const overlayActions = (
    <div className="hub-wcc-board-overlay-actions">
      {canSync ? (
        <button
          type="button"
          className="btn-primary"
          onClick={runSync}
          disabled={syncing || loading}
        >
          {syncing ? "Syncing…" : "Sync league"}
        </button>
      ) : null}
      {unlinked && onNavigateSetup ? (
        <button type="button" className="btn-ghost" onClick={onNavigateSetup}>
          League settings
        </button>
      ) : null}
      {onNavigate ? (
        <button type="button" className="btn-link" onClick={() => onNavigate("roster")}>
          Add contracts
        </button>
      ) : null}
    </div>
  );

  const coverageCopy = poorCoverage ? {
    title: "Projections need attention",
    body: status.projections_missing
      ? "Weekly projections are not available for this week yet, so lineup recommendations would not be reliable."
      : `Only ${coveredCount} of ${rosterCount} roster players have weekly projections (${coveragePct}% coverage)${missingCount > 0 ? ` — ${missingCount} missing` : ""}. Lineup advice would mostly be noise until coverage improves.`,
    hint: "Recommendations use your latest synced roster. Refresh projections after a sync, or sync your league roster if it looks out of date.",
  } : null;

  const coverageActions = (
    <>
      <button
        type="button"
        className="btn-primary btn-sm"
        onClick={() => load()}
        disabled={loading || syncing}
      >
        {loading ? "Refreshing…" : "Refresh projections"}
      </button>
      {canSync ? (
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={runSync}
          disabled={syncing || loading}
        >
          {syncing ? "Syncing…" : "Sync roster"}
        </button>
      ) : null}
    </>
  );

  return (
    <HubPage className="hub-wcc hub-experience-page">
      <HubExperienceHero
        eyebrow="This week"
        heading={hero.heading}
        support={hero.support}
        chip={hero.chip}
        chipTone={hero.chipTone}
      />

      <HubExperienceLayout
        summaryLabel="This week snapshot"
        summary={(
          <HubExperienceSummary
            title={teamLabel || leagueLabel || "Your team"}
            subtitle={weekLabel + (meta.season != null ? ` · ${meta.season}` : "")}
            items={railItems}
            note={railNote}
            action={(
              <button
                type="button"
                className="btn-primary hub-experience-summary-action"
                onClick={runPrimary}
                disabled={loading || syncing}
              >
                {loading && primary.kind === "refresh"
                  ? "Refreshing…"
                  : (syncing && primary.kind === "sync" ? "Syncing…" : primary.label)}
              </button>
            )}
          />
        )}
      >
        {error && <div className="error">{error}</div>}
        {syncError && <div className="error">{syncError}</div>}
        {syncMessage && <p className="chart-note hub-wcc-sync-msg">{syncMessage}</p>}

        <WeekLineupBoard
          weekLabel={weekLabel}
          slots={slots}
          bench={bench}
          decisions={poorCoverage ? [] : decisions}
          wideRanges={wideRanges}
          projectionChanges={projectionChangeItems}
          emptyRoster={emptyRoster}
          unlinked={unlinked}
          poorCoverage={poorCoverage}
          loading={loading}
          coverageCopy={coverageCopy}
          syncedLabel={syncedLabel}
          projectionsBuiltAt={meta.projections_built_at}
          weekValue={weekOverride}
          weekPlaceholder={meta.week != null ? String(meta.week) : "auto"}
          onWeekChange={(e) => setWeekOverride(e.target.value)}
          overlayActions={loading && !data ? null : overlayActions}
          coverageActions={coverageActions}
        />

        <WeekCulturePanel
          hubContext={hubContext}
          week={weekOverride || meta.week}
          boardReady={boardReady}
        />
      </HubExperienceLayout>
    </HubPage>
  );
}
