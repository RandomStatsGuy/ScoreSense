import React from "react";
import { PROJECTIONS_TABS, TOOLS_TABS } from "../appNavigation";
import { interceptAppNav } from "../appNavLink";
import { buildAppPath } from "../routes";

/** Desktop destinations share the compact row used by the Fantasy header. */
export default function ProductSubnav({ view, active, seasonMode, onNavigate }) {
  const tabs = view === "projections" ? PROJECTIONS_TABS : TOOLS_TABS;
  return (
    <nav className="app-section-subnav app-section-subnav--flat" aria-label={view === "projections" ? "Projection type" : "Tools"}>
      {tabs.map(tab => (
        <a
          key={tab.id}
          href={buildAppPath(view === "projections"
            ? { view, projectionsTab: tab.id, seasonMode }
            : { view, toolsTab: tab.id })}
          className={`app-section-subnav-btn${active === tab.id ? " active" : ""}`}
          aria-current={active === tab.id ? "page" : undefined}
          onClick={event => interceptAppNav(event, () => onNavigate(tab.id))}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}
