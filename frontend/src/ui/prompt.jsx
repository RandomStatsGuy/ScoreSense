import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

/**
 * Imperative text prompt dialog (promise), parallel to confirmDialog.
 *
 *   const reason = await promptDialog({ title, message, minLength: 3 });
 *   if (reason == null) return; // cancelled
 */
function PromptDialog({
  title,
  message,
  label,
  placeholder,
  confirmLabel,
  cancelLabel,
  minLength,
  initialValue,
  beforeAfter,
  onResolve,
}) {
  const inputRef = useRef(null);
  const [value, setValue] = useState(initialValue || "");
  const trimmed = value.trim();
  const canConfirm = trimmed.length >= minLength;

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onResolve(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onResolve]);

  return (
    <div
      className="confirm-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onResolve(null);
      }}
    >
      <div
        className="confirm-card panel hub-prompt-card"
        role="dialog"
        aria-modal="true"
        aria-label={title || "Prompt"}
      >
        {title ? <h3 className="confirm-title">{title}</h3> : null}
        {message ? <p className="confirm-message">{message}</p> : null}
        {beforeAfter ? (
          <dl className="hub-override-before-after">
            <div>
              <dt>Before</dt>
              <dd>{beforeAfter.before}</dd>
            </div>
            <div>
              <dt>After</dt>
              <dd>{beforeAfter.after}</dd>
            </div>
          </dl>
        ) : null}
        <label className="hub-prompt-field">
          <span className="hub-filter-label">{label}</span>
          <textarea
            ref={inputRef}
            className="search-input hub-prompt-textarea"
            rows={3}
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canConfirm) {
                e.preventDefault();
                onResolve(trimmed);
              }
            }}
          />
        </label>
        {minLength > 0 && trimmed.length > 0 && trimmed.length < minLength ? (
          <p className="chart-note hub-prompt-hint">Reason needs at least {minLength} characters.</p>
        ) : null}
        <div className="confirm-actions">
          <button type="button" className="btn-ghost btn-sm" onClick={() => onResolve(null)}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!canConfirm}
            onClick={() => onResolve(trimmed)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function promptDialog({
  title = "",
  message = "",
  label = "Reason",
  placeholder = "Why is this changing?",
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  minLength = 3,
  initialValue = "",
  beforeAfter = null,
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
      <PromptDialog
        title={title}
        message={message}
        label={label}
        placeholder={placeholder}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        minLength={minLength}
        initialValue={initialValue}
        beforeAfter={beforeAfter}
        onResolve={cleanup}
      />,
    );
  });
}

export default promptDialog;
