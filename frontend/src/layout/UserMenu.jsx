import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Desktop account dropdown. Consolidates Account, Report a bug, Model accuracy,
 * Admin, data-refresh status, and Log out into a single menu so the header
 * stays to one row of actions.
 *
 * Popover is portaled to document.body with position:fixed so it is not trapped
 * by the header shell's backdrop-filter stacking context (which otherwise loses
 * to sticky projection filters / table headers).
 */
export default function UserMenu({
  authReady,
  authenticated,
  user,
  isAdmin,
  view,
  openSignIn,
  onAccount,
  onGoToReport,
  onGoToModel,
  onGoToAdmin,
  onLogout,
  refreshStatus,
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
    // Capture scroll from nested sticky/overflow containers too.
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  // Portal removes the popover from the trigger's DOM tab order; move focus in once.
  useEffect(() => {
    if (!open || !coords || !popoverRef.current) return;
    if (document.activeElement !== triggerRef.current) return;
    popoverRef.current.querySelector('[role="menuitem"]')?.focus();
  }, [open, coords]);

  useEffect(() => {
    if (!open) return undefined;

    const menuItems = () =>
      Array.from(popoverRef.current?.querySelectorAll('[role="menuitem"]') || []);

    const onDown = (e) => {
      const t = e.target;
      if (rootRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }

      const items = menuItems();
      if (!items.length) return;
      const idx = items.indexOf(document.activeElement);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        items[idx < 0 ? 0 : (idx + 1) % items.length].focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        items[idx < 0 ? items.length - 1 : (idx - 1 + items.length) % items.length].focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        items[0].focus();
      } else if (e.key === "End") {
        e.preventDefault();
        items[items.length - 1].focus();
      } else if (e.key === "Tab") {
        // Portal is outside the trigger's tab sequence; put focus back on the
        // menu button before unmount so native Tab continues from there.
        triggerRef.current?.focus();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!authReady) return null;

  if (!authenticated) {
    return (
      <div className="user-menu">
        <button type="button" className="btn-primary btn-sm" onClick={openSignIn}>
          Sign in
        </button>
        <button
          type="button"
          className="app-header-info-link"
          onClick={onGoToReport}
        >
          Report a bug
        </button>
        <button
          type="button"
          className={`app-header-info-link${view === "model" ? " active" : ""}`}
          onClick={onGoToModel}
        >
          Model
        </button>
      </div>
    );
  }

  const label = user?.name || user?.email || "Account";
  const run = (fn) => () => {
    setOpen(false);
    fn?.();
  };

  const menu = open && coords
    ? createPortal(
        <div
          ref={popoverRef}
          className="user-menu-popover user-menu-popover--portal"
          role="menu"
          style={{ top: coords.top, right: coords.right }}
        >
          <button type="button" role="menuitem" className="user-menu-item" onClick={run(onAccount)}>
            Account settings
          </button>
          <button type="button" role="menuitem" className="user-menu-item" onClick={run(onGoToReport)}>
            Report a bug
          </button>
          <button
            type="button"
            role="menuitem"
            className={`user-menu-item${view === "model" ? " active" : ""}`}
            onClick={run(onGoToModel)}
          >
            Model accuracy
          </button>
          {isAdmin && (
            <button
              type="button"
              role="menuitem"
              className={`user-menu-item${view === "admin" ? " active" : ""}`}
              onClick={run(onGoToAdmin)}
            >
              Admin portal
            </button>
          )}
          {refreshStatus?.completed_at && (
            <p className="user-menu-meta">
              Data updated {new Date(refreshStatus.completed_at).toLocaleString()}
            </p>
          )}
          <div className="user-menu-divider" />
          <button type="button" role="menuitem" className="user-menu-item" onClick={run(onLogout)}>
            Log out
          </button>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className={`user-menu${open ? " is-open" : ""}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="user-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="user-menu-avatar" aria-hidden="true">
          {String(label).trim().charAt(0).toUpperCase() || "?"}
        </span>
        <span className="user-menu-name">{label}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {menu}
    </div>
  );
}
