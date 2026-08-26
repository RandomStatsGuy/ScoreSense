import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Commissioner overflow (End draft / Discard). Portaled to document.body so
 * the menu is not trapped under the live command bar, mobile tabs, or the
 * hub page backdrop-filter stacking context.
 */
export default function DraftOverflowMenu({
  label = "More",
  ariaLabel = "More commissioner controls",
  children,
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setCoords(null);
      return undefined;
    }
    const update = () => {
      const rect = triggerRef.current.getBoundingClientRect();
      setCoords({
        top: Math.round(rect.bottom + 6),
        right: Math.round(Math.max(8, window.innerWidth - rect.right)),
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      const t = e.target;
      if (rootRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const menu = open && coords
    ? createPortal(
        <div
          ref={popoverRef}
          className="hub-draft-commish-overflow-menu hub-draft-commish-overflow-menu--portal"
          role="menu"
          style={{ top: coords.top, right: coords.right }}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="hub-draft-commish-overflow" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="btn-ghost btn-sm"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {menu}
    </div>
  );
}
