import React, { useEffect, useRef } from "react";

export default function MobileBottomSheet({
  open,
  onClose,
  title,
  ariaLabel,
  children,
  className = "",
}) {
  const sheetRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="app-mobile-sheet-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={sheetRef}
        className={`app-mobile-sheet ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || title || "Panel"}
        onClick={(event) => event.stopPropagation()}
      >
        {title ? (
          <div className="app-mobile-sheet-head">
            <h2 className="app-mobile-sheet-title">{title}</h2>
            <button
              type="button"
              className="app-mobile-sheet-close"
              aria-label="Close"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
