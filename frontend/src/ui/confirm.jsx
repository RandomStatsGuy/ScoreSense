import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

/**
 * Accessible confirm dialog rendered imperatively as a promise so it can be a
 * drop-in replacement for window.confirm:
 *
 *   if (!(await confirmDialog({ message: "…" }))) return;
 */
function ConfirmDialog({ title, message, confirmLabel, cancelLabel, danger, onResolve }) {
  const confirmRef = useRef(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onResolve(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onResolve]);

  return (
    <div
      className="confirm-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onResolve(false);
      }}
    >
      <div className="confirm-card panel" role="alertdialog" aria-modal="true" aria-label={title || "Confirm"}>
        {title && <h3 className="confirm-title">{title}</h3>}
        <p className="confirm-message">{message}</p>
        <div className="confirm-actions">
          <button type="button" className="btn-ghost btn-sm" onClick={() => onResolve(false)}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
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
