import React, { memo, useCallback, useMemo } from "react";
import PlayerCell from "../PlayerCell";
import SeasonRangeCell from "../SeasonRangeCell";
import { formatSeasonPts } from "../seasonQuantiles";
import { formatRiskScore, isRiskToleranceActive, riskScoreTooltip } from "../riskAdjustedValue";
import { fmtSal, formatStatusLabel } from "./valueSheetUtils";
import RaavBidCell from "./RaavBidCell";
import { riskBand, riskBandTooltip, suggestedBidCaption } from "./draftLiveConsole";

function ValueSheetPlayerRow({
  row,
  showAdvanced = true,
  showDelta,
  showStatus,
  showAdd,
  addMode = "add",
  showSelect,
  showRiskScore = false,
  riskTolerance = 0,
  rules = null,
  inRoster,
  isAdding,
  isSelected,
  isCommissioner = false,
  onSelectPlayer,
  onAddPlayer,
  onRowDoubleClick,
  playerMedia,
  narrativeScope,
  seasonScaleMax,
  rowIndex = 0,
  draftConsole = false,
  onQueuePlayer,
  onWatchPlayer,
  watchIds = [],
  canNominate = false,
  actionsDisabled = false,
  actionLabel,
  minBid = 1,
  pickDraft = false,
  showValueRange,
  showFairValue = true,
  showTier = true,
  showPosRank = false,
  showNeed = false,
  showP10 = false,
  showTeam = false,
  showPosCol = true,
  showPerGame = false,
  showSpread = false,
  showSalaryBounds = false,
  actionCol = true,
  needPositions = [],
}) {
  const handleRowClick = useCallback(() => {
    if (onSelectPlayer) onSelectPlayer(row);
  }, [onSelectPlayer, row]);

  const handleRowDoubleClick = useCallback(() => {
    if (!actionsDisabled) onRowDoubleClick?.(row);
  }, [actionsDisabled, onRowDoubleClick, row]);

  const handleSelectClick = useCallback(
    (e) => {
      e.stopPropagation();
      onSelectPlayer?.(row);
    },
    [onSelectPlayer, row],
  );

  const handleAddClick = useCallback(
    (e) => {
      e.stopPropagation();
      onAddPlayer?.(row);
    },
    [onAddPlayer, row],
  );

  const statusLabel = formatStatusLabel(row.status);
  const taken = row.status === "taken";
  const addLabel = isAdding
    ? (addMode === "bid" ? "Bidding…" : "Adding…")
    : addMode === "bid"
      ? "Bid"
      : (taken && isCommissioner ? "Reassign" : "Add");
  const spreadLabel = useMemo(
    () => (row.season_spread != null ? formatSeasonPts(row.season_spread, 0) : "—"),
    [row.season_spread],
  );
  const showRaavBadge = isRiskToleranceActive(riskTolerance)
    || (row.risk_adjusted_value != null && Number.isFinite(Number(row.risk_adjusted_value)));
  const isNeed = (needPositions || []).some(
    (p) => String(p || "").toUpperCase() === String(row.position || "").toUpperCase(),
  );

  return (
    <tr
      className={`${row.overpay ? "hub-overpay" : ""}${row.on_sleeper ? " hub-sleeper-row" : ""}${isSelected ? " hub-row-selected" : ""}`}
      onClick={onSelectPlayer ? handleRowClick : undefined}
      onDoubleClick={onRowDoubleClick ? handleRowDoubleClick : undefined}
      aria-disabled={actionsDisabled && onRowDoubleClick ? "true" : undefined}
    >
      <td className="col-player">
        <div className="hub-player-cell-row">
          {onWatchPlayer ? (
            <button
              type="button"
              className={`hub-star-btn${(watchIds || []).map(String).includes(String(row.player_id)) ? " is-starred" : ""}`}
              aria-label={(watchIds || []).map(String).includes(String(row.player_id)) ? "Remove star" : "Star for draft"}
              aria-pressed={(watchIds || []).map(String).includes(String(row.player_id))}
              title={(watchIds || []).map(String).includes(String(row.player_id)) ? "Starred" : "Star to take"}
              onClick={(event) => {
                event.stopPropagation();
                onWatchPlayer(row);
              }}
            >
              {(watchIds || []).map(String).includes(String(row.player_id)) ? "★" : "☆"}
            </button>
          ) : null}
          <PlayerCell
            name={row.player}
            team={row.team}
            playerId={row.player_id}
            media={playerMedia}
            size="sm"
            showTeam={Boolean(!draftConsole)}
            position={draftConsole ? row.position : undefined}
            clickable={Boolean(row.player_id)}
            narrativeScope={narrativeScope}
          />
        </div>
          {row.is_rookie && <span className="hub-sleeper-badge">Rookie est.</span>}
        </td>
      {showTeam && <td className="hub-col-team" title={row.team}>{row.team}</td>}
      {showPosCol && <td className="hub-col-pos">{row.position}</td>}
      <td className="num hub-col-proj">
        <SeasonRangeCell
          row={row}
          scaleMax={seasonScaleMax}
          rowIndex={rowIndex}
          digits={0}
        />
        {draftConsole && row.per_game_proj != null && (
          <div className="chart-note">{row.per_game_proj}/g</div>
        )}
      </td>
      {showPosRank && (
        <td className="num hub-col-posrank">{row.pos_rank != null ? `${row.position}${row.pos_rank}` : "—"}</td>
      )}
      {showNeed && (
        <td className="hub-col-need">
          {isNeed ? <span className="hub-need-chip">Need</span> : <span className="chart-note">—</span>}
        </td>
      )}
      {showP10 && (
        <>
          <td className="num hub-col-p10">{row.season_p10 != null ? formatSeasonPts(row.season_p10, 0) : "—"}</td>
          <td className="num hub-col-p50">{formatSeasonPts(row.season_p50 ?? row.season_proj, 0)}</td>
          <td className="num hub-col-p90">{row.season_p90 != null ? formatSeasonPts(row.season_p90, 0) : "—"}</td>
        </>
      )}
      {showPerGame && (
        <td className="num hub-col-pg">{row.per_game_proj}</td>
      )}
      {showSpread && (
        <td className="num hub-col-spread">{spreadLabel}</td>
      )}
      {showSalaryBounds && (
        <>
          <td className="num hub-col-min">{fmtSal(row.min_sal)}</td>
          <td className="num hub-col-max">{fmtSal(row.max_sal)}</td>
        </>
      )}
      {showValueRange && (
        <td className="num hub-col-value" title="Model auction range">
          {row.min_sal != null && row.max_sal != null
            ? `${fmtSal(row.min_sal)}–${fmtSal(row.max_sal)}`
            : "—"}
        </td>
      )}
      {showFairValue && (
      <td className="num hub-col-fv" title={draftConsole ? suggestedBidCaption(isRiskToleranceActive(riskTolerance)) : undefined}>
        <RaavBidCell
          row={row}
          riskTolerance={riskTolerance}
          rules={rules}
          showDeltaBadge={showRaavBadge}
        />
      </td>
      )}
      {showRiskScore && (
        <td className="num hub-col-risk" title={draftConsole ? riskBandTooltip(row.risk_score) : riskScoreTooltip()}>
          {draftConsole ? riskBand(row.risk_score).label : formatRiskScore(row.risk_score)}
        </td>
      )}
      {showDelta && (
        <td className="num hub-col-delta">
          {row.value_delta != null ? (
            <span className={row.value_delta <= 0 ? "hub-value-delta-pos" : "hub-value-delta-neg"}>
              {row.value_delta <= 0 ? "" : "+"}{fmtSal(row.value_delta)}
            </span>
          ) : "—"}
        </td>
      )}
      {showTier && <td className="hub-col-tier">{row.tier}</td>}
      {showStatus && (
        <td className="hub-col-status">
          <span className={`hub-status hub-status-${row.status}`} title={row.status}>{statusLabel}</span>
        </td>
      )}
      {actionCol && (
      <td className="hub-col-actions">
        {draftConsole && (
          <div className="hub-draft-row-actions" onClick={(event) => event.stopPropagation()}>
            {canNominate && (
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={actionsDisabled}
                onClick={() => onRowDoubleClick?.(row)}
              >
                {actionLabel || (pickDraft ? "Pick" : `Nominate for $${Number(minBid || 1)}`)}
              </button>
            )}
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={actionsDisabled}
              onClick={() => onQueuePlayer?.(row)}
            >
              Queue
            </button>
          </div>
        )}
        {showSelect && (
          <button type="button" className="btn-ghost btn-sm" onClick={handleSelectClick}>
            Select
          </button>
        )}
        {showAdd && !inRoster && !showSelect && (
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={actionsDisabled || isAdding}
            title={taken && !isCommissioner ? "Already on another roster" : undefined}
            onClick={handleAddClick}
          >
            {addLabel}
          </button>
        )}
      </td>
      )}
    </tr>
  );
}

