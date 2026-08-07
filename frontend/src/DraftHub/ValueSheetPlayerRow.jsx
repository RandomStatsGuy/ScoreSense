import React, { memo, useCallback } from "react";
import PlayerCell from "../PlayerCell";
import { fmtSal, formatStatusLabel } from "./valueSheetUtils";

function ValueSheetPlayerRow({
  row,
  showAdvanced = true,
  showDelta,
  showStatus,
  showAdd,
  showSelect,
  inRoster,
  isAdding,
  isSelected,
  onSelectPlayer,
  onAddPlayer,
  onRowDoubleClick,
  playerMedia,
  narrativeScope,
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
          showTeam={false}
          clickable={Boolean(row.player_id)}
          narrativeScope={narrativeScope}
        />
        {row.is_rookie && <span className="hub-sleeper-badge">Rookie est.</span>}
      </td>
      {showAdvanced && <td className="hub-col-team">{row.team}</td>}
      <td className="hub-col-pos">{row.position}</td>
      {showAdvanced && (
        <>
          <td className="num hub-col-proj">{row.season_proj}</td>
          <td className="num hub-col-pg">{row.per_game_proj}</td>
          <td className="num hub-col-min">{fmtSal(row.min_sal)}</td>
          <td className="num hub-col-max">{fmtSal(row.max_sal)}</td>
        </>
      )}
      <td className="num hub-col-fv">{fmtSal(row.fair_value ?? row.model_bid_hint)}</td>
      {showDelta && (
        <td className="num hub-col-delta">
          {row.value_delta != null ? (
            <span className={row.value_delta <= 0 ? "hub-value-delta-pos" : "hub-value-delta-neg"}>
              {row.value_delta <= 0 ? "" : "+"}{fmtSal(row.value_delta)}
            </span>
          ) : "—"}
        </td>
      )}
      <td>{row.tier}</td>
      {showStatus && (
        <td className="hub-col-status">
          <span className={`hub-status hub-status-${row.status}`} title={row.status}>{statusLabel}</span>
        </td>
      )}
      <td>
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
            onClick={handleAddClick}
          >
            Add
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
    && prev.inRoster === next.inRoster
    && prev.isAdding === next.isAdding
    && prev.isSelected === next.isSelected
    && prev.onSelectPlayer === next.onSelectPlayer
    && prev.onAddPlayer === next.onAddPlayer
    && prev.onRowDoubleClick === next.onRowDoubleClick
    && prev.narrativeScope === next.narrativeScope
  );
}

export default memo(ValueSheetPlayerRow, propsAreEqual);
