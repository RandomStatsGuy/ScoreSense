import React, { useEffect, useRef, useState } from "react";
import LeagueChat from "./LeagueChat";

export default function FantasyChatDock({ leagueId, hubContext, hidden = false }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!leagueId || hidden) return null;

  return (
    <div className={`fantasy-chat-dock${open ? " is-open" : ""}`}>
      {open && (
        <aside
          id="fantasy-chat-drawer"
          className="fantasy-chat-drawer"
          role="dialog"
          aria-modal="false"
          aria-labelledby="fantasy-chat-title"
        >
          <header>
            <div>
              <span>League conversation</span>
              <h2 id="fantasy-chat-title">{hubContext?.league_name || "League chat"}</h2>
            </div>
            <button
              ref={closeRef}
              type="button"
              className="fantasy-chat-close"
              aria-label="Close league chat"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              ×
            </button>
          </header>
          <p className="fantasy-chat-context">Stays with you while you move through Fantasy.</p>
          <LeagueChat leagueId={leagueId} hubContext={hubContext} />
        </aside>
      )}
      <button
        ref={triggerRef}
        type="button"
        className="fantasy-chat-trigger"
        aria-expanded={open}
        aria-controls="fantasy-chat-drawer"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="fantasy-chat-pulse" aria-hidden="true" />
        <span><strong>League chat</strong><small>{open ? "Close conversation" : "Open conversation"}</small></span>
        <span aria-hidden="true">{open ? "↓" : "↑"}</span>
      </button>
    </div>
  );
}
