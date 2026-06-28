import React from "react";
import { PRODUCT_NAME } from "../brand";

export default function MobileHeader({
  contextLabel,
  showDataRefresh,
  dataRefreshLoading,
  onRefresh,
  onMenuOpen,
  onFilterOpen,
  showFilter,
  mobileMenuOpen,
}) {
  return (
    <div className="app-header-mobile-top">
      <h1 className="app-header-mobile-brand">{PRODUCT_NAME}</h1>
      <p className="app-header-mobile-context">{contextLabel}</p>
      <div className="app-header-mobile-actions">
        {showFilter ? (
          <button
            type="button"
            className="app-header-icon-btn"
            aria-label="Filters"
            onClick={onFilterOpen}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 6h16M7 12h10M10 18h4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        ) : null}
        {showDataRefresh ? (
          <button
            type="button"
            className="app-header-icon-btn"
            aria-label={dataRefreshLoading ? "Loading data" : "Refresh data"}
            onClick={onRefresh}
            disabled={dataRefreshLoading}
          >
            {dataRefreshLoading ? "…" : "↻"}
          </button>
        ) : null}
        <button
          type="button"
          className="app-header-icon-btn"
          aria-label="Account and settings"
          aria-expanded={mobileMenuOpen}
          onClick={onMenuOpen}
        >
          ☰
        </button>
      </div>
    </div>
  );
}
