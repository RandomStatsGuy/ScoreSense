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
  actionLabel,
  minBid = 1,
  pickDraft = false,
  showValueRange,
  showFairValue = true,
}) {
  const handleRowClick = useCallback(() => {
    if (onSelectPlayer) onSelectPlayer(row);
  }, [onSelectPlayer, row]);

  const handleRowDoubleClick = useCallback(() => {
    onRowDoubleClick?.(row);
  }, [onRowDoubleClick, row]);

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
  const addLabel = taken && isCommissioner ? "Reassign" : "Add";
  const spreadLabel = useMemo(
    () => (row.season_spread != null ? formatSeasonPts(row.season_spread, 0) : "—"),
    [row.season_spread],
  );
  const showRaavBadge = isRiskToleranceActive(riskTolerance)
    || (row.risk_adjusted_value != null && Number.isFinite(Number(row.risk_adjusted_value)));

  return (
    <tr
      className={`${row.overpay ? "hub-overpay" : ""}${row.on_sleeper ? " hub-sleeper-row" : ""}${isSelected ? " hub-row-selected" : ""}`}
      onClick={onSelectPlayer ? handleRowClick : undefined}
      onDoubleClick={onRowDoubleClick ? handleRowDoubleClick : undefined}
    >
      <td className="col-player">
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
        {row.is_rookie && <span className="hub-sleeper-badge">Rookie est.</span>}
      </td>
      {showAdvanced && <td className="hub-col-team">{row.team}</td>}
      {!draftConsole && <td className="hub-col-pos">{row.position}</td>}
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
      {showAdvanced && (
        <>
          <td className="num hub-col-pg">{row.per_game_proj}</td>
          <td className="num hub-col-spread">{spreadLabel}</td>
          {!pickDraft && (
            <>
              <td className="num hub-col-min">{fmtSal(row.min_sal)}</td>
              <td className="num hub-col-max">{fmtSal(row.max_sal)}</td>
            </>
          )}
        </>
      )}
      {(showValueRange ?? draftConsole) && !pickDraft && (
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
      <td className="hub-col-tier">{row.tier}</td>
      {showStatus && (
        <td className="hub-col-status">
          <span className={`hub-status hub-status-${row.status}`} title={row.status}>{statusLabel}</span>
        </td>
      )}
      <td className="hub-col-actions">
        {draftConsole && (
          <div className="hub-draft-row-actions" onClick={(event) => event.stopPropagation()}>
            {canNominate && (
              <button type="button" className="btn-primary btn-sm" onClick={() => onRowDoubleClick?.(row)}>
                {actionLabel || `Nominate for $${Number(minBid || 1)}`}
              </button>
            )}
            <button type="button" className="btn-ghost btn-sm" onClick={() => onQueuePlayer?.(row)}>Queue</button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              aria-pressed={(watchIds || []).map(String).includes(String(row.player_id))}
              onClick={() => onWatchPlayer?.(row)}
            >
              {(watchIds || []).map(String).includes(String(row.player_id)) ? "★" : "☆"}
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
            disabled={isAdding}
            title={taken && !isCommissioner ? "Already on another roster" : undefined}
            onClick={handleAddClick}
          >
            {isAdding ? "Adding…" : addLabel}
          </button>
        )}
      </td>
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
    && prev.actionLabel === next.actionLabel
    && prev.canNominate === next.canNominate
    && prev.draftConsole === next.draftConsole
  );
}

export default memo(ValueSheetPlayerRow, propsAreEqual);
