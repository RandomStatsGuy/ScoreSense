import React from "react";
import QuantileBar from "./QuantileBarShared";
import {
  formatSeasonPts,
  resolveSeasonBand,
  seasonRangeTooltip,
} from "./seasonQuantiles";

/**
 * Compact P50 + floor–ceiling affordance for Draft Hub / draft tables.
 */
export default function SeasonRangeCell({
  row,
  method,
  gamesPerSeason,
  scaleMax,
  rowIndex = 0,
  digits = 0,
  showBar = true,
  className = "",
}) {
  const band = resolveSeasonBand(row, { method, gamesPerSeason });
  const tip = seasonRangeTooltip(band.method, { preliminary: band.preliminary });
  const hasRange = band.p10 != null && band.p90 != null && band.p50 != null;

  return (
    <div
      className={`season-range-cell${band.preliminary ? " season-range-cell--preliminary" : ""}${className ? ` ${className}` : ""}`}
      title={tip}
    >
      <div className="season-range-cell-main">
        <span className="season-range-cell-p50 num-proj">
          {formatSeasonPts(band.p50, digits)}
        </span>
        {band.preliminary && (
          <span className="hub-sleeper-badge season-range-prelim-badge" title={tip}>
            Preliminary
          </span>
        )}
      </div>
      {hasRange && showBar ? (
        <div className="season-range-cell-bar">
          <QuantileBar
            p10={band.p10}
            p50={band.p50}
            p90={band.p90}
            scaleMax={scaleMax || band.p90}
            rowIndex={rowIndex}
            title={tip}
            subtitle={`${formatSeasonPts(band.p10, digits)} – ${formatSeasonPts(band.p90, digits)} pts`}
          />
        </div>
      ) : hasRange ? (
        <span className="season-range-cell-span table-meta">
          {formatSeasonPts(band.p10, digits)}–{formatSeasonPts(band.p90, digits)}
        </span>
      ) : null}
    </div>
  );
}
