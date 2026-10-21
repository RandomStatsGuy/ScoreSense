import {hasProjectionPosition} from "./projectionPositions";
import {isByeWeek} from "./weeklyAvailability";
import React, {useEffect, useMemo, useState} from "react";
import Chip, {injuryChipTone} from "./Chip";
import {fmtNum, formatRelativeTime, isPlayerUnavailable, unavailableLabel} from "./format";
import {ExportCsvButton, useTableSort, useRankMap, rowRankKey, csvQuote, downloadCsv} from "./table";
import useMobileLayout from "./useMobileLayout";
import usePlayersContext from "./usePlayersContext";
import {usePlayerMedia} from "./PlayerCell";
import {filterWeeklyBoardRows} from "./weeklyBoardFilter";
import {usePlayerCardOptional} from "./PlayerCardContext";
import {MOVEMENT_FILTERS, isLeftSlate, movementEmptyMessage, movementSortScore} from "./projectionMovement";
import {pickOpportunityAdjustment} from "./opportunityAdjustment";
import {BOARD_COPY, isBoardAvailable, staleRefreshLabel, weeklyContextNeedsRefresh, weeklyBoardPreview, weeklyPeerStats, projectionNumber, projectionRankMovement} from "./projectionsPresentation";
import ProjectionTierBoard from "./ProjectionTierBoard";
import {ProjectionBoardHeader} from "./ProjectionBoardChrome";
import {projectionPosition, projectionValue} from "./projectionTiers";
const SORT_KEYS = {Player:"Player", Team:"Team", Opponent:"Opponent", Narrative:"Narrative", P50:"Projected Points", P10:"Low (P10)", P90:"High (P90)", Opportunity:"_opportunity_adjustment", RankDelta:"rank_delta", P50Delta:"p50_delta", Move:"_movement_score"};

function injuryAbbrev(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("questionable")) return { short: "Q", label: "Questionable" };
  if (s.includes("doubtful")) return { short: "D", label: "Doubtful" };
  if (s.includes("probable")) return { short: "P", label: "Probable" };
  return null;
}

export function InjuryStatusTag({ status, verbose = false }) {
  const abbrev = injuryAbbrev(status);
  if (!abbrev) return null;
  return (
    <Chip
      tone={injuryChipTone(status)}
      className={`player-status-chip${verbose ? " player-status-chip--verbose" : ""}`}
      title={`Injury status: ${status}`}
      aria-label={`Injury status: ${status}`}
    >
      {verbose ? (
        <>
          <span className="player-status-chip-short">{abbrev.short}</span>
          <span className="player-status-chip-label">{abbrev.label}</span>
        </>
      ) : (
        abbrev.short
      )}
    </Chip>
  );
}

function exportCsv(rows) {
  const header = [
    "Player",
    "Team",
    "Projected",
    "Floor",
    "Ceiling",
    "P50 Δ",
    "Rank Δ",
    "Prev Rank",
    "Opportunity Adjustment",
    "Injury Status",
  ];
  const lines = [
    header.join(","),
    ...rows.map((row) => {
      const status = row["Injury Status"] || "";
      const bye = isByeWeek(row);
      const unavailable = isPlayerUnavailable(status);
      const boost = pickOpportunityAdjustment(row);
      return [
        csvQuote(row.Player),
        row.Team || "",
        bye ? "BYE" : unavailable ? "OUT" : fmtNum(row["Projected Points"], 2, ""),
        bye ? "BYE" : unavailable ? "OUT" : fmtNum(row["Low (P10)"], 2, ""),
        bye ? "BYE" : unavailable ? "OUT" : fmtNum(row["High (P90)"], 2, ""),
        Number.isFinite(Number(row.p50_delta)) ? Number(row.p50_delta).toFixed(2) : "",
        Number.isFinite(Number(row.rank_delta)) ? String(row.rank_delta) : "",
        Number.isFinite(Number(row.previous_rank)) ? String(row.previous_rank) : "",
        !bye && !unavailable && boost != null && boost !== 0 ? (boost * 100).toFixed(1) : "",
        bye ? BOARD_COPY.byeWeek : unavailable ? unavailableLabel(status) : status,
      ].join(",");
    }),
  ];
  downloadCsv("scoresense-projections", lines);
}

// Number(null) === 0; coerce missing projections to NaN so they stay unranked.
const rankMetric = (row) =>
  !isBoardAvailable(row) ? NaN : Number(row["Projected Points"] ?? NaN);