function propsAreEqual(prev, next) {
  return (
    prev.row === next.row
    && prev.showAdvanced === next.showAdvanced
    && prev.showDelta === next.showDelta
    && prev.showStatus === next.showStatus
    && prev.showAdd === next.showAdd
    && prev.addMode === next.addMode
    && prev.showSelect === next.showSelect
    && prev.showRiskScore === next.showRiskScore
    && prev.riskTolerance === next.riskTolerance
    && prev.rules === next.rules
    && prev.inRoster === next.inRoster
    && prev.isAdding === next.isAdding
    && prev.isSelected === next.isSelected
    && prev.isCommissioner === next.isCommissioner
    && prev.onSelectPlayer === next.onSelectPlayer
    && prev.onAddPlayer === next.onAddPlayer
    && prev.onRowDoubleClick === next.onRowDoubleClick
    && prev.narrativeScope === next.narrativeScope
    && prev.seasonScaleMax === next.seasonScaleMax
    && prev.rowIndex === next.rowIndex
    && prev.pickDraft === next.pickDraft
    && prev.showValueRange === next.showValueRange
    && prev.showFairValue === next.showFairValue
    && prev.showTier === next.showTier
    && prev.showPosRank === next.showPosRank
    && prev.showNeed === next.showNeed
    && prev.showP10 === next.showP10
    && prev.showTeam === next.showTeam
    && prev.showPosCol === next.showPosCol
    && prev.showPerGame === next.showPerGame
    && prev.showSpread === next.showSpread
    && prev.showSalaryBounds === next.showSalaryBounds
    && prev.actionCol === next.actionCol
    && prev.actionLabel === next.actionLabel
    && prev.canNominate === next.canNominate
    && prev.actionsDisabled === next.actionsDisabled
    && prev.draftConsole === next.draftConsole
    && prev.onWatchPlayer === next.onWatchPlayer
    && prev.watchIds === next.watchIds
  );
}

export default memo(ValueSheetPlayerRow, propsAreEqual);
