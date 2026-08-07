import React from "react";
import { useAuth } from "../AuthContext";

export default function HubDemoBanner({ onExit, leagueName }) {
  const { openSignIn } = useAuth();

  return (
    <div className="hub-demo-banner" role="status">
      <span>
        Sample league{leagueName ? ` · ${leagueName}` : ""} — read-only preview.
      </span>
      <div className="hub-demo-banner-actions">
        <button type="button" className="btn-primary btn-sm" onClick={openSignIn}>
          Sign in
        </button>
        {onExit && (
          <button type="button" className="btn-ghost btn-sm" onClick={onExit}>
            Exit demo
          </button>
        )}
      </div>
    </div>
  );
}
