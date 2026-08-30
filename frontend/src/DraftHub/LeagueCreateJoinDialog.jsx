import React, { useEffect, useRef } from "react";
import LeagueCreateJoinForm from "./LeagueCreateJoinForm";

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
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
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
        <h2 id="league-create-title">Create or join a league</h2>
        <p className="chart-note league-create-modal-lead">
          Start a new ScoreSense league room, or join one with a room code.
          You can still keep your current league and switch back anytime.
        </p>
        <LeagueCreateJoinForm
          season={season}
          presets={presets}
          onSuccess={(data) => {
            onCreated?.(data);
            onCloseRef.current?.();
          }}
        />
        <button type="button" className="btn-ghost btn-sm invite-dismiss" onClick={() => onCloseRef.current?.()}>
          Cancel
        </button>
      </div>
    </div>
  );
}
