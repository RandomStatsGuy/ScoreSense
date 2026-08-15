import React, { useEffect, useMemo, useRef, useState } from "react";
import MobileBottomSheet from "../layout/MobileBottomSheet";

/**
 * Hub nav items (SCORE-11).
 * Top-level: Home · Players · This Week · My Roster · Trades · League ▾ · Draft · Commissioner
 * League subgroup: League Rosters, My Cap, Insights
 */
export const HUB_SUBVIEWS = [
  { id: "setup", label: "Home", shortLabel: "Home", hint: "League home & setup", group: "home" },
  { id: "value", label: "Players", shortLabel: "Players", hint: "Prices", group: "core" },
  { id: "week", label: "This Week", shortLabel: "Week", hint: "Lineup decisions", group: "my" },
  { id: "roster", label: "My Roster", shortLabel: "Roster", hint: "Your contracts", group: "my" },
  { id: "trades", label: "Trades", shortLabel: "Trades", leagueOnly: true, hint: "Propose & accept", group: "action" },
  {
    id: "rosters",
    label: "League Rosters",
    shortLabel: "Rosters",
    leagueOnly: true,
    hint: "All teams",
    group: "league",
    parent: "league",
  },
  {
    id: "planner",
    label: "My Cap",
    shortLabel: "Cap",
    hint: "Cap & cuts",
    group: "league",
    parent: "league",
  },
  {
    id: "insights",
    label: "Insights",
    shortLabel: "Insights",
    leagueOnly: true,
    hint: "Spend & scoring",
    group: "league",
    parent: "league",
  },
  { id: "room", label: "Draft", shortLabel: "Draft", hint: "Live auction", group: "draft" },
  {
    id: "office",
    label: "Commissioner",
    shortLabel: "Commish",
    leagueOnly: true,
    hint: "Chat & commissioner tools",
    group: "commissioner",
  },
];

const GROUP_DIVIDER_BEFORE = new Set(["my", "action", "league", "draft", "commissioner"]);

function filterSubviews(hubContext) {
  const inLeague = hubContext?.mode === "league" || Boolean(hubContext?.league_id);
  return HUB_SUBVIEWS.filter((v) => {
    if (v.commissionerOnly && !hubContext?.is_commissioner) return false;
    if (v.leagueOnly && !inLeague) return false;
    return true;
  });
}

function byId(visible) {
  return Object.fromEntries(visible.map((v) => [v.id, v]));
}

