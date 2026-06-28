import React from "react";

/** Shown while final season totals load after week 18 or during a data refresh with no rows yet. */
export default function SeasonTransitionState({ season, refreshing = false }) {
  const label = season ?? "…";

  return (
    <div className="season-transition" role="status" aria-live="polite">
      <div className="season-transition-head">
        <span className="season-transition-spinner" aria-hidden="true" />
        <div>
          <p className="season-transition-title">
            {refreshing
              ? `Updating ${label} season totals…`
              : `Finalizing ${label} regular-season totals…`}
          </p>
          <p className="season-transition-note">
            {refreshing
              ? "Refreshing season totals."
              : "Finalizing totals after Week 18."}
          </p>
        </div>
      </div>
      <div className="season-skeleton" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="season-skeleton-row"
            style={{ opacity: 1 - i * 0.14, animationDelay: `${i * 0.08}s` }}
          />
        ))}
      </div>
    </div>
  );
}
