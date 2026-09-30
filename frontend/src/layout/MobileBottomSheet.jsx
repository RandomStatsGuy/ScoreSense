import React, { useRef } from "react";
import { createPortal } from "react-dom";
import useMobileLayout from "../useMobileLayout";
import useModalFocus from "../ui/useModalFocus";

/** Swipe distance (px) past which a downward drag dismisses the sheet. */
const DISMISS_THRESHOLD = 90;

export default function MobileBottomSheet({
  open,
  onClose,
  title,
  ariaLabel,
  children,
  className = "",
}) {
  const sheetRef = useRef(null);
  const dragStartY = useRef(null);
  const mobileLayout = useMobileLayout();

  // A hidden sheet after rotation must not keep the page locked.
  useModalFocus(open && mobileLayout, sheetRef, onClose);

  if (!open) return null;

  // Drag-to-dismiss, scoped to the handle/header strip so it never fights
  // with scrolling inside the sheet body.
  const onDragStart = (event) => {
    dragStartY.current = event.touches?.[0]?.clientY ?? null;
  };
  const onDragMove = (event) => {
    if (dragStartY.current == null || !sheetRef.current) return;
    const dy = (event.touches?.[0]?.clientY ?? 0) - dragStartY.current;
    if (dy > 0) {
      sheetRef.current.style.transform = `translateY(${dy}px)`;
      sheetRef.current.style.transition = "none";
    }
  };
  const onDragEnd = (event) => {
    if (dragStartY.current == null || !sheetRef.current) return;
    const dy = (event.changedTouches?.[0]?.clientY ?? 0) - dragStartY.current;
    dragStartY.current = null;
    sheetRef.current.style.transition = "";
    if (dy > DISMISS_THRESHOLD) {
      onClose?.();
    } else {
      sheetRef.current.style.transform = "";
    }
  };

  return createPortal(
    <div
      className="app-mobile-sheet-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={sheetRef}
        className={`app-mobile-sheet ${className}`.trim()}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label={ariaLabel || title || "Panel"}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="app-mobile-sheet-grip"
          onTouchStart={onDragStart}
          onTouchMove={onDragMove}
          onTouchEnd={onDragEnd}
        >
          <span className="app-mobile-sheet-handle" aria-hidden="true" />
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
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
