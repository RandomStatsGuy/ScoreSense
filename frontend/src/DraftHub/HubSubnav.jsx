import React, { useMemo, useRef, useState } from "react";
import MobileBottomSheet from "../layout/MobileBottomSheet";

/** group: "home" | "prep" (draft prep) | "season" (in-season) | "office" (league-wide). */
export const HUB_SUBVIEWS = [
  { id: "home", label: "Home", shortLabel: "Home", hint: "Action center", group: "home" },
  { id: "value", label: "Players", shortLabel: "Players", hint: "Prices", group: "prep" },
  { id: "room", label: "Draft", shortLabel: "Draft", hint: "Live auction", group: "prep" },
  { id: "week", label: "This Week", shortLabel: "Week", hint: "Lineup decisions", group: "season" },
  { id: "roster", label: "My team", shortLabel: "My team", hint: "Your contracts", group: "season" },
  { id: "rosters", label: "Rosters", shortLabel: "Rosters", leagueOnly: true, hint: "All teams", group: "season" },
  { id: "planner", label: "Cap", shortLabel: "Cap", hint: "Cap & cuts", group: "season" },
  { id: "trades", label: "Trades", shortLabel: "Trades", leagueOnly: true, hint: "Propose & accept", group: "season" },
  { id: "rules", label: "Rules", shortLabel: "Rules", hint: "League policy", group: "office" },
  {
    id: "office",
    label: "Roster management",
    shortLabel: "Manage",
    leagueOnly: true,
    commissionerOnly: true,
    hint: "League-wide contracts and access",
    group: "office",
  },
  { id: "insights", label: "Insights", shortLabel: "Insights", leagueOnly: true, hint: "Talking points", group: "office" },
];

const GROUP_LABELS = { home: "", prep: "Draft", season: "Team", office: "League" };

function filterSubviews(hubContext) {
  const inLeague = hubContext?.mode === "league" || Boolean(hubContext?.league_id);
  return HUB_SUBVIEWS.filter((v) => {
    if (v.commissionerOnly && !hubContext?.is_commissioner) return false;
    if (v.leagueOnly && !inLeague) return false;
    return true;
  });
}

export default function HubSubnav({ subView, hubContext, onNavigate, mobileLayout = false }) {
  const navRef = useRef(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const visible = useMemo(() => filterSubviews(hubContext), [hubContext]);
  const groups = useMemo(() => {
    const out = [];
    visible.forEach((item) => {
      let group = out.find((entry) => entry.id === item.group);
      if (!group) {
        group = { id: item.group, label: GROUP_LABELS[item.group], items: [] };
        out.push(group);
      }
      group.items.push(item);
    });
    return out;
  }, [visible]);

  React.useEffect(() => {
    const active = navRef.current?.querySelector(".app-section-subnav-btn.active");
    active?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [subView, visible.length]);

  const tabButton = (v) => (
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
  );

  return (
    <>
      <div className="hub-subnav-row">
        <nav
          ref={navRef}
          className="app-section-subnav app-section-subnav--hub"
          role="tablist"
          aria-label="Fantasy"
        >
          {mobileLayout
            ? visible.map(tabButton)
            : groups.map((group) => (
              <div className={`hub-subnav-group hub-subnav-group--${group.id}`} key={group.id} role="presentation">
                {group.label && (
                  <span className="hub-subnav-group-label" aria-hidden="true">{group.label}</span>
                )}
                <span className="hub-subnav-group-tabs" role="presentation">
                  {group.items.map(tabButton)}
                </span>
              </div>
            ))}
        </nav>
        {mobileLayout && visible.length > 5 ? (
          <button
            type="button"
            className="hub-subnav-picker-btn"
            aria-label="All Fantasy tabs"
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
        title="Fantasy sections"
        className="app-mobile-sheet-hub-tabs"
      >
        <div className="app-mobile-sheet-list">
          {visible.map((v, i) => {
            const newGroup = i === 0 || visible[i - 1].group !== v.group;
            return (
              <React.Fragment key={v.id}>
                {newGroup && (
                  <p className="app-mobile-sheet-group">{GROUP_LABELS[v.group] || "Home"}</p>
                )}
                <button
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
              </React.Fragment>
            );
          })}
        </div>
      </MobileBottomSheet>
    </>
  );
}
