/**
 * League chat: flush edge launcher (parked on an edge, expands on hover) that
 * opens a side drawer. Drag parks it on a new edge — horizontal type, not rotated.
 * Do not show this launcher on Home (Home houses the full thread as a locker rail).
 * Do not add a Chat destination. On phone default to the bottom-right above the
 * tab bar; the dismiss control sits on the bubble. Clear chat is staff-only, red,
 * and confirms. See docs/PRODUCT.md · Chat.
 */
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import LeagueChat from "./LeagueChat";
import useMobileLayout from "../useMobileLayout";
import {
  FANTASY_CHAT_COPY,
  fantasyChatDockClass,
  nearestChatEdge,
  readChatLauncherDismissed,
  readChatLauncherEdge,
  writeChatLauncherDismissed,
  writeChatLauncherEdge,
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
  const [edge, setEdge] = useState(() => readChatLauncherEdge(undefined, { mobile: false }));
  const [dragging, setDragging] = useState(false);
  const triggerRef = useRef(null);
  const closeRef = useRef(null);
  const restoreRef = useRef(null);
  const launcherRef = useRef(null);
  const dockRef = useRef(null);
  const dragRef = useRef(null);
  const skipClickRef = useRef(false);

  const closeConversation = () => {
    setOpen(false);
  };

  useEffect(() => {
    setEdge(readChatLauncherEdge(undefined, { mobile: mobileLayout }));
  }, [mobileLayout]);

  useEffect(() => {
    if (hidden) setOpen(false);
  }, [hidden]);

  const wasOpenRef = useRef(false);
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (!wasOpen || open || hidden) return;
    const focusTarget = dismissed ? restoreRef.current : triggerRef.current;
    focusTarget?.focus();
  }, [open, dismissed, hidden]);

  const dismissLauncher = () => {
    setOpen(false);
    setDismissed(true);
    writeChatLauncherDismissed(true);
  };

  const restoreLauncher = () => {
    setDismissed(false);
    writeChatLauncherDismissed(false);
  };

  const parkEdge = (next) => {
    const parked = writeChatLauncherEdge(next);
    setEdge(parked);
    return parked;
  };

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

  const onLauncherPointerDown = (event) => {
    if (event.button != null && event.button !== 0) return;
    if (event.target.closest(".fantasy-chat-dismiss")) return;
    skipClickRef.current = false;
    const node = launcherRef.current;
    if (!node) return;
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      origLeft: node.getBoundingClientRect().left,
      origTop: node.getBoundingClientRect().top,
      moved: false,
      armed: false,
      pointerId: event.pointerId,
    };
    node.setPointerCapture?.(event.pointerId);
  };

  const onLauncherPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
    if (!drag.moved) return;
    if (!drag.armed) {
      drag.armed = true;
      dockRef.current?.classList.add("is-dragging");
      setDragging(true);
    }
    const node = launcherRef.current;
    if (!node) return;
    node.style.left = `${drag.origLeft + dx}px`;
    node.style.top = `${drag.origTop + dy}px`;
    node.style.right = "auto";
    node.style.bottom = "auto";
    node.style.transform = "none";
  };

  const onLauncherPointerUp = (event) => {
    const drag = dragRef.current;
    const node = launcherRef.current;
    dragRef.current = null;
    if (!drag) return;
    node?.releasePointerCapture?.(drag.pointerId);
    const dropRect = node?.getBoundingClientRect();
    dockRef.current?.classList.remove("is-dragging");
    if (node) {
      node.style.left = "";
      node.style.top = "";
      node.style.right = "";
      node.style.bottom = "";
      node.style.transform = "";
    }
    setDragging(false);
    if (drag.moved) {
      skipClickRef.current = true;
      const x = (dropRect?.left ?? event.clientX) + (dropRect?.width ?? 0) / 2;
      const y = (dropRect?.top ?? event.clientY) + (dropRect?.height ?? 0) / 2;
      parkEdge(nearestChatEdge(x, y, window.innerWidth, window.innerHeight));
      return;
    }
    if (event.target.closest(".fantasy-chat-dismiss")) return;
    if (dismissed) restoreLauncher();
    else setOpen(true);
  };

  if (!leagueId || hidden || typeof document === "undefined") return null;

  const dockClass = fantasyChatDockClass({ open, dismissed, edge, dragging });

  return createPortal(
    <div ref={dockRef} className={dockClass}>
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
        <div
          ref={launcherRef}
          className={`fantasy-chat-launcher${mobileLayout ? " fantasy-chat-launcher--phone" : ""}`}
          onPointerDown={onLauncherPointerDown}
          onPointerMove={onLauncherPointerMove}
          onPointerUp={onLauncherPointerUp}
          onPointerCancel={onLauncherPointerUp}
        >
          <button
            ref={triggerRef}
            type="button"
            className={`fantasy-chat-trigger${mobileLayout ? " fantasy-chat-trigger--icon" : ""}`}
            aria-expanded={open}
            aria-controls="fantasy-chat-stage"
            aria-label={FANTASY_CHAT_COPY.openChat}
            onClick={() => {
              if (skipClickRef.current) {
                skipClickRef.current = false;
                return;
              }
              setOpen(true);
            }}
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
            className={`fantasy-chat-dismiss${mobileLayout ? " fantasy-chat-dismiss--on-bubble" : ""}`}
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
