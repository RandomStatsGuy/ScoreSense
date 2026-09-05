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
import WeekLineupBoard from "./WeekLineupBoard";
import { loadAura, readAura, storageKey, vibeScore } from "./vibeAura";
import {
  buildStarterSlotPlan,
  fillStarterSlots,
  canEditHubLineup,
  decisionSwapIds,
  formatDraftNightShort,
  WEEK_BOARD_COPY,
  weekHeroCopy,
  weekPrimaryAction,
  weekRailItems,
  weekRailNote,
} from "./weekBoard";

const EMPTY_ARRAY = [];

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
  const [selectedBenchId, setSelectedBenchId] = useState("");
  const [lineupBusy, setLineupBusy] = useState(false);
  const [lineupError, setLineupError] = useState("");
  const [auraById, setAuraById] = useState({});

  const load = useCallback(async (signal, { rebuild = false } = {}) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (weekOverride !== "") params.set("week", String(weekOverride));
      const q = params.toString();
      const path = rebuild ? `/api/hub/week/refresh${q ? `?${q}` : ""}` : `/api/hub/week${q ? `?${q}` : ""}`;
      const res = await apiFetch(path, { signal, ...(rebuild ? { method: "POST" } : {}) });
      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      if (!signal?.aborted) setData(payload);
    } catch (e) {
      if (isAbortError(e) || signal?.aborted) return;
      setError(connectionErrorMessage(e, "Server did not respond — Retry"));
      if (!rebuild) setData(null);
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
  const decisions = data?.decisions || EMPTY_ARRAY;
  const wideRanges = data?.wide_ranges || EMPTY_ARRAY;
  const starters = data?.roster?.starters || EMPTY_ARRAY;
  const bench = data?.roster?.bench || EMPTY_ARRAY;
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
  const loadFailed = Boolean(error) && !data;
  const draftCompleted = Boolean(hubContext?.draft_completed || data?.hub_context?.draft_completed);
  const canSync = Boolean(sync.sync_endpoint) && Boolean(sync.linked);
  const poorCoverage = Boolean(data) && isPoorProjectionCoverage({ counts, status });
  const rosterCount = Number(counts.roster) || 0;
  const missingCount = Number(counts.missing_projections) || 0;
  const coveredCount = Math.max(0, rosterCount - missingCount);
  const coveragePct = Math.round(projectionCoverageRatio(counts) * 100);

  const slots = useMemo(() => {
    const plan = buildStarterSlotPlan(hubContext?.rules);
    return fillStarterSlots(plan, starters);
  }, [hubContext?.rules, starters]);

  const draftNightLabel = formatDraftNightShort(
    hubContext?.draft_starts_at || data?.hub_context?.draft_starts_at,
  );
  const hero = weekHeroCopy({
    loading: loading && !data,
    loadFailed,
    emptyRoster,
    unlinked,
    draftCompleted,
    poorCoverage,
    decisionCount: poorCoverage ? 0 : decisions.length,
    weekLabel,
    draftNightLabel,
  });
  const railItems = weekRailItems({
    loading: loading && !data,
    loadFailed,
    emptyRoster,
    unlinked,
    poorCoverage,
    counts,
  });
  const railNote = weekRailNote({
    loadFailed,
    emptyRoster,
    unlinked,
    draftCompleted,
    poorCoverage,
    headline: summary.headline,
    syncedLabel,
  });
  const showGameCenter = Boolean(hubContext?.mode === "league" || data?.hub_context?.mode === "league");
  const primary = weekPrimaryAction({
    loading: loading && !data,
    loadFailed,
    emptyRoster,
    unlinked,
    canSync,
    draftCompleted,
    sleeperStale: canSync && emptyRoster,
    showGameCenter,
  });
  const canEdit = canEditHubLineup({
    mode: data?.hub_context?.mode || hubContext?.mode,
    lineupSource: meta.lineup_source,
    lineupLocked: meta.lineup_locked,
  });
  const leagueId = data?.hub_context?.league_id || hubContext?.league_id;
  const sleeperLeagueId = data?.hub_context?.sleeper_league_id || hubContext?.sleeper_league_id || "";

  useEffect(() => {
    const key = storageKey({
      leagueId,
      season: meta.season,
      week: meta.week,
    });
    setAuraById(loadAura(key));
  }, [leagueId, meta.season, meta.week]);

  const vibeById = useMemo(() => {
    const map = {};
    const rated = auraById && typeof auraById === "object" ? auraById : {};
    for (const player of [...starters, ...bench]) {
      const id = String(player?.player_id || "");
      if (!id || !Object.prototype.hasOwnProperty.call(rated, id)) continue;
      map[id] = vibeScore(player, readAura(rated, id));
    }
    return map;
  }, [auraById, bench, starters]);

  const applySwap = useCallback(async (starterId, benchId) => {
    if (!leagueId || !starterId || !benchId) return;
    setLineupBusy(true);
    setLineupError("");
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/lineup/swap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          starter_player_id: starterId,
          bench_player_id: benchId,
          week: weekOverride !== "" ? Number(weekOverride) : (meta.week ?? undefined),
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      setSelectedBenchId("");
      await load();
    } catch (e) {
      setLineupError(connectionErrorMessage(e));
    } finally {
      setLineupBusy(false);
    }
  }, [leagueId, load, meta.week, weekOverride]);

  const runPrimary = () => {
    if (primary.kind === "sync" || primary.kind === "strip-sync") return undefined;
    if (primary.kind === "office-access") return onNavigate?.("office-access") || onNavigateSetup?.();
    if (primary.kind === "room") return onNavigate?.("room");
    if (primary.kind === "setup") return onNavigate?.("office-access") || onNavigateSetup?.();
    if (primary.kind === "roster") return onNavigate?.("roster");
    if (primary.kind === "game") return onNavigate?.("game");
    if (primary.kind === "retry") return load();
    return undefined;
  };

  const overlayActions = (emptyRoster || loadFailed) ? (
    <div className="hub-wcc-board-overlay-actions">
      {primary.kind === "room" ? (
        <button type="button" className="btn-primary" onClick={() => onNavigate?.("room")}>
          {primary.label}
        </button>
      ) : null}
      {primary.kind === "office-access" ? (
        <button
          type="button"
          className="btn-primary"
          onClick={() => onNavigate?.("office-access") || onNavigateSetup?.()}
        >
          {primary.label}
        </button>
      ) : null}
      {primary.kind === "retry" ? (
        <>
          <button type="button" className="btn-primary" onClick={() => load()} disabled={loading}>
            {loading ? "Retrying…" : primary.label}
          </button>
          {onNavigate ? (
            <button type="button" className="btn-ghost" onClick={() => onNavigate("room")}>
              Open Draft
            </button>
          ) : null}
        </>
      ) : null}
      {primary.kind === "strip-sync" ? (
        <p className="chart-note">Use Sync league in the league strip.</p>
      ) : null}
    </div>
  ) : null;

  const coverageCopy = poorCoverage ? {
    title: "Projections need attention",
    body: status.projections_missing
      ? "Weekly projections are not available for this week yet, so lineup recommendations would not be reliable."
      : `Only ${coveredCount} of ${rosterCount} roster players have weekly projections (${coveragePct}% coverage)${missingCount > 0 ? ` — ${missingCount} missing` : ""}. Lineup advice would mostly be noise until coverage improves.`,
    hint: "Refresh projections rebuilds this week's model artifacts. Sync the league roster if names look out of date.",
  } : null;

  const coverageActions = (
    <>
      <button
        type="button"
        className="btn-primary btn-sm"
        onClick={() => load(undefined, { rebuild: true })}
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

  const boardProps = {
    weekLabel,
    slots,
    bench,
    decisions: poorCoverage ? [] : decisions,
    wideRanges,
    projectionChanges: projectionChangeItems,
    emptyRoster,
    loadFailed,
    unlinked,
    poorCoverage,
    loading: loading && !data,
    error: Boolean(error) && !data,
    coverageCopy,
    syncedLabel,
    projectionsBuiltAt: meta.projections_built_at,
    rosterSyncedAt: sync.sleeper_synced_at,
    vibeById,
    weekValue: weekOverride,
    weekPlaceholder: meta.week != null ? String(meta.week) : "auto",
    onWeekChange: (week) => setWeekOverride(String(week)),
    overlayActions: loading && !data ? null : overlayActions,
    coverageActions,
    refreshAction: () => load(undefined, { rebuild: true }),
    refreshing: loading,
    canEdit: canEdit && !lineupBusy,
    lineupLocked: Boolean(meta.lineup_locked),
    sleeperLeagueId,
    selectedBenchId,
    onSelectBench: (player) => {
      const pid = String(player?.player_id || "");
      setSelectedBenchId((cur) => (cur === pid ? "" : pid));
    },
    onSelectSlot: (slot) => {
      const starterId = slot?.player?.player_id;
      if (selectedBenchId && starterId) {
        applySwap(starterId, selectedBenchId);
      }
    },
    onNavigate,
    onApplyDecision: (decision) => {
      const ids = decisionSwapIds(decision);
      if (ids) applySwap(ids.starter_player_id, ids.bench_player_id);
    },
  };

  return (
    <HubPage className="hub-wcc hub-experience-page">
      <HubExperienceHero
        eyebrow="This week"
        heading={hero.heading}
        support={hero.support}
        chip={hero.chip}
        chipTone={hero.chipTone}
      >
        {decisions.length > 0 && !poorCoverage ? (
          <a href="#hub-wcc-calls" className="btn-link">{WEEK_BOARD_COPY.seeCalls}</a>
        ) : null}
      </HubExperienceHero>

      <HubExperienceLayout
        summaryLabel="This week snapshot"
        summary={(
          <HubExperienceSummary
            title={teamLabel || leagueLabel || "Your team"}
            subtitle={weekLabel + (meta.season != null ? ` · ${meta.season}` : "")}
            items={railItems}
            note={railNote}
            action={primary.kind === "strip-sync" ? (
              <p className="hub-experience-summary-note">Use Sync league in the league strip.</p>
            ) : primary.kind && primary.kind !== "none" && primary.kind !== "wait" ? (
              <button
                type="button"
                className="btn-primary hub-experience-summary-action"
                onClick={runPrimary}
                disabled={loading || syncing}
              >
                {loading && primary.kind === "retry" ? "Retrying…" : primary.label}
              </button>
            ) : null}
            status={primary.kind === "game" ? (
              <p className="hub-experience-summary-note">{WEEK_BOARD_COPY.gameCenterSupport}</p>
            ) : null}
          />
        )}
        footer={!emptyRoster && bench.length > 0 ? (
          <WeekLineupBoard {...boardProps} includeChrome={false} includeStarters={false} />
        ) : null}
      >
        {error && <div className="error">{error}</div>}
        {syncError && <div className="error">{syncError}</div>}
        {lineupError && <div className="error">{lineupError}</div>}
        {syncMessage && <p className="chart-note hub-wcc-sync-msg">{syncMessage}</p>}

        <WeekLineupBoard {...boardProps} includeBench={false} />

      </HubExperienceLayout>
    </HubPage>
  );
}
