import React from "react";
import HoverTip from "../HoverTip";

/** Sortable table header with optional hover tooltip. Shared by Weekly/Season/Draft tables. */
export function SortHeader({ label, sortKey, sort, onSort, tip, className = "" }) {
  const active = sort.column === sortKey;
  const arrow = !active ? "↕" : sort.dir === "asc" ? "↑" : "↓";
  return (
    <HoverTip
      as="th"
      content={tip}
      className={`sortable-header col-tip ${className}`.trim()}
      onClick={() => onSort(sortKey)}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      {label} <span className="sort-indicator">{arrow}</span>
    </HoverTip>
  );
}