function LeagueNavGroup({
  label,
  shortLabel,
  hint,
  items,
  activeChildId,
  onNavigate,
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const isActive = items.some((c) => c.id === activeChildId);
  const activeChild = items.find((c) => c.id === activeChildId);
  const triggerLabel = activeChild?.label || label;
  const triggerShort = activeChild?.shortLabel || shortLabel || label;

  const updateMenuPos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 6, left: r.left, minWidth: Math.max(r.width, 176) });
  };

  useEffect(() => {
    if (!open) return undefined;
    updateMenuPos();
    const onDoc = (e) => {
      if (!rootRef.current?.contains(e.target)
        && !e.target?.closest?.(".hub-nav-group-menu")) {
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReposition = () => updateMenuPos();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`nav-view-group hub-nav-group${open ? " is-open" : ""}${isActive ? " is-active" : ""}`}
    >
      <button
        ref={triggerRef}
        type="button"
        role="tab"
        aria-selected={isActive}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`app-section-subnav-btn nav-view-group-trigger${isActive ? " active" : ""}`}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          updateMenuPos();
          setOpen(true);
        }}
        title={hint}
      >
        <span className="app-section-subnav-label">
          {triggerLabel}
          <span className="hub-nav-group-caret" aria-hidden="true">▾</span>
        </span>
        <span className="app-section-subnav-label-short">
          {triggerShort}
          <span className="hub-nav-group-caret" aria-hidden="true">▾</span>
        </span>
      </button>
      {open && menuPos && (
        <div
          className="nav-view-group-menu hub-nav-group-menu hub-nav-group-menu--fixed"
          role="menu"
          style={{
            top: menuPos.top,
            left: menuPos.left,
            minWidth: menuPos.minWidth,
          }}
        >
          {items.map((child) => (
            <button
              key={child.id}
              type="button"
              role="menuitem"
              className={`tab nav-view-group-item${activeChildId === child.id ? " active" : ""}`}
              onClick={() => {
                onNavigate(child.id);
                setOpen(false);
              }}
            >
              {child.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function HubSubnav({ subView, hubContext, onNavigate, mobileLayout = false }) {
  const navRef = useRef(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const visible = useMemo(() => filterSubviews(hubContext), [hubContext]);
  const map = useMemo(() => byId(visible), [visible]);

  const topLevel = useMemo(() => {
    const entries = [];
    // Fixed SCORE-11 order; skip items filtered out (e.g. league-only when solo).
    const order = [
      { type: "item", id: "setup" },
      { type: "item", id: "value" },
      { type: "item", id: "week" },
      { type: "item", id: "roster" },
      { type: "item", id: "trades" },
      {
        type: "group",
        id: "league",
        label: "League",
        shortLabel: "League",
        hint: "Rosters, cap & insights",
        children: ["rosters", "planner", "insights"],
      },
      { type: "item", id: "room" },
      { type: "item", id: "office" },
    ];
    for (const entry of order) {
      if (entry.type === "item") {
        if (!map[entry.id]) continue;
        entries.push({ ...entry, view: map[entry.id] });
        continue;
      }
      const kids = entry.children.map((id) => map[id]).filter(Boolean);
      if (!kids.length) continue;
      entries.push({ ...entry, children: kids });
    }
    return entries;
  }, [map]);

  useEffect(() => {
    const active = navRef.current?.querySelector(
      ".app-section-subnav-btn.active, .hub-nav-group.is-active .nav-view-group-trigger",
    );
    active?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [subView, topLevel.length]);

  // Mobile sheet: flatten with League group header
  const sheetSections = useMemo(() => {
    const sections = [];
    for (const entry of topLevel) {
      if (entry.type === "item") {
        sections.push({ kind: "item", view: entry.view });
      } else {
        sections.push({ kind: "group", label: entry.label });
        entry.children.forEach((child) => {
          sections.push({ kind: "item", view: child, indented: true });
        });
      }
    }
    return sections;
  }, [topLevel]);

  return (
    <>
      <div className="hub-subnav-row">
        <nav
          ref={navRef}
          className="app-section-subnav app-section-subnav--hub"
          role="tablist"
          aria-label="League"
        >
          {topLevel.map((entry, i) => {
            const prev = topLevel[i - 1];
            const groupKey = entry.type === "item" ? entry.view.group : "league";
            const prevGroup = prev
              ? (prev.type === "item" ? prev.view.group : "league")
              : null;
            const showDivider = i > 0 && groupKey !== prevGroup && GROUP_DIVIDER_BEFORE.has(groupKey);

            return (
              <React.Fragment key={entry.type === "item" ? entry.id : entry.id}>
                {showDivider && (
                  <span
                    className="app-section-subnav-divider"
                    role="presentation"
                    aria-hidden="true"
                  />
                )}
                {entry.type === "item" ? (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={subView === entry.id}
                    className={`app-section-subnav-btn${subView === entry.id ? " active" : ""}`}
                    onClick={() => onNavigate(entry.id)}
                    title={entry.view.hint}
                  >
                    <span className="app-section-subnav-label">{entry.view.label}</span>
                    <span className="app-section-subnav-label-short">
                      {entry.view.shortLabel || entry.view.label}
                    </span>
                  </button>
                ) : (
                  <LeagueNavGroup
                    label={entry.label}
                    shortLabel={entry.shortLabel}
                    hint={entry.hint}
                    items={entry.children}
                    activeChildId={subView}
                    onNavigate={onNavigate}
                  />
                )}
              </React.Fragment>
            );
          })}
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
          {sheetSections.map((section, i) => {
            if (section.kind === "group") {
              return (
                <p key={`g-${section.label}-${i}`} className="app-mobile-sheet-group">
                  {section.label}
                </p>
              );
            }
            const v = section.view;
            return (
              <button
                key={v.id}
                type="button"
                className={`app-mobile-sheet-item app-mobile-sheet-item-subdued${
                  section.indented ? " app-mobile-sheet-item--nested" : ""
                }${subView === v.id ? " active" : ""}`}
                onClick={() => {
                  onNavigate(v.id);
                  setPickerOpen(false);
                }}
              >
                <span>{v.label}</span>
                <span className="chart-note">{v.hint}</span>
              </button>
            );
          })}
        </div>
      </MobileBottomSheet>
    </>
  );
}
