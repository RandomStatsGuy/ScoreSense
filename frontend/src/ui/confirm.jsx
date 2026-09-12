import React, { useId, useRef } from "react";
import { createRoot } from "react-dom/client";
import useModalFocus from "./useModalFocus";

/**
 * Accessible confirm dialog rendered imperatively as a promise so it can be a
 * drop-in replacement for window.confirm:
 *
 *   if (!(await confirmDialog({ message: "…" }))) return;
 */
function ConfirmDialog({ title, message, confirmLabel, cancelLabel, danger, onResolve }) {
  const cardRef = useRef(null);
  const messageId = useId();
  const cancelRef = useRef(null);
  useModalFocus(true, cardRef, () => onResolve(false), cancelRef);

  return (
    <div
      className="confirm-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onResolve(false);
      }}
    >
      <div ref={cardRef} className="confirm-card panel" role="alertdialog" aria-modal="true" aria-label={title || "Confirm"} aria-describedby={messageId}>
        {title && <h3 className="confirm-title">{title}</h3>}
        <p id={messageId} className="confirm-message">{message}</p>
        <div className="confirm-actions">
          <button ref={cancelRef} type="button" className="btn-ghost btn-sm" onClick={() => onResolve(false)}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? "btn-danger" : "btn-primary"}
            onClick={() => onResolve(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function confirmDialog({
  title = "",
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const cleanup = (result) => {
      root.unmount();
      host.remove();
      resolve(result);
    };
    root.render(
      <ConfirmDialog
        title={title}
        message={message}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        danger={danger}
        onResolve={cleanup}
      />,
    );
  });
}

export default confirmDialog;
