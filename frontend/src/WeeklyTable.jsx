import React, { useEffect, useMemo, useState } from "react";
import Chip, { injuryChipTone } from "./Chip";
import { fmtNum, isPlayerUnavailable, unavailableLabel } from "./format";
import {
  SortHeader,
  ExportCsvButton,
  TableEmptyState,
  useTableSort,
  useRankMap,
  rowRankKey,
  csvQuote,
  downloadCsv,
} from "./table";
import QuantileBar from "./QuantileBarShared";
import SentimentBadge from "./SentimentBadge";
import ProjectionExplanationPanel from "./ProjectionExplanationPanel";
import PlayerContextBadges from "./PlayerContextBadges";
import PlayerContextPanel from "./PlayerContextPanel";
import { isDetailAvailable } from "./playerContextDisplay";
import { TableSkeleton } from "./TableSkeleton";
import useMobileLayout from "./useMobileLayout";
import usePlayersContext from "./usePlayersContext";
import MobileDataList, { MobileStat } from "./MobileDataList";
import MobilePlayerCard from "./MobilePlayerCard";
import PlayerCell, { usePlayerMedia } from "./PlayerCell";
import { usePlayerCardOptional } from "./PlayerCardContext";
import {
  MOVEMENT_FILTERS,
  formatP50Move,
  formatRankMove,
  hasMovement,
  isLeftSlate,
  matchesMovementFilter,
  mergeRowsForMovementFilter,
  movementEmptyMessage,
  movementSortScore,
  rowMovementTone,
} from "./projectionMovement";
import {
  formatOpportunityAdjustmentPct,
  opportunityAdjustmentClass,
  pickOpportunityAdjustment,
  slateHasOpportunityAdjustment,
} from "./opportunityAdjustment";
import {
  positionShort,
  weeklyBoardPreview,
  weeklyPeerStats,
  weeklyWhyNow,
} from "./projectionsPresentation";

const SORT_KEYS = {
  Player: "Player",
  Team: "Team",
  Opponent: "Opponent",
  Narrative: "Narrative",
  P50: "Projected Points",
  P10: "Low (P10)",
  P90: "High (P90)",
  Opportunity: "_opportunity_adjustment",
  RankDelta: "rank_delta",
  P50Delta: "p50_delta",
  Move: "_movement_score",
};

function RankMoveInline({ row, position }) {
  const leftSlate = isLeftSlate(row);
  const rankLabel = formatRankMove({
    previousRank: row.previous_rank,
    currentRank: row.current_rank,
    rankDelta: row.rank_delta,
    position: row.Position || position,
    slateStatus: row.slate_status,
  });
  if (!rankLabel) return null;
  const tone = leftSlate ? "down" : movementToneFromDelta(row.rank_delta);
  return (
    <span
      className={`proj-move proj-move--${tone}${row.movement_material || leftSlate ? " proj-move--material" : ""}`}
      title={leftSlate ? `Left slate · ${rankLabel}` : `Rank ${rankLabel} vs prior refresh`}
    >
      <span className="proj-move-rank">{rankLabel}</span>
    </span>
  );
}

function P50MoveInline({ row }) {
  const p50Label = formatP50Move(row.p50_delta);
  if (!p50Label) return null;
  const tone = movementToneFromDelta(row.p50_delta);
  return (
    <span
      className={`proj-move-p50-inline proj-move--${tone}`}
      title={`Projection ${p50Label} vs prior refresh`}
    >
      {p50Label}
    </span>
  );
}

function MovementInline({ row, position, compact = false }) {
  if (!hasMovement(row)) return null;
  const leftSlate = isLeftSlate(row);
  const tone = rowMovementTone(row);
  const rankLabel = formatRankMove({
    previousRank: row.previous_rank,
    currentRank: row.current_rank,
    rankDelta: row.rank_delta,
    position: row.Position || position,
    slateStatus: row.slate_status,
  });
  const p50Label = leftSlate ? null : formatP50Move(row.p50_delta);
  if (!rankLabel && !p50Label && !leftSlate) return null;
  const title = [
    leftSlate ? "Left slate" : null,
    rankLabel ? `Rank ${rankLabel}` : null,
    p50Label ? `Projection ${p50Label} vs prior refresh` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      className={`proj-move proj-move--${tone}${compact ? " proj-move--compact" : ""}${
        row.movement_material || leftSlate ? " proj-move--material" : ""
      }`}
      title={title}
    >
      {leftSlate ? <span className="proj-move-left">Left slate</span> : null}
      {rankLabel ? <span className="proj-move-rank">{rankLabel}</span> : null}
      {p50Label ? (
        <span className="proj-move-p50">
          {compact ? p50Label : `Proj ${p50Label}`}
        </span>
      ) : null}
    </span>
  );
}

