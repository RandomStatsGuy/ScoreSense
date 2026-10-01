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
  compactLeague = false,
}) {
  return (
    <div className={`app-header-mobile-top${compactLeague ? " app-header-mobile-top--league" : ""}`} data-compact-header={compactLeague || undefined}>
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
          <span className="app-header-mobile-title-caret" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="m7 10 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
        </button>
      ) : (
        <h1 className="app-header-mobile-title">{title}</h1>
      )}
      {compactLeague ? (
        <div id="mobile-home-league-slot" className="app-header-mobile-league-slot" />
      ) : null}
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
