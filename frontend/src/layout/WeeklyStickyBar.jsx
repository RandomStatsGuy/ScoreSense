import React from "react";
import { BOARD_COPY } from "../projectionsPresentation";
import { PROJECTION_POSITIONS } from "./ProjectionsFilterBar";
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
        <div className="header-segment weekly-sticky-pos" role="group" aria-label="Position">
          {PROJECTION_POSITIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`tab header-segment-tab ${position === item.id ? "active" : ""}`}
              onClick={() => onPositionChange?.(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
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
