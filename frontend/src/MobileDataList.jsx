import React from "react";

export function MobileStat({ label, value, className = "", title }) {
  return (
    <div className={`mobile-stat ${className}`.trim()} title={title}>
      <span className="mobile-stat-label">{label}</span>
      <span className="mobile-stat-value">{value}</span>
    </div>
  );
}

function MobileSkeleton({ rows = 10 }) {
  return (
    <div className="mobile-data-list mobile-data-list--loading" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="mobile-player-card mobile-player-card--skeleton">
          <div className="mobile-skeleton-line mobile-skeleton-line--title" />
          <div className="mobile-skeleton-line mobile-skeleton-line--meta" />
        </div>
      ))}
    </div>
  );
}

export default function MobileDataList({
  loading = false,
  emptyMessage,
  emptyActionLabel,
  onEmptyAction,
  skeletonRows = 10,
  children,
}) {
  const childCount = React.Children.count(children);

  if (loading && childCount === 0) {
    return <MobileSkeleton rows={skeletonRows} />;
  }

  if (!loading && emptyMessage) {
    return (
      <div className="mobile-data-list-empty">
        <p className="mobile-data-list-empty-message">{emptyMessage}</p>
        {onEmptyAction ? (
          <button type="button" className="btn-ghost btn-sm" onClick={onEmptyAction}>
            {emptyActionLabel || "Clear filters"}
          </button>
        ) : null}
      </div>
    );
  }

  return <div className="mobile-data-list">{children}</div>;
}
