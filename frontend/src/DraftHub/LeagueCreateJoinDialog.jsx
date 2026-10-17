import React, { useRef } from "react";
import { createPortal } from "react-dom";
import LeagueCreateJoinForm from "./LeagueCreateJoinForm";
import { LEAGUE_CREATE_COPY } from "./leagueAccessCopy";
import useModalFocus from "../ui/useModalFocus";

export default function LeagueCreateJoinDialog({
  open,
  onClose,
  season,
  presets,
  onCreated,
}) {
  const dialogRef = useRef(null);
  useModalFocus(open, dialogRef, onClose);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="invite-overlay league-create-overlay"
      ref={dialogRef}
      tabIndex={-1}
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
