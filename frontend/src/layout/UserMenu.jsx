import React, { useEffect, useRef, useState } from "react";

/**
 * Desktop account dropdown. Consolidates Account, Model accuracy, Admin,
 * data-refresh status, and Log out into a single menu so the header stays to
 * one row of actions.
 */
export default function UserMenu({
  authReady,
  authenticated,
  user,
  isAdmin,
  view,
  openSignIn,
  onAccount,
  onGoToModel,
  onGoToAdmin,
  onLogout,
  refreshStatus,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
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

  return (
    <div className="user-menu" ref={ref}>
      <button
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
      {open && (
        <div className="user-menu-popover" role="menu">
          <button type="button" role="menuitem" className="user-menu-item" onClick={run(onAccount)}>
            Account settings
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
        </div>
      )}
    </div>
  );
}
