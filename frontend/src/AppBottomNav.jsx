import React from "react";
import { APP_SECTIONS } from "./appNavigation";
import { interceptAppNav } from "./appNavLink";

function NavIcon({ name }) {
  if (name === "projections") {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4 19V5M10 19V9M16 19V13M22 19V7"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (name === "hub") {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (name === "tools") {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="5" cy="12" r="1.75" fill="currentColor" />
      <circle cx="12" cy="12" r="1.75" fill="currentColor" />
      <circle cx="19" cy="12" r="1.75" fill="currentColor" />
    </svg>
  );
}

export default function AppBottomNav({ section, onSectionChange, onMoreOpen, hrefForSection }) {
  return (
    <nav className="app-bottom-nav" aria-label="Main">
      {APP_SECTIONS.map((item) => {
        const href = hrefForSection?.(item.id);
        const className = `app-bottom-nav-item${section === item.id ? " active" : ""}`;
        const body = (
          <>
            <span className="app-bottom-nav-icon">
              <NavIcon name={item.id} />
            </span>
            <span className="app-bottom-nav-label">{item.shortLabel}</span>
          </>
        );
        if (href) {
          return (
            <a
              key={item.id}
              href={href}
              className={className}
              aria-current={section === item.id ? "page" : undefined}
              aria-label={item.label}
              onClick={(event) => interceptAppNav(event, () => onSectionChange(item.id))}
            >
              {body}
            </a>
          );
        }
        return (
          <button
            key={item.id}
            type="button"
            className={className}
            aria-current={section === item.id ? "page" : undefined}
            onClick={() => onSectionChange(item.id)}
          >
            {body}
          </button>
        );
      })}
      <button
        type="button"
        className={`app-bottom-nav-item${section === "model" || section === "admin" ? " active" : ""}`}
        aria-label="More"
        onClick={onMoreOpen}
      >
        <span className="app-bottom-nav-icon">
          <NavIcon name="more" />
        </span>
        <span className="app-bottom-nav-label">More</span>
      </button>
    </nav>
  );
}