function movementToneFromDelta(delta) {
  const n = Number(delta);
  if (!Number.isFinite(n) || n === 0) return "neutral";
  return n > 0 ? "up" : "down";
}

/** DvP tone from "Opp Def Rank" (1 = toughest defense). Bottom third = favorable. */
function matchupTone(rank, teamCount) {
  const r = Number(rank);
  if (!Number.isFinite(r) || !teamCount) return null;
  if (r <= Math.floor(teamCount / 3)) return "bad";
  if (r > Math.ceil((teamCount * 2) / 3)) return "good";
  return null;
}

function matchupTitle(rank, teamCount, position) {
  const r = Number(rank);
  if (!Number.isFinite(r) || !teamCount) return undefined;
  const vs = position === "rb" ? "the run" : "the pass";
  const tone = matchupTone(r, teamCount);
  const label =
    tone === "good" ? "favorable matchup" : tone === "bad" ? "tough matchup" : "average matchup";
  return `Opponent defense ranks ${r} of ${teamCount} vs ${vs} (1 = toughest) — ${label}`;
}

/** Abbreviated injury designation shown inline next to the player name. */
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

function WhyToggleButton({ playerName, expanded, onToggle }) {
  return (
    <button
      type="button"
      className={`btn-ghost btn-sm why-toggle${expanded ? " why-toggle--open" : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle?.();
      }}
      aria-expanded={expanded}
      aria-label={`Why this projection for ${playerName || "player"}`}
      title="Why this projection?"
    >
      Why?
    </button>
  );
}

const WeeklyTableRow = React.memo(function WeeklyTableRow({
  row,
  rowIndex,
  rank,
  showOpponent,
  showBoost,
  unavailableColSpan,
  scaleMax,
  playerMedia,
  position,
  season,
  week,
  dvpTeamCount,
  compareEnabled,
  selected,
  selectDisabled,
  onToggleSelect,
  whyNow,
  applyInjuryAdjustments,
  playerContext,
  contextSlateMeta = null,
  showMovement = false,
  peerStats = {},
  onOpenPlayer,
}) {
  const status = row["Injury Status"] || "";
  const leftSlate = isLeftSlate(row);
  const unavailable = !leftSlate && isPlayerUnavailable(status);
  const p50 = Number(row["Projected Points"]) || 0;
  const p10 = Number(row["Low (P10)"]) || 0;
  const p90 = Number(row["High (P90)"]) || 0;
  const tag = unavailableLabel(status);
  const tone = matchupTone(row["Opp Def Rank"], dvpTeamCount);
  const canSelect = compareEnabled && Boolean(row.player_id) && !unavailable && !leftSlate;

  const openPlayer = () => {
    if (!row.player_id || !onOpenPlayer) return;
    onOpenPlayer({
      playerId: row.player_id,
      name: row.Player,
      team: row.Team,
      position,
      season,
      week,
      applyInjuryAdjustments,
      scope: "weekly",
      rank,
      peers: peerStats,
      preview: weeklyBoardPreview(row, peerStats, { rank, position, whyNow }),
    });
  };

  return (
    <>
    <tr
      className={[
        "proj-board-row",
        unavailable ? "row-unavailable" : "",
        leftSlate ? "row-left-slate" : "",
        selected ? "row-compare-selected is-selected" : "",
      ]
        .filter(Boolean)
        .join(" ") || undefined}
      onClick={openPlayer}
    >
      {compareEnabled ? (
        <td className="col-compare-select" onClick={(event) => event.stopPropagation()}>
          <label className="compare-select-label">
            <input
              type="checkbox"
              checked={selected}
              disabled={!canSelect || (selectDisabled && !selected)}
              onChange={() => onToggleSelect?.(row)}
              aria-label={`Select ${row.Player || "player"} for compare`}
            />
          </label>
        </td>
      ) : null}
      <td className={`num col-rank${rank != null && rank <= 3 ? " col-rank-top" : ""}`}>
        <span className="col-rank-stack">
          <span className="col-rank-value">{rank ?? "—"}</span>
          {showMovement ? <RankMoveInline row={row} position={position} /> : null}
        </span>
      </td>
      <td className="col-player">
        <span className="col-player-inner">
          <PlayerCell
            name={row.Player}
            team={row.Team}
            playerId={row.player_id}
            media={playerMedia}
            size="sm"
            showTeam={false}
            clickable={Boolean(row.player_id && onOpenPlayer)}
            position={positionShort(position)}
            season={season}
            week={week}
            applyInjuryAdjustments={applyInjuryAdjustments}
            onPlayerClick={openPlayer}
          />
          <InjuryStatusTag status={unavailable ? "" : status} />
          {leftSlate ? (
            <Chip tone="caution" className="proj-left-slate-chip" title="Removed from this week's projection slate">
              Left slate
            </Chip>
          ) : null}
        </span>
        {playerContext ? (
          <PlayerContextBadges
            context={playerContext}
            slateMeta={contextSlateMeta}
            className="player-context-badges--table"
          />
        ) : null}
        <span className="col-player-mobile-meta">
          {[row.Team, positionShort(position)].filter(Boolean).join(" · ") || "—"}
          {showOpponent && row.Opponent ? ` · ${row.Opponent}` : ""}
        </span>
      </td>
      {showOpponent && (
        <td
          className={`col-opp${row.Opponent === "BYE" ? " muted" : ""}${tone ? ` matchup-${tone}` : ""}`}
          title={matchupTitle(row["Opp Def Rank"], dvpTeamCount, position)}
        >
          {row.Opponent || "—"}
          {tone ? (
            <span className={`matchup-indicator matchup-indicator-${tone}`} aria-hidden="true">
              {tone === "good" ? "▲" : "▼"}
            </span>
          ) : null}
          {tone ? (
            <span className="sr-only">
              {tone === "good" ? "favorable matchup" : "tough matchup"}
            </span>
          ) : null}
        </td>
      )}
      <td className="proj-why-now">{whyNow || "—"}</td>
      {unavailable || leftSlate ? (
        <td colSpan={unavailableColSpan} className="out-tag-cell">
          {leftSlate ? (
            <>
              <span className="out-tag">Left slate</span>
              <span className="out-tag-note">No longer on this week&apos;s projections</span>
            </>
          ) : (
            <>
              <span className="out-tag">{tag}</span>
              <span className="out-tag-note">Projections suppressed — Sleeper {status}</span>
            </>
          )}
        </td>
      ) : (
        <>
          <td className="num num-quantile">{fmtNum(row["Low (P10)"], 1)}</td>
          <td className="num num-proj num-p50">
            <span className="col-proj-stack">
              <span className="col-proj-value">{fmtNum(row["Projected Points"], 1)}</span>
              {showMovement ? <P50MoveInline row={row} /> : null}
            </span>
          </td>
          <td className="num num-quantile">{fmtNum(row["High (P90)"], 1)}</td>
          <td className="range-cell">
            <QuantileBar
              p10={p10}
              p50={p50}
              p90={p90}
              scaleMax={scaleMax}
              rowIndex={rowIndex}
              showVolatility
            />
          </td>
          {showBoost && (
            <td className={`num ${opportunityAdjustmentClass(pickOpportunityAdjustment(row))}`}>
              {formatOpportunityAdjustmentPct(row) || "—"}
            </td>
          )}
        </>
      )}
    </tr>
    </>
  );
});

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
      const unavailable = isPlayerUnavailable(status);
      const boost = pickOpportunityAdjustment(row);
      return [
        csvQuote(row.Player),
        row.Team || "",
        unavailable ? "OUT" : fmtNum(row["Projected Points"], 2, ""),
        unavailable ? "OUT" : fmtNum(row["Low (P10)"], 2, ""),
        unavailable ? "OUT" : fmtNum(row["High (P90)"], 2, ""),
        Number.isFinite(Number(row.p50_delta)) ? Number(row.p50_delta).toFixed(2) : "",
        Number.isFinite(Number(row.rank_delta)) ? String(row.rank_delta) : "",
        Number.isFinite(Number(row.previous_rank)) ? String(row.previous_rank) : "",
        !unavailable && boost != null && boost !== 0 ? (boost * 100).toFixed(1) : "",
        unavailable ? unavailableLabel(status) : status,
      ].join(",");
    }),
  ];
  downloadCsv("scoresense-projections", lines);
}

// Number(null) === 0; coerce missing projections to NaN so they stay unranked.
const rankMetric = (row) =>
  isPlayerUnavailable(row["Injury Status"]) ? NaN : Number(row["Projected Points"] ?? NaN);

export default function WeeklyTable({
  rows,
  search,
  teamsFilter,
  searchSlot,
  metaLine,
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
  onOpenPlayer,
}) {
  const [sort, toggleSort] = useTableSort({ column: "P50", dir: "desc" });
  const [whyPlayerId, setWhyPlayerId] = useState(null);
  const [contextPlayerId, setContextPlayerId] = useState(null);
  const mobileLayout = useMobileLayout();
  const playerCard = usePlayerCardOptional();
  const playersContext = usePlayersContext(season, week, {
    enabled: season != null && week != null,
    mediaMode,
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

  const toggleWhy = (playerId) => {
    const id = playerId ? String(playerId) : "";
    if (!id) return;
    setWhyPlayerId((prev) => (prev === id ? null : id));
  };

  const toggleContext = (playerId) => {
    const id = playerId ? String(playerId) : "";
    if (!id) return;
    setContextPlayerId((prev) => (prev === id ? null : id));
  };

  useEffect(() => {
    setWhyPlayerId(null);
    setContextPlayerId(null);
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

  const hasSentiment = useMemo(
    () => showSentiment && (rows || []).some((row) => row.sentiment?.mention_count > 0),
    [rows, showSentiment]
  );

  const showBoost = useMemo(() => slateHasOpportunityAdjustment(rows), [rows]);
  const peerStats = useMemo(() => weeklyPeerStats(rows, { position }), [rows, position]);

  // Compare, Rank, Player, Opp?, Why now, P10, P50, P90, Range, Opp adj?
  const emptyColSpan =
    7 +
    (compareEnabled ? 1 : 0) +
    (showOpponent ? 1 : 0) +
    (showBoost ? 1 : 0);
  const unavailableColSpan = 4 + (showBoost ? 1 : 0);

  const filtered = useMemo(() => {
    let list = rows || [];
    const q = (search || "").trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          String(r.Player || "").toLowerCase().includes(q) ||
          String(r.Team || "").toLowerCase().includes(q),
      );
    }
    if (teamsFilter?.length) {
      const set = new Set(teamsFilter.map((t) => t.toUpperCase()));
      list = list.filter((r) => set.has(String(r.Team || "").toUpperCase()));
    }
    if (showFilters && movementFilter && movementFilter !== "all") {
      list = list.filter((r) => matchesMovementFilter(r, movementFilter));
      list = mergeRowsForMovementFilter(list, leftSlateRows, movementFilter);
      if (q) {
        list = list.filter(
          (r) =>
            String(r.Player || "").toLowerCase().includes(q) ||
            String(r.Team || "").toLowerCase().includes(q),
        );
      }
      if (teamsFilter?.length) {
        const set = new Set(teamsFilter.map((t) => t.toUpperCase()));
        list = list.filter((r) => set.has(String(r.Team || "").toUpperCase()));
      }
    }
    return list;
  }, [rows, search, teamsFilter, showFilters, movementFilter, leftSlateRows]);

  const scaleMax = useMemo(() => {
    const slate = rows || [];
    if (!slate.length) return 1;
    const maxP90 = Math.max(...slate.map((r) => Number(r["High (P90)"]) || 0));
    return maxP90 > 0 ? maxP90 : 1;
  }, [rows]);

  // Number of ranked defenses in the slate (max observed rank) for DvP bucketing.
  const dvpTeamCount = useMemo(() => {
    let max = 0;
    for (const r of rows || []) {
      const rank = Number(r["Opp Def Rank"]);
      if (Number.isFinite(rank) && rank > max) max = rank;
    }
    return max;
  }, [rows]);

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
  const rankMap = useRankMap(rows, rankMetric);

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

  const resultLabel =
    selectedCount > 0
      ? `${sorted.length} result${sorted.length === 1 ? "" : "s"} · ${selectedCount} selected`
      : `${sorted.length} player${sorted.length === 1 ? "" : "s"}`;

  return (
    <>
      <div className="table-controls">
        {searchSlot}
        {!mobileLayout && (
          <ExportCsvButton onExport={() => exportCsv(sorted)} disabled={!sorted.length} />
        )}
      </div>
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
      <div className="table-toolbar">
        <span className="table-meta">{resultLabel}</span>
        {metaLine}
        {showFilters ? (
          <span className="table-meta table-meta-movement" role="status">
            {showMovement
              ? "What changed vs prior refresh"
              : movementEmptyMessage(movementEmptyReason, movementNote) ||
                "Movement unavailable for this slate"}
          </span>
        ) : null}
        {playersContext.unavailable ? (
          <span className="table-meta table-meta-context-cold" role="status">
            Injury context still loading
          </span>
        ) : null}
        {playersContext.meta?.stale ? (
          <span className="table-meta table-meta-context-stale" role="status">
            Context snapshot stale
          </span>
        ) : null}
        {!mobileLayout ? (
          <span className="table-meta range-scale-legend range-scale-legend--toolbar" aria-hidden="true">
            <span>Floor</span>
            <span>Projection</span>
            <span>Ceiling</span>
          </span>
        ) : null}
        {compareEnabled ? (
          <span className="table-meta table-meta-compare-hint">
            Compare 2–{maxCompare} players
          </span>
        ) : null}
      </div>
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
                  : ` · up to ${maxCompare}`}
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
              className="btn primary btn-sm"
              disabled={selectedCount < 2}
              onClick={onOpenCompare}
            >
              Compare
            </button>
          </div>
        </div>
      ) : null}
      {mobileLayout ? (
        <MobileDataList
          loading={loading && sorted.length === 0}
          emptyMessage={!loading && sorted.length === 0 ? emptyMessage : null}
          onEmptyAction={hasFilters && sorted.length === 0 ? onClearFilters : undefined}
        >
          {sorted.map((row, rowIndex) => {
            const status = row["Injury Status"] || "";
            const leftSlate = isLeftSlate(row);
            const unavailable = !leftSlate && isPlayerUnavailable(status);
            const p50 = Number(row["Projected Points"]) || 0;
            const p10 = Number(row["Low (P10)"]) || 0;
            const p90 = Number(row["High (P90)"]) || 0;
            const tag = unavailableLabel(status);
            const tone = matchupTone(row["Opp Def Rank"], dvpTeamCount);
            const pid = row.player_id ? String(row.player_id) : "";
            const selected = pid ? selectedSet.has(pid) : false;
            const canSelect = compareEnabled && Boolean(pid) && !unavailable && !leftSlate;
            const playerCtx = pid ? playersContext.byId.get(pid) : null;
            const canContext = Boolean(pid) && !leftSlate && isDetailAvailable(playerCtx);
            const metaNode = (
              <>
                {row.Team || "—"}
                {showOpponent && row.Opponent ? (
                  <>
                    {" · "}
                    <span className={tone ? `matchup-${tone}` : undefined}>
                      {row.Opponent}
                      {tone ? (
                        <span
                          className={`matchup-indicator matchup-indicator-${tone}`}
                          aria-hidden="true"
                        >
                          {tone === "good" ? "▲" : "▼"}
                        </span>
                      ) : null}
                      {tone ? (
                        <span className="sr-only">
                          {tone === "good" ? "favorable matchup" : "tough matchup"}
                        </span>
                      ) : null}
                    </span>
                  </>
                ) : null}
              </>
            );

            return (
              <MobilePlayerCard
                key={rowRankKey(row)}
                name={row.Player}
                rank={rankMap.get(rowRankKey(row)) ?? null}
                selected={selected}
                titleNode={(
                  <PlayerCell
                    name={row.Player}
                    team={row.Team}
                    playerId={row.player_id}
                    media={playerMedia}
                    size="sm"
                    showTeam={false}
                    clickable={false}
                  />
                )}
                badge={
                  leftSlate ? (
                    <Chip tone="caution" className="proj-left-slate-chip" title="Removed from this week's projection slate">
                      Left slate
                    </Chip>
                  ) : unavailable ? null : (
                    <InjuryStatusTag status={status} verbose />
                  )
                }
                meta={metaNode}
                heroValue={leftSlate ? "—" : unavailable ? tag : fmtNum(row["Projected Points"], 1)}
                heroLabel={leftSlate || unavailable ? "" : "Proj"}
                heroSub={leftSlate ? (
                  showMovement || showFilters ? (
                    <span className="mobile-player-card-move">
                      <MovementInline row={row} position={position} compact />
                    </span>
                  ) : (
                    <span className="muted">Left this week&apos;s slate</span>
                  )
                ) : unavailable ? null : (
                  <>
                    <span className="sr-only">Floor to ceiling </span>
                    {fmtNum(p10, 1)}–{fmtNum(p90, 1)}
                    <span className="mobile-player-card-floor-ceil-label" aria-hidden="true">Floor–Ceiling</span>
                    {showMovement && hasMovement(row) ? (
                      <span className="mobile-player-card-move">
                        <MovementInline row={row} position={position} compact />
                      </span>
                    ) : null}
                  </>
                )}
                heroMuted={unavailable || leftSlate}
                unavailable={unavailable || leftSlate}
                aside={
                  compareEnabled ? (
                    <label className={`compare-select-label compare-select-label--card${selected ? " is-selected" : ""}`}>
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={!canSelect || (selectDisabled && !selected)}
                        onChange={() => onToggleCompare?.(row)}
                        aria-label={`Select ${row.Player || "player"} for compare`}
                      />
                      <span>{selected ? "Selected" : "Compare"}</span>
                    </label>
                  ) : null
                }
                actions={
                  pid ? (
                    <div className="mobile-player-card-action-row">
                      {playerCard ? (
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => {
                            const rank = rankMap.get(rowRankKey(row)) ?? null;
                            playerCard.openPlayerCard({
                              playerId: pid,
                              name: row.Player,
                              team: row.Team,
                              position,
                              season,
                              week,
                              applyInjuryAdjustments,
                              scope: "weekly",
                              rank,
                              peers: peerStats,
                              preview: weeklyBoardPreview(row, peerStats, {
                                rank,
                                position,
                              }),
                            });
                          }}
                        >
                          Details
                        </button>
                      ) : null}
                      <WhyToggleButton
                        playerName={row.Player}
                        expanded={whyPlayerId === pid}
                        onToggle={() => toggleWhy(pid)}
                      />
                      {canContext ? (
                        <button
                          type="button"
                          className={`btn-ghost btn-sm ctx-toggle${contextPlayerId === pid ? " ctx-toggle--open" : ""}`}
                          onClick={() => toggleContext(pid)}
                          aria-expanded={contextPlayerId === pid}
                          aria-label={`Cached week context for ${row.Player || "player"}`}
                          title="Cached week context"
                        >
                          Ctx
                        </button>
                      ) : null}
                    </div>
                  ) : null
                }
                expanded={(
                  <>
                    {unavailable ? (
                      <p className="chart-note out-tag-note">Projections suppressed — Sleeper {status}</p>
                    ) : (
                      <>
                        <div className="range-cell">
                          <QuantileBar
                            p10={p10}
                            p50={p50}
                            p90={p90}
                            scaleMax={scaleMax}
                            rowIndex={rowIndex}
                            showVolatility
                          />
                        </div>
                        <div className="mobile-stat-grid">
                          <MobileStat label="Floor" value={fmtNum(row["Low (P10)"], 1)} />
                          <MobileStat label="Ceiling" value={fmtNum(row["High (P90)"], 1)} />
                          {showBoost && formatOpportunityAdjustmentPct(row) ? (
                            <MobileStat
                              label="Opportunity adjustment"
                              value={formatOpportunityAdjustmentPct(row)}
                            />
                          ) : null}
                        </div>
                      </>
                    )}
                    {pid ? (
                      <PlayerContextBadges
                        context={playerCtx}
                        slateMeta={playersContext.meta}
                        className="player-context-badges--mobile"
                      />
                    ) : null}
                    {hasSentiment ? (
                      <div className="mobile-player-card-sentiment">
                        <SentimentBadge sentiment={row.sentiment} compact />
                      </div>
                    ) : null}
                    {pid && whyPlayerId === pid ? (
                      <ProjectionExplanationPanel
                        playerId={pid}
                        season={season}
                        week={week}
                        position={position}
                        applyInjuryAdjustments={applyInjuryAdjustments}
                        active
                        className="projection-explanation--mobile"
                      />
                    ) : null}
                    {canContext && contextPlayerId === pid ? (
                      <PlayerContextPanel
                        playerId={pid}
                        season={season}
                        week={week}
                        active
                        mediaMode={mediaMode}
                        onMediaModeChange={onMediaModeChange}
                        className="player-context-panel--mobile"
                      />
                    ) : null}
                  </>
                )}
              />
            );
          })}
        </MobileDataList>
      ) : (
      <div className={`table-wrap table-sticky table-has-rank${compareEnabled ? " table-has-compare" : ""}${showFilters ? " table-has-movement" : ""}`}>
        <table>
          <thead>
            <tr>
              {compareEnabled ? (
                <th className="col-compare-select" title="Select players to compare (2–4)">
                  <span className="sr-only">Compare</span>
                </th>
              ) : null}
              <th
                className="num col-rank"
                title={
                  showMovement
                    ? "Position rank by projected points. Movement shows prior → current (▲ rose)."
                    : "Position rank by projected points"
                }
              >
                #
              </th>
              <SortHeader label="Player" sortKey="Player" sort={sort} onSort={toggleSort} className="col-player" />
              {showOpponent && (
                <SortHeader
                  label="Opp"
                  sortKey="Opponent"
                  sort={sort}
                  onSort={toggleSort}
                  tip="Scheduled opponent this week (BYE if no game)"
                  className="col-opp"
                />
              )}
              <th className="proj-why-now" title="Short range and role read for this week">
                Why now
              </th>
              <SortHeader
                label="P10"
                sortKey="P10"
                sort={sort}
                onSort={toggleSort}
                tip="Floor — 10th percentile outcome"
                className="col-floor-ceiling"
              />
              <SortHeader
                label="P50"
                sortKey="P50"
                sort={sort}
                onSort={toggleSort}
                tip="Expected fantasy points this week (median projection)"
                className="col-proj"
              />
              <SortHeader
                label="P90"
                sortKey="P90"
                sort={sort}
                onSort={toggleSort}
                tip="Ceiling — 90th percentile outcome"
                className="col-floor-ceiling"
              />
              <th
                className="col-range"
                title="Floor / Projection / Ceiling (P10 · P50 · P90). White tick = projected score."
              >
                Range
              </th>
              {showBoost && (
                <SortHeader
                  label="Opp adj"
                  sortKey="Opportunity"
                  sort={sort}
                  onSort={toggleSort}
                  tip="Opportunity adjustment when teammates are unavailable. +15% means the projection was raised 15%."
                />
              )}
            </tr>
          </thead>
          <tbody>
            {loading && sorted.length === 0 ? (
              <TableSkeleton rows={14} cols={emptyColSpan} />
            ) : (
              <>
            {sorted.length === 0 && emptyMessage && (
              <TableEmptyState
                colSpan={emptyColSpan}
                message={emptyMessage}
                actionLabel="Clear filters"
                onAction={hasFilters ? onClearFilters : undefined}
              />
            )}
            {sorted.map((row, rowIndex) => {
              const pid = row.player_id ? String(row.player_id) : "";
              return (
              <WeeklyTableRow
                key={rowRankKey(row)}
                row={row}
                rowIndex={rowIndex}
                rank={rankMap.get(rowRankKey(row)) ?? null}
                showOpponent={showOpponent}
                showBoost={showBoost}
                unavailableColSpan={unavailableColSpan}
                scaleMax={scaleMax}
                playerMedia={playerMedia}
                position={position}
                season={season}
                week={week}
                dvpTeamCount={dvpTeamCount}
                compareEnabled={compareEnabled}
                selected={pid ? selectedSet.has(pid) : false}
                selectDisabled={selectDisabled}
                onToggleSelect={onToggleCompare}
                whyNow={weeklyWhyNow(row, peerStats, {
                  rank: rankMap.get(rowRankKey(row)) ?? null,
                  position,
                })}
                applyInjuryAdjustments={applyInjuryAdjustments}
                playerContext={pid ? playersContext.byId.get(pid) : null}
                contextSlateMeta={playersContext.meta}
                showMovement={showMovement}
                peerStats={peerStats}
                onOpenPlayer={onOpenPlayer || (playerCard ? playerCard.openPlayerCard : undefined)}
              />
              );
            })}
              </>
            )}
          </tbody>
        </table>
      </div>
      )}
    </>
  );
}
