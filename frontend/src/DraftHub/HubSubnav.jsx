import React, { useMemo, useRef, useState } from "react";
import MobileDestinationSheet from "../layout/MobileDestinationSheet";
import { MOBILE_CHROME_COPY } from "../layout/mobileChromePresentation";

/** group: "home" | "prep" (draft prep) | "season" (in-season) | "office" (league-wide). */
export const HUB_SUBVIEWS = [
  { id: "home", label: "Home", shortLabel: "Home", hint: "Action center", group: "home" },
  { id: "value", label: "Strategy", shortLabel: "Strategy", hint: "Star targets & prices", group: "prep" },
  { id: "room", label: "Draft", shortLabel: "Draft", hint: "Invite, schedule, live room", group: "prep" },
  { id: "week", label: "This Week", shortLabel: "Week", hint: "Lineup decisions", group: "season" },
  { id: "game", label: "Game center", shortLabel: "Game", leagueOnly: true, hint: "Your matchup, live", group: "season" },
  { id: "roster", label: "My team", shortLabel: "My team", hint: "Your contracts", group: "season" },
  { id: "available", label: "Free agents", shortLabel: "FA", hint: "Pickup board", group: "season" },
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
  { id: "insights", label: "Insights", shortLabel: "Insights", leagueOnly: true, hint: "League history", group: "office" },
];

export const HUB_GROUP_LABELS = { home: "Home", prep: "Draft", season: "Team", office: "League" };

export function filterHubSubviews(hubContext) {
  const inLeague = hubContext?.mode === "league" || Boolean(hubContext?.league_id);
  return HUB_SUBVIEWS.filter((v) => {
    if (v.commissionerOnly && !hubContext?.is_commissioner) return false;
    if (v.leagueOnly && !inLeague) return false;
    return true;
  });
}

export function hubDestinationGroups(hubContext) {
  const visible = filterHubSubviews(hubContext);
  const out = [];
  visible.forEach((item) => {
    let group = out.find((entry) => entry.id === item.group);
    if (!group) {
      group = { id: item.group, label: HUB_GROUP_LABELS[item.group], items: [] };
      out.push(group);
    }
    group.items.push(item);
  });
  return out;
}

export default function HubSubnav({
  subView,
  hubContext,
  onNavigate,
  mobileLayout = false,
  pickerOnly = false,
  pickerOpen: pickerOpenProp,
  onPickerOpenChange,
}) {
  const navRef = useRef(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = pickerOpenProp != null;
  const pickerOpen = controlled ? pickerOpenProp : internalOpen;
  const setPickerOpen = (next) => {
    if (!controlled) setInternalOpen(next);
    onPickerOpenChange?.(next);
  };
  const visible = useMemo(() => filterHubSubviews(hubContext), [hubContext]);
  const groups = useMemo(() => hubDestinationGroups(hubContext), [hubContext]);

  React.useEffect(() => {
    if (pickerOnly) return undefined;
    const active = navRef.current?.querySelector(".app-section-subnav-btn.active");
    active?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    return undefined;
  }, [subView, visible.length, pickerOnly]);

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

  const sheet = (
    <MobileDestinationSheet
      open={pickerOpen}
      onClose={() => setPickerOpen(false)}
      title={MOBILE_CHROME_COPY.fantasySheet}
      className="app-mobile-sheet-hub-tabs"
      groups={groups}
      active={subView}
      onSelect={(id) => {
        onNavigate(id);
        setPickerOpen(false);
      }}
    />
  );

  if (pickerOnly) return sheet;

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
                {group.id !== "home" && group.label && (
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
            aria-label={MOBILE_CHROME_COPY.goTo}
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
      {sheet}
    </>
  );
}
