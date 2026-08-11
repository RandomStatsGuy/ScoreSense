import React, { useEffect, useRef, useState } from "react";
import { sortIndicator } from "./valueSheetUtils";

/** Sortable column header shared by hub tables. */
export function SortTh({ label, col, sortKey, sortDir, onSort, className = "", title }) {
  const active = sortKey === col;
  return (
    <th
      className={`sortable-header${active ? " sort-active" : ""} ${className}`.trim()}
      onClick={() => onSort(col)}
      title={title}
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
    >
      {label}
      <span className="sort-indicator" aria-hidden="true"> {sortIndicator(sortKey, sortDir, col)}</span>
    </th>
  );
}

export function HubPage({ className = "", children }) {
  return (
    <section className={`hub-page panel wide hub-panel${className ? ` ${className}` : ""}`}>
      {children}
    </section>
  );
}

export function HubPageMeta({ children }) {
  if (!children) return null;
  return <p className="hub-page-meta">{children}</p>;
}

export function HubStatGrid({ children, className = "" }) {
  return <div className={`hub-stat-grid${className ? ` ${className}` : ""}`}>{children}</div>;
}

export function HubStatCard({ label, value, sub, tone = "default" }) {
  return (
    <div className={`hub-stat-card hub-stat-card--${tone}`}>
      <span className="hub-stat-label">{label}</span>
      <strong className="hub-stat-value">{value}</strong>
      {sub ? <span className="hub-stat-sub">{sub}</span> : null}
    </div>
  );
}

export function rosterAlertVariant(message) {
  const text = String(message || "");
  if (/too many/i.test(text)) return "danger";
  if (/need/i.test(text)) return "info";
  return "warn";
}

export function HubAlertStack({ children }) {
  if (!children) return null;
  return <div className="hub-alert-stack">{children}</div>;
}

export function HubAlert({ variant = "warn", children, action }) {
  return (
    <div className={`hub-alert hub-alert--${variant}`} role="status">
      <span className="hub-alert-text">{children}</span>
      {action ? <span className="hub-alert-action">{action}</span> : null}
    </div>
  );
}

export function HubSection({ title, hint, children, className = "" }) {
  return (
    <section className={`hub-section${className ? ` ${className}` : ""}`}>
      {(title || hint) && (
        <header className="hub-section-head">
          {title ? <h3 className="hub-section-title">{title}</h3> : null}
          {hint ? <p className="hub-section-hint">{hint}</p> : null}
        </header>
      )}
      <div className="hub-section-body">{children}</div>
    </section>
  );
}

export function HubToolbar({ children, className = "" }) {
  return <div className={`hub-toolbar hub-toolbar-form${className ? ` ${className}` : ""}`}>{children}</div>;
}

export function HubTableCard({ children, className = "" }) {
  return <div className={`hub-table-card${className ? ` ${className}` : ""}`}>{children}</div>;
}

export function HubFilterScroll({ children, className = "" }) {
  return <div className={`hub-filter-scroll${className ? ` ${className}` : ""}`}>{children}</div>;
}

export function HubFilterGroup({ label, children, className = "", inline = false }) {
  return (
    <div
      className={`hub-filter-group${inline ? " hub-filter-group--inline" : ""}${className ? ` ${className}` : ""}`}
    >
      {label ? (
        <span className={`hub-filter-label${inline ? " hub-filter-label--inline" : ""}`}>{label}</span>
      ) : null}
      {inline ? children : <HubFilterScroll>{children}</HubFilterScroll>}
    </div>
  );
}

export function HubFilterChip({
  active = false,
  onClick,
  children,
  className = "",
  style,
  accentColor,
  title,
  compact = false,
}) {
  const classes = [
    "filter-chip",
    active ? "filter-chip--active" : "",
    compact ? "filter-chip--compact" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const chipStyle =
    accentColor && active
      ? {
          ...style,
          borderColor: accentColor,
          boxShadow: `0 0 0 1px ${accentColor}40, inset 0 1px 0 rgba(255, 255, 255, 0.06)`,
        }
      : style;

  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      style={chipStyle}
      title={title}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

export function HubFilterMenu({ label, value, options, onChange, className = "" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const hoverCapable = useRef(
    typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches,
  );
  const selected = options.find((opt) => opt.id === value);
  const display = selected?.label ?? value;

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = (id) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div
      ref={ref}
      className={`hub-filter-menu${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}
      onMouseEnter={() => {
        if (hoverCapable.current) setOpen(true);
      }}
      onMouseLeave={() => {
        if (hoverCapable.current) setOpen(false);
      }}
    >
      <button
        type="button"
        className="hub-filter-menu-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${display}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="hub-filter-menu-kind">{label}</span>
        <span className="hub-filter-menu-value">{display}</span>
        <span className="hub-filter-menu-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="hub-filter-menu-panel" role="listbox" aria-label={label}>
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="option"
              aria-selected={value === opt.id}
              className={`hub-filter-menu-option${value === opt.id ? " is-active" : ""}`}
              onClick={() => pick(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function HubSegmentNav({ tabs, active, onChange, ariaLabel = "Sections" }) {
  return (
    <nav className="hub-segment-nav" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={`hub-segment-nav-btn${active === tab.id ? " active" : ""}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
