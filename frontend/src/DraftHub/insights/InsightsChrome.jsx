import React from "react";

export function InsightsProgress({ active }) {
  if (!active) return null;
  return <div className="hub-insights-progress hub-insights-progress--active" aria-hidden />;
}

export function InsightsSkeleton() {
  return (
    <div className="hub-insights-skeleton" aria-busy="true" aria-label="Loading insights">
      <div className="hub-insights-skeleton-block hub-insights-skeleton-block--head" />
      <div className="hub-insights-skeleton-row hub-insights-skeleton-row--talk">
        <div className="hub-insights-skeleton-block hub-insights-skeleton-block--card" />
        <div className="hub-insights-skeleton-block hub-insights-skeleton-block--card" />
        <div className="hub-insights-skeleton-block hub-insights-skeleton-block--card" />
        <div className="hub-insights-skeleton-block hub-insights-skeleton-block--card" />
      </div>
      <div className="hub-insights-skeleton-block hub-insights-skeleton-block--board" />
    </div>
  );
}

export function InsightsOverviewSkeleton() {
  return (
    <div
      className="hub-insights-overview-grid hub-insights-overview-grid--skeleton"
      aria-busy="true"
      aria-label="Loading league history"
    >
      <div className="hub-insights-skeleton-block hub-insights-skeleton-block--panel" />
      <div className="hub-insights-skeleton-block hub-insights-skeleton-block--panel" />
      <div className="hub-insights-skeleton-block hub-insights-skeleton-block--panel" />
    </div>
  );
}

export default function InsightsFallback() {
  return (
    <div className="hub-insights">
      <InsightsProgress active />
      <InsightsSkeleton />
    </div>
  );
}
