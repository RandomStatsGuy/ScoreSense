import React, { useEffect } from "react";
import LeagueCreateJoinForm from "./LeagueCreateJoinForm";

export default function LeagueCreateJoinDialog({
  open,
  onClose,
  season,
  presets,
  onCreated,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="invite-overlay league-create-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="league-create-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
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
            onClose?.();
          }}
        />
        <button type="button" className="btn-ghost btn-sm invite-dismiss" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
