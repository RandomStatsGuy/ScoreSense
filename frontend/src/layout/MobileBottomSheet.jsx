import React, { useLayoutEffect, useRef } from "react";
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
  const gripRef = useRef(null);
  const mobileLayout = useMobileLayout();

  // Native keyboard scrolling must leave room for sticky sheet chrome.
  // Measure it so wrapped titles and text resizing retain the same clearance.
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    const grip = gripRef.current;
    if (!open || !mobileLayout || !sheet || !grip) return undefined;
    const footer = sheet.querySelector("[data-sheet-sticky-footer]");
    const measure = () => {
      sheet.style.setProperty("--sheet-header-block-size", `${grip.offsetHeight}px`);
      sheet.style.setProperty("--sheet-footer-block-size", `${footer?.offsetHeight || 0}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grip);
    if (footer) observer.observe(footer);
    return () => {
      observer.disconnect();
      sheet.style.removeProperty("--sheet-header-block-size");
      sheet.style.removeProperty("--sheet-footer-block-size");
    };
  }, [open, mobileLayout]);

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
          ref={gripRef}
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
