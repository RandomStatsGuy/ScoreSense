import React, { useMemo, useRef, useState } from "react";
import MobileBottomSheet from "../layout/MobileBottomSheet";

export const HUB_SUBVIEWS = [
  { id: "setup", label: "Setup", shortLabel: "Setup", hint: "League & rules" },
  { id: "value", label: "Players", shortLabel: "Players", hint: "Prices" },
  { id: "roster", label: "Roster", shortLabel: "Roster", hint: "Contracts" },
  { id: "room", label: "Draft", shortLabel: "Draft", hint: "Live auction" },
  { id: "planner", label: "Cap", shortLabel: "Cap", hint: "Cap & cuts" },
  { id: "insights", label: "Insights", shortLabel: "Stats", leagueOnly: true, hint: "Spend & scoring" },
  { id: "live", label: "Live", shortLabel: "Live", leagueOnly: true, hint: "This week's matchup" },
  { id: "league-rosters", label: "Teams", shortLabel: "Teams", commissionerOnly: true, hint: "All rosters" },
];

function filterSubviews(hubContext) {
  return HUB_SUBVIEWS.filter((v) => {
    if (v.commissionerOnly && !hubContext?.is_commissioner) return false;
    if (v.leagueOnly && hubContext?.mode !== "league") return false;
    return true;
  });
}

export default function HubSubnav({ subView, hubContext, onNavigate, mobileLayout = false }) {
  const navRef = useRef(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const visible = useMemo(() => filterSubviews(hubContext), [hubContext]);

  React.useEffect(() => {
    const active = navRef.current?.querySelector(".app-section-subnav-btn.active");
    active?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [subView, visible.length]);

  return (
    <>
      <div className="hub-subnav-row">
        <nav
          ref={navRef}
          className="app-section-subnav app-section-subnav--hub"
          role="tablist"
          aria-label="League"
        >
          {visible.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={subView === v.id}
              className={`app-section-subnav-btn${subView === v.id ? " active" : ""}`}
              onClick={() => onNavigate(v.id)}
              title={v.hint}
            >
              <span className="app-section-subnav-label">{v.label}</span>
              <span className="app-section-subnav-label-short">{v.shortLabel || v.label}</span>
            </button>
          ))}
        </nav>
        {mobileLayout && visible.length > 5 ? (
          <button
            type="button"
            className="hub-subnav-picker-btn"
            aria-label="All league tabs"
            onClick={() => setPickerOpen(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="4" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
              <rect x="13" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
              <rect x="4" y="13" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
              <rect x="13" y="13" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
        ) : null}
      </div>

      <MobileBottomSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="League sections"
        className="app-mobile-sheet-hub-tabs"
      >
        <div className="app-mobile-sheet-list">
          {visible.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`app-mobile-sheet-item app-mobile-sheet-item-subdued${subView === v.id ? " active" : ""}`}
              onClick={() => {
                onNavigate(v.id);
                setPickerOpen(false);
              }}
            >
              <span>{v.label}</span>
              <span className="chart-note">{v.hint}</span>
            </button>
          ))}
        </div>
      </MobileBottomSheet>
    </>
  );
}