export default function WeeklyTable({
  rows,
  search,
  teamsFilter,
  searchSlot,
  metaLine,
  boardKicker,
  boardFilters = [],
  showSentiment = false,
  loading = false,
  position,
  season,
  week,
  applyInjuryAdjustments = true,
  onClearFilters,
  /** SCORE-34: shared preseason media_mode for compact list + detail panels. */
  mediaMode = null,
  onMediaModeChange,
  /** SCORE-4: enable 2–4 player start/sit multi-select. */
  compareEnabled = false,
  selectedCompareIds = null,
  maxCompare = 4,
  onToggleCompare,
  onOpenCompare,
  onClearCompare,
  onRemoveCompare,
  compareSelectionMeta = null,
  /** SCORE-7: Biggest Movers filter + soft-joined movement fields. */
  movementFilter = "all",
  onMovementFilterChange,
  movementAvailable = false,
  /** SCORE-48: show filter chips whenever movement meta is present (even if empty). */
  showMovementFilters = null,
  movementEmptyReason = null,
  movementNote = null,
  /** Left-slate rows from `/changes` (not soft-joined onto current projections). */
  leftSlateRows = null,
  hideMovementFilters = false,
  attentionPlayerIds = null,
  onOpenPlayer,
  onRefreshData,
  dataRefreshLoading = false,
  onContextMeta,
  contextReloadToken = 0,
}) {
  const [sort, toggleSort] = useTableSort({ column: "P50", dir: "desc" });
  const [compareSelecting, setCompareSelecting] = useState(false);
  const mobileLayout = useMobileLayout();
  const playerCard = usePlayerCardOptional();
  const playersContext = usePlayersContext(season, week, {
    enabled: season != null && week != null,
    mediaMode,
    reloadToken: contextReloadToken,
  });
  const selectedSet = useMemo(
    () => new Set((selectedCompareIds || []).map(String)),
    [selectedCompareIds],
  );
  const selectedCount = selectedSet.size;
  const selectDisabled = selectedCount >= maxCompare;
  const showMovement = Boolean(movementAvailable);
  const showFilters =
    showMovementFilters == null ? showMovement : Boolean(showMovementFilters);

  useEffect(() => {
    setCompareSelecting(false);
  }, [position, season, week, applyInjuryAdjustments]);

  // When switching into a movers filter, prefer biggest-move sort.
  useEffect(() => {
    if (!showFilters) return;
    if (movementFilter && movementFilter !== "all") {
      toggleSort("Move", { forceDir: "desc" });
    }
  }, [movementFilter, showFilters]); // eslint-disable-line react-hooks/exhaustive-deps

  const showOpponent = useMemo(
    () => (rows || []).some((row) => row.Opponent),
    [rows]
  );

  const peerStats = useMemo(() => weeklyPeerStats(rows.filter(row=>hasProjectionPosition(row,position)), { position }), [rows, position]);

  const filtered = useMemo(
    () => filterWeeklyBoardRows(rows, {
      search,
      teamsFilter,
      movementFilter,
      showFilters,
      leftSlateRows,
      attentionPlayerIds,
    }),
    [rows, search, teamsFilter, showFilters, movementFilter, leftSlateRows, attentionPlayerIds],
  );

  const contextNeedsRefresh = weeklyContextNeedsRefresh({
    stale: Boolean(playersContext.meta?.stale),
    unavailable: Boolean(playersContext.unavailable),
  });

  useEffect(() => {
    if (!onContextMeta) return undefined;
    onContextMeta({
      stale: Boolean(playersContext.meta?.stale),
      unavailable: Boolean(playersContext.unavailable),
      updatedAt: playersContext.meta?.updated_at || null,
    });
    return undefined;
  }, [
    onContextMeta,
    playersContext.meta?.stale,
    playersContext.meta?.updated_at,
    playersContext.unavailable,
  ]);

  const sorted = useMemo(() => {
    const key = SORT_KEYS[sort.column] || sort.column;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      // Injury OUT stays at the bottom; left-slate rows sort by movement score.
      const aOut = isPlayerUnavailable(a["Injury Status"]);
      const bOut = isPlayerUnavailable(b["Injury Status"]);
      if (aOut !== bOut) return aOut ? 1 : -1;

      if (key === "Player" || key === "Team" || key === "Opponent") {
        return dir * String(a[key] || "").localeCompare(String(b[key] || ""));
      }
      if (key === "Narrative") {
        const av = Number(a.sentiment?.mention_count) || 0;
        const bv = Number(b.sentiment?.mention_count) || 0;
        if (av !== bv) return dir * (av - bv);
        const as = Number(a.sentiment?.sentiment_score) || 0;
        const bs = Number(b.sentiment?.sentiment_score) || 0;
        return dir * (as - bs);
      }
      if (key === "_movement_score") {
        return dir * (movementSortScore(a) - movementSortScore(b));
      }
      if (key === "_opportunity_adjustment") {
        const av = pickOpportunityAdjustment(a) || 0;
        const bv = pickOpportunityAdjustment(b) || 0;
        return dir * (av - bv);
      }
      if (key === "rank_delta" || key === "p50_delta") {
        const av = Number(a[key]);
        const bv = Number(b[key]);
        const aMissing = !Number.isFinite(av);
        const bMissing = !Number.isFinite(bv);
        if (aMissing !== bMissing) return aMissing ? 1 : -1;
        if (av !== bv) return dir * (av - bv);
        return dir * (movementSortScore(a) - movementSortScore(b));
      }
      const av = Number(a[key]) || 0;
      const bv = Number(b[key]) || 0;
      return dir * (av - bv);
    });
  }, [filtered, sort]);

  const playerIds = useMemo(
    () => sorted.map((r) => r.player_id).filter(Boolean),
    [sorted],
  );
  const playerMedia = usePlayerMedia(playerIds);

  // Position rank over the full slate (stable regardless of sort/filter).
  const rankMap = useRankMap(rows.filter(row=>hasProjectionPosition(row,position)), rankMetric);
  const hasFilters = Boolean(
    (search || "").trim() ||
      teamsFilter?.length ||
      (showFilters && movementFilter && movementFilter !== "all"),
  );
  const movementFilterActive = Boolean(
    showFilters && movementFilter && movementFilter !== "all",
  );
  const emptyMessage = loading
    ? null
    : movementFilterActive && sorted.length === 0 && !(search || "").trim() && !teamsFilter?.length
      ? movementEmptyMessage(movementEmptyReason, movementNote, {
          filterId: movementFilter,
        }) || "No players match this movement filter."
      : hasFilters
        ? movementFilterActive
          ? "No players match this movement filter."
          : "No players match your search or team filters."
        : "No projections available for this week.";

  const hasBoardNotice = Boolean(metaLine || (showFilters && !showMovement)
    || (!playersContext.unavailable && playersContext.meta?.updated_at) || contextNeedsRefresh);

  return (
    <>
      {searchSlot ? (
      <div className="table-controls">
        {searchSlot}
      </div>
      ) : null}
      {showFilters && !hideMovementFilters ? (
        <div
          className="proj-move-filter"
          role="group"
          aria-label="Projection movement filter"
        >
          {MOVEMENT_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`proj-move-filter-btn${movementFilter === f.id ? " active" : ""}`}
              onClick={() => onMovementFilterChange?.(f.id)}
              aria-pressed={movementFilter === f.id}
            >
              {f.label}
            </button>
          ))}
        </div>
      ) : null}
      {!mobileLayout ? <div className="weekly-board-intro" data-compact-board-intro>
        <ProjectionBoardHeader compact kicker={boardKicker} title={BOARD_COPY.weeklyBoard}
          filters={boardFilters} activeFilter={movementFilter} onFilterChange={onMovementFilterChange}
          actions={<div className="table-toolbar-actions">
          {!mobileLayout ? (
            <ExportCsvButton onExport={() => exportCsv(sorted)} disabled={!sorted.length} />
          ) : null}
          {compareEnabled ? (
            <button
              type="button"
              className={`proj-board-filter compare-mode-toggle${compareSelecting ? " is-active" : ""}`}
              aria-pressed={compareSelecting}
              onClick={() => setCompareSelecting((on) => !on)}
            >
              {compareSelecting ? BOARD_COPY.compareDone : BOARD_COPY.compare}
            </button>
          ) : null}
        </div>} />
      {hasBoardNotice ? <div className="table-toolbar">
        <div className="table-toolbar-meta">
          {metaLine}
          {showFilters && !showMovement ? (
            <span className="table-meta table-meta-movement" role="status">
              {movementEmptyMessage(movementEmptyReason, movementNote) || BOARD_COPY.movementUnavailable}
            </span>
          ) : null}
          {!mobileLayout && !playersContext.unavailable && playersContext.meta?.updated_at ? (
            <span className="table-meta" role="status">
              {`Injury context · ${(formatRelativeTime(playersContext.meta.updated_at) || "").replace(/^Updated /, "")}`}
            </span>
          ) : null}
          {!mobileLayout && contextNeedsRefresh ? (
            onRefreshData ? (
              <button
                type="button"
                className="table-meta table-meta-context-stale table-meta-context-stale--action"
                onClick={onRefreshData}
                disabled={dataRefreshLoading}
              >
                {staleRefreshLabel({
                  stale: Boolean(playersContext.meta?.stale),
                  unavailable: Boolean(playersContext.unavailable),
                  updatedAt: playersContext.meta?.updated_at,
                  refreshing: dataRefreshLoading,
                })}
              </button>
            ) : (
              <span className="table-meta table-meta-context-stale" role="status">
                {staleRefreshLabel({
                  canRefresh: false,
                  stale: Boolean(playersContext.meta?.stale),
                  unavailable: Boolean(playersContext.unavailable),
                  updatedAt: playersContext.meta?.updated_at,
                })}
              </span>
            )
          ) : null}

        </div>

      </div> : null}
      </div> : null}
      {compareEnabled && compareSelecting ? (
        <p className="compare-mode-hint" role="status">
          {BOARD_COPY.compareHint}
        </p>
      ) : null}
      {compareEnabled && selectedCount > 0 ? (
        <div className="compare-selection-bar" role="region" aria-label="Compare selection">
          <div className="compare-selection-count">
            <strong>
              {selectedCount} selected
            </strong>
            <span className="muted">
              {selectedCount < 2
                ? ` · pick ${2 - selectedCount} more`
                : selectedCount >= maxCompare
                  ? ` · max ${maxCompare}`
                  : ` · ${BOARD_COPY.comparePick}`}
            </span>
          </div>
          {compareSelectionMeta?.length ? (
            <div className="compare-selection-chips">
              {compareSelectionMeta.map((p) => {
                const id = String(p.player_id || "");
                const name = p.name || id;
                return (
                  <button
                    key={id}
                    type="button"
                    className="compare-selection-chip"
                    onClick={() => onRemoveCompare?.(id)}
                    aria-label={`Remove ${name} from compare`}
                    title={`Remove ${name}`}
                  >
                    <span>{name}</span>
                    <span aria-hidden="true">×</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="compare-selection-actions">
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={onClearCompare}
            >
              Clear
            </button>
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={selectedCount < 2}
              onClick={onOpenCompare}
            >
              {BOARD_COPY.compareOpen}
            </button>
          </div>
        </div>
      ) : null}
      <ProjectionTierBoard position={position} rows={sorted} media={playerMedia} loading={loading}
        tierBasis={BOARD_COPY.weeklyTierBasis} sort={sort} onSort={toggleSort}
        toolbarAction={mobileLayout&&compareEnabled?<button type="button"
          className={`proj-board-filter compare-mode-toggle${compareSelecting?" is-active":""}`}
          aria-pressed={compareSelecting} onClick={()=>setCompareSelecting(value=>!value)}>
          {compareSelecting?BOARD_COPY.compareDone:BOARD_COPY.compare}</button>:null}
        emptyMessage={emptyMessage} onClearFilters={hasFilters ? onClearFilters : undefined}
        selecting={compareSelecting} selectedIds={selectedSet} maxSelected={maxCompare} onSelect={onToggleCompare}
        getTierValue={row => row["Projected Points"]}
        getStatus={row => isLeftSlate(row) ? "left" : isByeWeek(row) ? "bye" : isPlayerUnavailable(row["Injury Status"]) ? "inactive" : null}
        columns={[
          ...(showOpponent ? [{key:"opponent",label:BOARD_COPY.matchup,sortKey:"Opponent",text:true}] : []),
          {key:"floor",label:BOARD_COPY.floor,sortKey:"P10",forecast:true},
          {key:"ceiling",label:BOARD_COPY.ceiling,sortKey:"P90",forecast:true},
          {key:"points",label:BOARD_COPY.projected,sortKey:"P50",forecast:true},
        ]}
        getView={row => {
          const status=row["Injury Status"]||"";
          const blocked=isByeWeek(row)?BOARD_COPY.byeWeek:isLeftSlate(row)?BOARD_COPY.leftTier:isPlayerUnavailable(status)?unavailableLabel(status):null;
          const low=projectionValue(row["Low (P10)"]), high=projectionValue(row["High (P90)"]);
          return {rank:rankMap.get(rowRankKey(row)), movement:isByeWeek(row)||!hasProjectionPosition(row,position)?"":projectionRankMovement(row,showMovement,position),
            meta:[row.Team,projectionPosition(row,position)||"—",row.Opponent].filter(Boolean).join(" · "),
            badge:blocked?null:<InjuryStatusTag status={status}/>, blocked,
            values:{opponent:isByeWeek(row)?BOARD_COPY.byeWeek:row.Opponent?`vs ${row.Opponent}`:null, floor:low, ceiling:high, points:row["Projected Points"]},
            sub:!blocked && low!=null && high!=null?`${projectionNumber(low)}–${projectionNumber(high)}`:null};
        }}
        onOpen={row => {
          const open=onOpenPlayer||playerCard?.openPlayerCard;
          if(!row.player_id||!open)return;
          const rank=rankMap.get(rowRankKey(row))??null;
          open({playerId:row.player_id,name:row.Player,team:row.Team,position,season,week,applyInjuryAdjustments,
            scope:"weekly",rank,peers:peerStats,preview:weeklyBoardPreview(row,peerStats,{rank,position})});
        }}/>
    </>
  );
}
