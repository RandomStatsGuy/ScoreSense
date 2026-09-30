import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../auth";
import useFantasyReady from "../useFantasyReady";
import { startFantasyAction } from "../fantasyPerformance";
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
import WeekLineupCallSheet from "./WeekLineupCallSheet";
import WeekLineupPicker from "./WeekLineupPicker";
import { getWeeklySnapshot, setWeeklySnapshot, weeklySnapshotKey } from "./hubDataCache";
import { usePlayerMedia } from "../PlayerCell";
import { loadAura, readAura, saveAura, storageKey, vibeScore } from "./vibeAura";
import {
  buildStarterSlotPlan,
  applySavedLineup,
  fillStarterSlots,
  emptySlotAction,
  canEditHubLineup,
  decisionSwapIds,
  formatDraftNightShort,
  WEEK_BOARD_COPY,
  LINEUP_PICKER_COPY,
  eligibleLineupReplacements,
  sleeperLineupUrl,
  callSheetPlayers,
  weekHeroCopy,
  weekPrimaryAction,
  weekRailItems,
  weekRailNote,
} from "./weekBoard";

const EMPTY_ARRAY = [];

export default function WeeklyCommandCenter({
  cacheScope,
  hubContext,
  onSynced,
  onNavigateSetup,
  onNavigate,
  reloadToken,
  requestedWeek,
  embedded = false,
  onLineupChanged,
  onSummary,
}) {
  const contextKey = `${hubContext?.mode || ""}:${hubContext?.league_id || ""}:${hubContext?.team_id || ""}`;
  const [weekOverride, setWeekOverride] = useState(requestedWeek == null ? "" : String(requestedWeek));
  const snapshotKey = weeklySnapshotKey(cacheScope, contextKey, `${weekOverride}:${reloadToken}`);
  const dataKey = snapshotKey ?? `${contextKey}:${weekOverride}:${reloadToken}`;
  const [dataState, setDataState] = useState(() => ({ key: dataKey, payload: getWeeklySnapshot(snapshotKey) }));
  const data = dataState.key === dataKey ? dataState.payload : getWeeklySnapshot(snapshotKey);
  const [loading, setLoading] = useState(() => !getWeeklySnapshot(snapshotKey));
  const [revalidating, setRevalidating] = useState(false);
  const [error, setError] = useState("");
  useFantasyReady("week", "lineup", Boolean(data));
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [syncError, setSyncError] = useState("");
  const mutationScope = `${cacheScope}:${contextKey}:${weekOverride}`;
  const mutationScopeRef = useRef(mutationScope);
  mutationScopeRef.current = mutationScope;
  const readVersion = useRef(0);
  const dataRef = useRef(data);
  dataRef.current = data;
  const [pickerSlot, setPickerSlot] = useState(null);
  const [lineupMessage, setLineupMessage] = useState("");
  const [openCall, setOpenCall] = useState(null);
  const [lineupBusy, setLineupBusy] = useState(false);
  const [lineupError, setLineupError] = useState("");
  const [auraById, setAuraById] = useState({});

  useEffect(() => {
    setPickerSlot(null);
    setLineupBusy(false);
    setOpenCall(null);
    setLineupError("");
    setLineupMessage("");
  }, [contextKey, weekOverride]);

  const load = useCallback(async (signal, { rebuild = false, background = false } = {}) => {
    const version = ++readVersion.current;
    const isCurrent = () => !signal?.aborted && version === readVersion.current && mutationScopeRef.current === mutationScope;
    const cached = !rebuild ? getWeeklySnapshot(snapshotKey) : null;
    setLoading(!cached && !background);
    setRevalidating(Boolean(cached) || background);
    if (!cached && !rebuild && !background) setDataState({ key: dataKey, payload: null });
    setError("");
    try {
      const params = new URLSearchParams();
      if (weekOverride !== "") params.set("week", String(weekOverride));
      const q = params.toString();
      const path = rebuild ? `/api/hub/week/refresh${q ? `?${q}` : ""}` : `/api/hub/week${q ? `?${q}` : ""}`;
      const res = await apiFetch(path, { signal, ...(rebuild ? { method: "POST" } : {}) });
      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      if (isCurrent()) {
        setWeeklySnapshot(snapshotKey, hubContext?.league_id, payload);
        setDataState({ key: dataKey, payload });
      }
    } catch (e) {
      if (isAbortError(e) || !isCurrent()) return;
      setError(connectionErrorMessage(e, "Server did not respond — Retry"));
      if (!rebuild && !cached && !background) setDataState({ key: dataKey, payload: null });
    } finally {
      if (isCurrent()) {
        setLoading(false);
        setRevalidating(false);
      }
    }
  }, [weekOverride, snapshotKey, dataKey, hubContext?.league_id, mutationScope]);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => { ctrl.abort(); readVersion.current += 1; };
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
    : (sync.linked ? "Synced — time unknown" : data?.meta?.lineup_source === "hub" ? WEEK_BOARD_COPY.savedLineup : "Not linked");

  const weekLabel = meta.week != null ? `Week ${meta.week}` : "This week";
  const teamLabel = data?.hub_context?.team_name || hubContext?.team_name;
  const leagueLabel = data?.hub_context?.league_name || hubContext?.league_name;
  const emptyRoster = Boolean(status.empty_roster);
  const unlinked = Boolean(status.unlinked_league);
  const loadFailed = Boolean(error) && !data;
  const draftCompleted = Boolean(hubContext?.draft_completed || data?.hub_context?.draft_completed);
  const canSync = Boolean(sync.sync_endpoint) && Boolean(sync.linked);
  const poorCoverage = Boolean(data) && isPoorProjectionCoverage({ counts, status });
  useEffect(() => {
    onSummary?.(data ? { week: meta.week, calls: poorCoverage ? 0 : decisions.length } : null);
  }, [onSummary, data, meta.week, poorCoverage, decisions.length]);
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
    onBye: counts?.on_bye,
    injured: counts?.injured,
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
    weekScored: meta.week_scored,
    isCommissioner: Boolean(hubContext?.is_commissioner || data?.hub_context?.is_commissioner),
  });
  const staffLineupOpen = canEdit && Boolean(meta.lineup_locked) && !meta.week_scored;
  const leagueId = data?.hub_context?.league_id || hubContext?.league_id;
  const sleeperLeagueId = data?.hub_context?.sleeper_league_id || hubContext?.sleeper_league_id || "";

  useEffect(() => {
    const key = storageKey({
      leagueId,
      season: meta.season,
      week: meta.week,
    });
    setAuraById(loadAura(key));
    if (!leagueId || meta.week == null) return undefined;
    const ctrl = new AbortController();
    (async () => {
      try {
        const params = new URLSearchParams({ week: String(meta.week) });
        if (meta.season != null) params.set("season", String(meta.season));
        const res = await apiFetch(`/api/hub/vibes?${params}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const payload = await res.json();
        const remote = payload?.aura_by_id;
        if (remote && typeof remote === "object" && Object.keys(remote).length) {
          setAuraById(remote);
          saveAura(key, remote);
        }
      } catch (e) {
        if (isAbortError(e) || ctrl.signal.aborted) return;
      }
    })();
    return () => ctrl.abort();
  }, [leagueId, meta.season, meta.week]);

  const mediaIds = useMemo(() => (
    [...starters, ...bench].map((player) => player?.player_id).filter(Boolean)
  ), [bench, starters]);
  const media = usePlayerMedia(mediaIds);
  const openPlayers = openCall ? callSheetPlayers(openCall, starters, bench) : { starter: null, bench: null };

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

  const applyFill = useCallback(async (slot, benchPlayer) => {
    if (!leagueId || !slot?.slot || !benchPlayer?.player_id) return;
    const finishAction = startFantasyAction("lineup-fill");
    setLineupBusy(true);
    setLineupError("");
    setRevalidating(false);
    readVersion.current += 1;
    try {
      const starters = slots
        .filter((row) => row.player?.player_id)
        .map((row) => ({ player_id: row.player.player_id, slot: row.slot }));
      starters.push({ player_id: benchPlayer.player_id, slot: slot.slot });
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/lineup`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          starters,
          week: weekOverride !== "" ? Number(weekOverride) : (meta.week ?? undefined),
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const result = await res.json();
      if (mutationScopeRef.current !== mutationScope) { finishAction("superseded"); return false; }
      const saved = applySavedLineup(dataRef.current, result);
      setWeeklySnapshot(snapshotKey, leagueId, saved);
      setDataState({ key: dataKey, payload: saved });
      setPickerSlot(null);
      finishAction("saved");
      void load(undefined, { background: true });
      onLineupChanged?.();
      return true;
    } catch (e) {
      finishAction("rejected");
      if (mutationScopeRef.current !== mutationScope) return false;
      setLineupError(connectionErrorMessage(e));
      return false;
    } finally {
      if (mutationScopeRef.current === mutationScope) setLineupBusy(false);
    }
  }, [leagueId, load, meta.week, slots, weekOverride, mutationScope, onLineupChanged, snapshotKey, dataKey]);

  const applySwap = useCallback(async (starterId, benchId) => {
    if (!leagueId || !starterId || !benchId) return;
    const finishAction = startFantasyAction("lineup-swap");
    setLineupBusy(true);
    setLineupError("");
    setRevalidating(false);
    readVersion.current += 1;
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
      const result = await res.json();
      if (mutationScopeRef.current !== mutationScope) { finishAction("superseded"); return false; }
      const saved = applySavedLineup(dataRef.current, result);
      setWeeklySnapshot(snapshotKey, leagueId, saved);
      setDataState({ key: dataKey, payload: saved });
      setPickerSlot(null);
      setOpenCall(null);
      finishAction("saved");
      void load(undefined, { background: true });
      onLineupChanged?.();
      return true;
    } catch (e) {
      finishAction("rejected");
      if (mutationScopeRef.current !== mutationScope) return false;
      setLineupError(connectionErrorMessage(e));
      return false;
    } finally {
      if (mutationScopeRef.current === mutationScope) setLineupBusy(false);
    }
  }, [leagueId, load, meta.week, weekOverride, mutationScope, onLineupChanged, snapshotKey, dataKey]);

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
    compact: embedded,
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
    coverageActions: openCall || pickerSlot ? null : coverageActions,
    refreshAction: () => load(undefined, { rebuild: true }),
    refreshing: loading,
    canEdit: canEdit && !lineupBusy,
    lineupLocked: Boolean(meta.lineup_locked),
    sleeperLeagueId,
    selectedSlotKey: pickerSlot?.key || pickerSlot?.slot || "",
    onOpenSlot: (slot) => {
      setOpenCall(null);
      setLineupError("");
      setLineupMessage("");
      setPickerSlot(slot);
    },
    onNavigate,
    onFillSlot: (slot) => {
      const action = emptySlotAction(slot, bench, hubContext?.rules || data?.hub_context?.rules);
      if (eligibleLineupReplacements(slot, bench, hubContext?.rules || data?.hub_context?.rules).length) {
        setLineupError("");
        setLineupMessage("");
        setPickerSlot(slot);
        return;
      }
      onNavigate?.("available", { pos: action.pos });
    },
    onApplyDecision: (decision) => {
      const ids = decisionSwapIds(decision);
      if (ids) applySwap(ids.starter_player_id, ids.bench_player_id);
    },
    onOpenCall: (decision) => { setPickerSlot(null); setOpenCall(decision); },
    media,
  };

  const Page = embedded ? "section" : HubPage;
  const Layout = embedded ? React.Fragment : HubExperienceLayout;
  return (
    <Page className={`hub-wcc${embedded ? " hub-week-lineup" : " hub-experience-page"}${openCall || pickerSlot ? " is-call-open" : ""}`}>
      {!embedded && <HubExperienceHero
        eyebrow="This week"
        heading={hero.heading}
        support={hero.support}
        chip={hero.chip}
        chipTone={hero.chipTone}
      >
        {decisions.length > 0 && !poorCoverage ? (
          <a href="#hub-wcc-calls" className="btn-link">{WEEK_BOARD_COPY.seeCalls}</a>
        ) : null}
      </HubExperienceHero>}

      {revalidating && data ? <p className="chart-note" role="status">Checking for lineup updates…</p> : null}

      {embedded && <h2 id="hub-week-lineup-heading" tabIndex={-1} className="sr-only">{WEEK_BOARD_COPY.lineupTitle}</h2>}
      <Layout {...(embedded ? {} : {
        summaryLabel:"This week snapshot",
        summary:(
          <HubExperienceSummary
            title={teamLabel || leagueLabel || "Your team"}
            subtitle={weekLabel + (meta.season != null ? ` · ${meta.season}` : "")}
            items={railItems}
            note={railNote}
            action={openCall || pickerSlot ? null : primary.kind === "strip-sync" ? (
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
        ),
        footer:!emptyRoster && bench.length > 0 ? (
          <WeekLineupBoard {...boardProps} includeChrome={false} includeStarters={false} />
        ) : null,
      })}>
        {error && <div className="error" role="alert">{error}</div>}
        {syncError && <div className="error">{syncError}</div>}
        {staffLineupOpen && <p className="chart-note">{WEEK_BOARD_COPY.staffLineupOpen}</p>}
        {lineupError && !pickerSlot && <div className="error" role="alert">{lineupError}</div>}
        {lineupMessage && <p className="hub-wcc-lineup-saved" role="status">{lineupMessage}</p>}
        {!embedded && meta.lineup_default_policy === "weekly_projections" && !meta.lineup_locked && (
          <p className="chart-note">{WEEK_BOARD_COPY.projectionDefaults}</p>
        )}
        {syncMessage && <p className="chart-note hub-wcc-sync-msg">{syncMessage}</p>}

        <WeekLineupBoard {...boardProps} includeBench={embedded} showWeekStepper={!embedded} />
        {embedded && !loading && data && <footer className="hub-week-lineup-footer">
          {sleeperLeagueId ? <a className="btn-link" href={sleeperLineupUrl(sleeperLeagueId)} target="_blank" rel="noreferrer">{WEEK_BOARD_COPY.manageSleeper} ↗</a>
            : !canEdit ? <p>{LINEUP_PICKER_COPY.readonly}</p> : null}
          {meta.week && hubContext?.is_commissioner && !sleeperLeagueId && <button type="button" className="btn-link" onClick={() => onNavigate?.("office-corrections", {week:meta.week})}>{WEEK_BOARD_COPY.correctLineup}</button>}
        </footer>}

      </Layout>
      {pickerSlot && <WeekLineupPicker
        key={`${contextKey}:${meta.week}:${pickerSlot.key || pickerSlot.slot}`}
        slot={pickerSlot} benchPlayer={pickerSlot.slot === "BN" ? pickerSlot.player : null} slots={slots} bench={bench} rules={hubContext?.rules || data?.hub_context?.rules}
        media={media} canEdit={canEdit} lineupLocked={Boolean(meta.lineup_locked)}
        staffOverride={Boolean(hubContext?.is_commissioner || data?.hub_context?.is_commissioner)}
        sleeperLeagueId={sleeperLeagueId} busy={lineupBusy} error={lineupError}
        onClose={() => { if (!lineupBusy) setPickerSlot(null); }} onNavigate={onNavigate}
        onApply={async (slot, player) => {
          const saved = slot.player?.player_id
            ? await applySwap(slot.player.player_id, player.player_id)
            : await applyFill(slot, player);
          if (saved && mutationScopeRef.current === mutationScope) setLineupMessage(LINEUP_PICKER_COPY.saved(player.player_name || player.player_id, slot.slot));
        }}
      />}
      {openCall ? (
        <WeekLineupCallSheet
          decision={openCall}
          starter={openPlayers.starter}
          bench={openPlayers.bench}
          media={media}
          season={meta.season}
          week={meta.week}
          canEdit={canEdit && !lineupBusy}
          lineupLocked={Boolean(meta.lineup_locked)}
          sleeperLeagueId={sleeperLeagueId}
          busy={lineupBusy}
          onClose={() => setOpenCall(null)}
          onApply={(decision) => {
            const ids = decisionSwapIds(decision);
            if (ids) applySwap(ids.starter_player_id, ids.bench_player_id);
          }}
        />
      ) : null}
    </Page>
  );
}
