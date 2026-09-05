import React from "react";
import MobileBottomSheet from "./MobileBottomSheet";
import { ProjectionsFilterControls } from "./ProjectionsFilterBar";
import { BOARD_COPY } from "../projectionsPresentation";

export default function MobileFilterSheet({
  open,
  onClose,
  view,
  filterProps,
  resultLabel,
  onReset,
  onApply,
}) {
  const showProjectionsFilters = view === "projections";

  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      title="Filters"
      className="app-mobile-sheet-filters"
    >
      <div className="mobile-filter-sheet">
        <div className="mobile-filter-sheet-body">
          {showProjectionsFilters && filterProps ? (
            <ProjectionsFilterControls layout="sheet" {...filterProps} />
          ) : (
            <p className="chart-note mobile-filter-empty">No filters for this section.</p>
          )}
        </div>
        {showProjectionsFilters ? (
          <div className="mobile-filter-sheet-footer">
            <div className="mobile-filter-sheet-status">
              <p className="mobile-filter-scoring-note chart-note" title="ScoreSense weekly model is trained on PPR scoring">
                {BOARD_COPY.scoringPpr}
              </p>
              {resultLabel ? (
                <p className="mobile-filter-result-count" role="status">{resultLabel}</p>
              ) : null}
            </div>
            <div className="mobile-filter-sheet-actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => onReset?.()}
              >
                {BOARD_COPY.resetFilters}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => (onApply ? onApply() : onClose?.())}
              >
                {BOARD_COPY.applyFilters}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </MobileBottomSheet>
  );
}
