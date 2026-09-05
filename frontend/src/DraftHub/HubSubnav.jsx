import React, { useMemo, useRef, useState } from "react";
import MobileDestinationSheet from "../layout/MobileDestinationSheet";
import { MOBILE_CHROME_COPY, selectAndDismissDestination } from "../layout/mobileChromePresentation";
import { interceptAppNav } from "../appNavLink";
import { buildAppPath } from "../routes";
import LeagueOverflowLead from "./LeagueOverflowLead";

/** group: "home" | "prep" (draft prep) | "season" (in-season) | "office" (league-wide). */
export const HUB_SUBVIEWS = [
  { id: "home", label: "Home", shortLabel: "Home", hint: "What to do next", group: "home" },
  { id: "value", label: "Strategy", shortLabel: "Strategy", hint: "Who you take first", group: "prep" },
  { id: "room", label: "Draft", shortLabel: "Draft", hint: "Draft night and the room", group: "prep" },
  { id: "week", label: "This Week", shortLabel: "Week", hint: "Start or sit", group: "season" },
  { id: "vibes", label: "Vibes", shortLabel: "Vibes", hint: "One read per player today", group: "season" },
  { id: "game", label: "Game center", shortLabel: "Game", leagueOnly: true, hint: "Your matchup, live", group: "season" },
  { id: "roster", label: "My team", shortLabel: "My team", hint: "Your contracts", group: "season" },
  { id: "available", label: "Free agents", shortLabel: "FA", hint: "Who you can still add", group: "season" },
  { id: "rosters", label: "Rosters", shortLabel: "Rosters", leagueOnly: true, hint: "Overpays and cheap years across the league", group: "season" },
  { id: "planner", label: "Cap", shortLabel: "Cap", hint: "Bids, cuts, leftover cap", group: "season" },
  { id: "trades", label: "Trades", shortLabel: "Trades", leagueOnly: true, hint: "Cap-checked deals", group: "season" },
  { id: "rules", label: "Rules", shortLabel: "Rules", hint: "What new contracts cost", group: "office" },
  {
    id: "office",
    label: "Roster management",
    shortLabel: "Manage",
    leagueOnly: true,
    commissionerOnly: true,
    hint: "Contracts, members, access",
    group: "office",
  },
  { id: "insights", label: "Insights", shortLabel: "Insights", leagueOnly: true, hint: "Winners and spend", group: "office" },
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
    const active = navRef.current?.querySelector(".app-section-subnav-btn.active, .app-section-subnav-btn[aria-current='page']");
    active?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    return undefined;
  }, [subView, visible.length, pickerOnly]);

  const tabButton = (v) => (
    <a
      key={v.id}
      href={buildAppPath({ view: "hub", hubSubView: v.id })}
      className={`app-section-subnav-btn${subView === v.id ? " active" : ""}`}
      aria-current={subView === v.id ? "page" : undefined}
      aria-label={v.label}
      title={v.hint}
      aria-description={v.hint}
      onClick={(event) => interceptAppNav(event, () => onNavigate(v.id))}
    >
      <span className="app-section-subnav-label">{v.label}</span>
      <span className="app-section-subnav-label-short" aria-hidden="true">{v.shortLabel || v.label}</span>
    </a>
  );

  const sheet = (
    <MobileDestinationSheet
      open={pickerOpen}
      onClose={() => setPickerOpen(false)}
      title={MOBILE_CHROME_COPY.fantasySheet}
      className="app-mobile-sheet-hub-tabs"
      lead={(
        <LeagueOverflowLead
          hubContext={hubContext}
          onNavigate={onNavigate}
          onAfterAction={() => setPickerOpen(false)}
        />
      )}
      groups={groups}
      active={subView}
      onSelect={(id) => selectAndDismissDestination(id, onNavigate, () => setPickerOpen(false))}
    />
  );

  if (pickerOnly) return sheet;

  return (
    <>
      <div className="hub-subnav-row">
        <nav
          ref={navRef}
          className="app-section-subnav app-section-subnav--hub"
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
