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
          Start a room or join with a code. You can switch back anytime.
        </p>
        <LeagueCreateJoinForm
          season={season}
          presets={presets}
          onSuccess={(data) => {
            onCreated?.(data);
            onCloseRef.current?.();
          }}
        />
        <div className="league-create-modal-foot">
          <button type="button" className="btn-ghost btn-sm" onClick={() => onCloseRef.current?.()}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
