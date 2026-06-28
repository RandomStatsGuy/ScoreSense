import React, { useEffect, useRef } from "react";

export default function MobileSubnav({
  tabs,
  active,
  onChange,
  ariaLabel,
  className = "",
  showShortLabels = false,
  trailingAction = null,
}) {
  const navRef = useRef(null);

  useEffect(() => {
    const el = navRef.current?.querySelector(".app-section-subnav-btn.active");
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [active, tabs.length]);

  return (
    <div className={`mobile-subnav-row ${className}`.trim()}>
      <nav
        ref={navRef}
        className="app-section-subnav mobile-subnav"
        role="tablist"
        aria-label={ariaLabel}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            className={`app-section-subnav-btn${active === tab.id ? " active" : ""}`}
            onClick={() => onChange(tab.id)}
            title={tab.hint || tab.label}
          >
            {showShortLabels && tab.shortLabel ? (
              <>
                <span className="app-section-subnav-label">{tab.label}</span>
                <span className="app-section-subnav-label-short">{tab.shortLabel}</span>
              </>
            ) : (
              <>
                <span className="mobile-subnav-label">{tab.label}</span>
                {tab.badge != null ? (
                  <span className="projections-mobile-tab-badge">{tab.badge}</span>
                ) : null}
              </>
            )}
          </button>
        ))}
      </nav>
      {trailingAction}
    </div>
  );
}
