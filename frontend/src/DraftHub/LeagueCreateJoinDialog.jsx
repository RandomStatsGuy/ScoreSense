import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import LeagueCreateJoinForm from "./LeagueCreateJoinForm";
import { LEAGUE_CREATE_COPY } from "./leagueAccessCopy";

export default function LeagueCreateJoinDialog({
  open,
  onClose,
  season,
  presets,
  onCreated,
}) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onCloseRef.current?.();
    };
    document.addEventListener("keydown", onKey);
    const root = document.getElementById("root");
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Portal lives on document.body. Lock #root so a leftover sheet, chat
    // backdrop, or native select popup cannot keep eating pointer events.
    root?.setAttribute("inert", "");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      root?.removeAttribute("inert");
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="invite-overlay league-create-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="league-create-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current?.();
      }}
    >
      <div className="invite-modal league-create-modal panel">
        <div className="league-create-modal-head">
          <div>
            <h2 id="league-create-title">{LEAGUE_CREATE_COPY.title}</h2>
            <p className="chart-note league-create-modal-lead">
              {LEAGUE_CREATE_COPY.lead}
            </p>
          </div>
          <button type="button" className="btn-ghost btn-sm" onClick={() => onCloseRef.current?.()}>
            {LEAGUE_CREATE_COPY.close}
          </button>
        </div>
        <LeagueCreateJoinForm
          season={season}
          presets={presets}
          onSuccess={(data) => {
            onCreated?.(data);
            onCloseRef.current?.();
          }}
        />
      </div>
    </div>,
    document.body,
  );
}
