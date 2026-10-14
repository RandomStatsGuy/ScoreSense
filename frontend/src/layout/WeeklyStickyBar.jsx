import React from "react";
import { BOARD_COPY } from "../projectionsPresentation";
import ProjectionPositionControl from "./ProjectionPositionControl";
import { MOBILE_CHROME_COPY } from "./mobileChromePresentation";

function FilterIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 6h16M7 12h10M10 18h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function WeeklyStickyBar({
  position,
  onPositionChange,
  onFilterOpen,
  resultLabel,
  filterActive = false,
  stale = false,
  staleLabel,
  onRefresh,
  refreshing = false,
}) {
  return (
    <div className="weekly-sticky-bar" role="region" aria-label="Weekly board controls">
      <div className="weekly-sticky-bar-row">
        <ProjectionPositionControl position={position} onChange={onPositionChange}
          className="header-segment weekly-sticky-pos" />
        <button
          type="button"
          className={`weekly-sticky-filter${filterActive ? " is-active" : ""}`}
          aria-label={MOBILE_CHROME_COPY.filters}
          onClick={onFilterOpen}
        >
          <FilterIcon />
          <span>{BOARD_COPY.filters}</span>
        </button>
      </div>
      <div className="weekly-sticky-bar-meta">
        <span className="weekly-sticky-count">{resultLabel}</span>
        <span className="weekly-sticky-range">{BOARD_COPY.floorCeiling}</span>
        {stale ? (
          <button
            type="button"
            className="weekly-sticky-stale"
            onClick={onRefresh}
            disabled={refreshing}
          >
            {staleLabel || BOARD_COPY.staleRefresh}
          </button>
        ) : null}
      </div>
    </div>
  );
}
