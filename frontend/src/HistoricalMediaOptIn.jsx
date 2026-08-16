import React from "react";
import {
  VIEW_OLDER_COMMENTARY_LABEL,
  historicalOptInCopy,
  pickHistoricalWeek,
} from "./mediaContext";

/**
 * SCORE-28 — explicit opt-in for older media/narrative when current week is empty.
 */
export default function HistoricalMediaOptIn({
  requestedWeek = null,
  media = null,
  historical = null,
  onViewOlder,
  loading = false,
  className = "",
}) {
  const hist = historical || pickHistoricalWeek(media);
  const copy = historicalOptInCopy({
    requestedWeek,
    historical: hist,
  });

  return (
    <div
      className={`historical-media-opt-in ${className}`.trim()}
      role="status"
    >
      <p className="historical-media-opt-in-copy">{copy}</p>
      {typeof onViewOlder === "function" ? (
        <button
          type="button"
          className="btn-ghost btn-sm historical-media-opt-in-btn"
          onClick={onViewOlder}
          disabled={loading}
        >
          {loading ? "Loading…" : VIEW_OLDER_COMMENTARY_LABEL}
        </button>
      ) : null}
    </div>
  );
}
