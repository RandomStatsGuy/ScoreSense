import React from "react";
import { chooseDestinationLabel, MOBILE_CHROME_COPY } from "./mobileChromePresentation";

function FilterIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 6h16M7 12h10M10 18h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function MobileHeader({
  title,
  hasMenu = false,
  menuOpen = false,
  onTitleClick,
  onFilterOpen,
  showFilter = false,
}) {
  return (
    <div className="app-header-mobile-top">
      {hasMenu ? (
        <button
          type="button"
          className="app-header-mobile-title-btn"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          aria-label={chooseDestinationLabel(title)}
          onClick={onTitleClick}
        >
          <span className="app-header-mobile-title">{title}</span>
          <span className="app-header-mobile-title-caret" aria-hidden="true">▾</span>
        </button>
      ) : (
        <h1 className="app-header-mobile-title">{title}</h1>
      )}
      {showFilter ? (
        <div className="app-header-mobile-actions">
          <button
            type="button"
            className="app-header-icon-btn"
            aria-label={MOBILE_CHROME_COPY.filters}
            onClick={onFilterOpen}
          >
            <FilterIcon />
          </button>
        </div>
      ) : null}
    </div>
  );
}
