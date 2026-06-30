import React from "react";
import MobileBottomSheet from "./MobileBottomSheet";
import { ProjectionsFilterControls } from "./ProjectionsFilterBar";

export default function MobileFilterSheet({
  open,
  onClose,
  view,
  filterProps,
}) {
  const showProjectionsFilters = view === "projections";

  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      title="Filters"
      className="app-mobile-sheet-filters"
    >
      <div className="mobile-filter-sheet-body">
        {showProjectionsFilters && filterProps ? (
          <ProjectionsFilterControls layout="sheet" {...filterProps} />
        ) : (
          <p className="chart-note mobile-filter-empty">No filters for this section.</p>
        )}
      </div>
    </MobileBottomSheet>
  );
}
