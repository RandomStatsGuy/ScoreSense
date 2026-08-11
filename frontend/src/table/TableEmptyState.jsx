import React from "react";

/**
 * Shared empty-state row for data tables. Renders a message plus an optional
 * recovery action (e.g. "Clear filters") so users aren't left at a dead end.
 */
export default function TableEmptyState({ colSpan, message, actionLabel, onAction }) {
  return (
    <tr>
      <td colSpan={colSpan} className="table-empty-state">
        <div className="table-empty-state-inner">
          <span className="table-empty-state-message">{message}</span>
          {onAction ? (
            <button type="button" className="btn-ghost btn-sm table-empty-state-action" onClick={onAction}>
              {actionLabel || "Clear filters"}
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
