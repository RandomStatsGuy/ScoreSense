import React, { useEffect, useRef, useState } from "react";
import LeagueChat from "./LeagueChat";
import useMobileLayout from "../useMobileLayout";
import { MOBILE_CHROME_COPY } from "../layout/mobileChromePresentation";

function ChatIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 6.5h14a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 17.5h-5.2L9 21v-3.5H5A1.5 1.5 0 0 1 3.5 16V8A1.5 1.5 0 0 1 5 6.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function FantasyChatDock({ leagueId, hubContext, hidden = false }) {
  const mobileLayout = useMobileLayout();
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
        className={`fantasy-chat-trigger${mobileLayout ? " fantasy-chat-trigger--icon" : ""}`}
        aria-expanded={open}
        aria-controls="fantasy-chat-drawer"
        aria-label={open ? MOBILE_CHROME_COPY.closeChat : MOBILE_CHROME_COPY.openChat}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="fantasy-chat-pulse" aria-hidden="true" />
        {mobileLayout ? (
          <ChatIcon />
        ) : (
          <>
            <span>
              <strong>{MOBILE_CHROME_COPY.leagueChat}</strong>
              <small>{open ? "Close conversation" : "Open conversation"}</small>
            </span>
            <span aria-hidden="true">{open ? "↓" : "↑"}</span>
          </>
        )}
      </button>
    </div>
  );
}
