import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import LeagueChat from "./LeagueChat";
import useMobileLayout from "../useMobileLayout";
import {
  FANTASY_CHAT_COPY,
  fantasyChatDockClass,
  readChatLauncherDismissed,
  writeChatLauncherDismissed,
} from "./fantasyChatPresentation";

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
  const [dismissed, setDismissed] = useState(readChatLauncherDismissed);
  const triggerRef = useRef(null);
  const closeRef = useRef(null);
  const restoreRef = useRef(null);
  const restoreFocusRef = useRef(false);

  const closeConversation = () => {
    restoreFocusRef.current = true;
    setOpen(false);
  };

  const dismissLauncher = () => {
    setOpen(false);
    setDismissed(true);
    writeChatLauncherDismissed(true);
  };

  const restoreLauncher = () => {
    setDismissed(false);
    writeChatLauncherDismissed(false);
  };

  useEffect(() => {
    if (hidden) {
      restoreFocusRef.current = false;
      setOpen(false);
    }
  }, [hidden]);

  useLayoutEffect(() => {
    if (open || hidden || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    const focusTarget = dismissed ? restoreRef.current : triggerRef.current;
    focusTarget?.focus();
  }, [open, dismissed, hidden]);

  useEffect(() => {
    if (!open || hidden) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      closeConversation();
    };
    document.addEventListener("keydown", onKeyDown);
    closeRef.current?.focus();

    const root = document.getElementById("root");
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root?.setAttribute("inert", "");

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      root?.removeAttribute("inert");
    };
  }, [open, dismissed, hidden]);

  if (!leagueId || hidden || typeof document === "undefined") return null;

  return createPortal(
    <div className={fantasyChatDockClass({ open, dismissed })}>
      {open && (
        <div
          className="fantasy-chat-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeConversation();
          }}
        >
          <aside
            id="fantasy-chat-stage"
            className="fantasy-chat-stage"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fantasy-chat-title"
          >
            <header>
              <div>
                <span>{FANTASY_CHAT_COPY.eyebrow}</span>
                <h2 id="fantasy-chat-title">{hubContext?.league_name || FANTASY_CHAT_COPY.titleFallback}</h2>
              </div>
              <button
                ref={closeRef}
                type="button"
                className="fantasy-chat-close"
                aria-label={FANTASY_CHAT_COPY.closeChat}
                onClick={closeConversation}
              >
                ×
              </button>
            </header>
            <p className="fantasy-chat-context">{FANTASY_CHAT_COPY.context}</p>
            <LeagueChat leagueId={leagueId} hubContext={hubContext} />
          </aside>
        </div>
      )}
      {!open && dismissed && (
        <button
          ref={restoreRef}
          type="button"
          className="fantasy-chat-restore"
          aria-label={FANTASY_CHAT_COPY.restoreLauncher}
          onClick={restoreLauncher}
        >
          <span className="fantasy-chat-pulse" aria-hidden="true" />
          <ChatIcon />
        </button>
      )}
      {!open && !dismissed && (
        <div className="fantasy-chat-launcher">
          <button
            ref={triggerRef}
            type="button"
            className={`fantasy-chat-trigger${mobileLayout ? " fantasy-chat-trigger--icon" : ""}`}
            aria-expanded={open}
            aria-controls="fantasy-chat-stage"
            aria-label={FANTASY_CHAT_COPY.openChat}
            onClick={() => setOpen(true)}
          >
            <span className="fantasy-chat-pulse" aria-hidden="true" />
            {mobileLayout ? (
              <ChatIcon />
            ) : (
              <>
                <ChatIcon />
                <span>
                  <strong>{FANTASY_CHAT_COPY.leagueChat}</strong>
                  <small>{FANTASY_CHAT_COPY.openConversation}</small>
                </span>
              </>
            )}
          </button>
          <button
            type="button"
            className="fantasy-chat-dismiss"
            aria-label={FANTASY_CHAT_COPY.dismissLauncher}
            onClick={dismissLauncher}
          >
            ×
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
