import React from "react";
import { interceptAppNav } from "../appNavLink";

export default function DesktopPrimaryHeader({ productName, studioName, sections, view, pathForSection, onNavigate, children }) {
  return <div className="app-header-row app-header-row-primary app-header-desktop-only">
    <div className="app-header-brand"><p className="app-title">{productName}</p><span className="app-header-studio">{studioName}</span></div>
    <nav className="app-header-nav" aria-label="Sections">{sections.map(item => <a key={item.id} href={pathForSection(item.id)} className={`tab view-tab ${view === item.id ? "active" : ""}`} aria-current={view === item.id ? "page" : undefined} onClick={event => interceptAppNav(event, () => onNavigate(item.id))}>{item.label}</a>)}</nav>
    <div className="app-header-actions">{children}</div>
  </div>;
}
