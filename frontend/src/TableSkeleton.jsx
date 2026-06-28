import React from "react";

/**
 * Layout-stable placeholder rows matching data-table density.
 */
export function TableSkeleton({ rows = 12, cols = 7, className = "" }) {
  return (
    <tbody className={`table-skeleton${className ? ` ${className}` : ""}`} aria-hidden="true">
      {Array.from({ length: rows }, (_, rowIdx) => (
        <tr key={rowIdx} className="table-skeleton-row">
          {Array.from({ length: cols }, (__, colIdx) => (
            <td key={colIdx}>
              <div
                className="table-skeleton-cell"
                style={{ width: colIdx === 0 ? "72%" : colIdx === cols - 1 ? "45%" : "55%" }}
              />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export function ValueSheetTableSkeleton({ rows = 14, colSpan = 12 }) {
  return (
    <div className="table-wrap">
      <table className="data-table hub-table">
        <thead>
          <tr>
            {Array.from({ length: colSpan }, (_, i) => (
              <th key={i}><div className="table-skeleton-cell table-skeleton-cell-th" /></th>
            ))}
          </tr>
        </thead>
        <TableSkeleton rows={rows} cols={colSpan} />
      </table>
    </div>
  );
}
