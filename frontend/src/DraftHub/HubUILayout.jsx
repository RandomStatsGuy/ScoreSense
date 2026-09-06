import React, { useEffect, useRef, useState } from "react";
import HoverTip from "../HoverTip";

/** Sortable column header shared by hub tables. */
export function SortTh({ label, sub, col, sortKey, sortDir, onSort, className = "", title, tip }) {
  const active = sortKey === col;
  const tipContent = tip || title;
  const classes = `sortable-header${active ? " sort-active" : ""}${tipContent ? " col-tip" : ""} ${className}`.trim();
  const ariaSort = active ? (sortDir === "asc" ? "ascending" : "descending") : "none";
  const indicator = active ? (
    <span className="sort-indicator" data-dir={sortDir} aria-hidden="true" />
  ) : null;
  const body = (
    <span className="sortable-header-stack">
      <span className="sortable-header-label">
        {label}
        {indicator}
      </span>
      {sub ? <span className="sortable-header-sub">{sub}</span> : null}
    </span>
  );

  if (tipContent) {
    return (
      <HoverTip
        as="th"
        scope="col"
        content={tipContent}
        className={classes}
        onClick={() => onSort(col)}
        aria-sort={ariaSort}
      >
        {body}
      </HoverTip>
    );
  }

  return (
    <th
      scope="col"
      className={classes}
      onClick={() => onSort(col)}
      aria-sort={ariaSort}
    >
      {body}
    </th>
  );
}

export function HubPage({ className = "", children, style }) {
  return (
    <section className={`hub-page panel wide hub-panel${className ? ` ${className}` : ""}`} style={style}>
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

export function HubAlert({ variant = "warn", children, action, live, role }) {
  const resolvedRole = role || (variant === "danger" ? "alert" : "status");
  const resolvedLive = live || (resolvedRole === "alert" ? "assertive" : "polite");
  return (
    <div
      className={`hub-alert hub-alert--${variant}`}
      role={resolvedRole}
      aria-live={resolvedLive}
    >
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

export const HubPageSticky = React.forwardRef(function HubPageSticky({ children, className = "" }, ref) {
  return (
    <div ref={ref} className={`hub-page-sticky${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
});

export function HubLoadingSkeleton({ label = "Loading", rows = 3 }) {
  return (
    <div className="hub-loading-skeleton" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="hub-loading-skeleton-block" />
      ))}
    </div>
  );
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
  disabled = false,
  exclusive = false,
  ...rest
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
      role={exclusive ? "radio" : undefined}
      aria-checked={exclusive ? active : undefined}
      aria-pressed={exclusive ? undefined : active}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  );
}

export function HubFilterMenu({ label, value, options, onChange, className = "", disabled = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const hoverCapable = useRef(
    typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches,
  );
  const selected = options.find((opt) => String(opt.id) === String(value));
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
      className={`hub-filter-menu${open ? " is-open" : ""}${disabled ? " is-disabled" : ""}${className ? ` ${className}` : ""}`}
      onMouseEnter={() => {
        if (!disabled && hoverCapable.current) setOpen(true);
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
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
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
              key={String(opt.id) || "empty"}
              type="button"
              role="option"
              aria-selected={String(value) === String(opt.id)}
              className={`hub-filter-menu-option${value === opt.id ? " is-active" : ""}${opt.detail ? " has-detail" : ""}`}
              onClick={() => pick(opt.id)}
            >
              <span className="hub-filter-menu-option-label">{opt.label}</span>
              {opt.detail ? (
                <span className="hub-filter-menu-option-detail">{opt.detail}</span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function HubSegmentNav({ tabs, active, onChange, ariaLabel = "Sections" }) {
  return (
    <nav className="hub-segment-nav" aria-label={ariaLabel}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-current={active === tab.id ? "true" : undefined}
          className={`hub-segment-nav-btn${active === tab.id ? " active" : ""}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

export function chipToneClass(tone) {
  if (tone === "readonly") return " is-readonly";
  if (tone === "caution") return " is-caution";
  if (tone === "ready") return " is-ready";
  return "";
}

export function HubExperienceHero({
  eyebrow,
  heading,
  support,
  chip,
  chipTone = "active",
  chipAs = "chip",
  compact = false,
  aside = null,
  children,
}) {
  const statusChip = chip && chipAs === "status";
  const pillChip = chip && chipAs !== "status" && !aside;
  return (
    <header className={`hub-experience-hero${compact ? " is-compact" : ""}${aside ? " has-aside" : ""}`}>
      <div className="hub-experience-hero-main">
        {eyebrow ? <span className="hub-experience-eyebrow">{eyebrow}</span> : null}
        {heading ? <h1>{heading}</h1> : null}
        {support ? <p>{support}</p> : null}
        {statusChip ? (
          <p className={`hub-experience-hero-status${chipToneClass(chipTone)}`} role="status">
            {chip}
          </p>
        ) : null}
        {children}
      </div>
      {aside ? <div className="hub-experience-hero-aside">{aside}</div> : null}
      {pillChip ? (
        <span className={`hub-experience-chip${chipToneClass(chipTone)}`}>
          {chip}
        </span>
      ) : null}
    </header>
  );
}

export function HubExperienceLayout({ children, summary, summaryLabel = "At a glance", footer }) {
  return (
    <div className={`hub-experience-layout${footer ? " has-footer" : ""}`}>
      <div className="hub-experience-main">{children}</div>
      {summary ? (
        <aside className="hub-experience-summary" aria-label={summaryLabel}>
          {summary}
        </aside>
      ) : null}
      {footer ? <div className="hub-experience-footer">{footer}</div> : null}
    </div>
  );
}

function SummaryItems({ items = [] }) {
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <dl>
      {items.map((item) => {
        const valueClass = [
          item.tone ? `hub-experience-summary-value--${item.tone}` : "",
          item.muted ? "is-quiet" : "",
        ].filter(Boolean).join(" ");
        const value = item.href ? (
          <a className="btn-link" href={item.href}>{item.value}</a>
        ) : item.onClick ? (
          <button type="button" className="btn-link" onClick={item.onClick}>{item.value}</button>
        ) : item.value;
        return (
          <div
            key={item.id || item.label}
            className={item.muted ? "is-quiet" : undefined}
          >
            <dt>{item.label}</dt>
            <dd className={valueClass || undefined}>{value}</dd>
            {item.hint ? (
              <p className="hub-experience-summary-hint">{item.hint}</p>
            ) : null}
          </div>
        );
      })}
    </dl>
  );
}

export function HubExperienceSummary({
  eyebrow = "At a glance",
  title,
  subtitle,
  items = [],
  groups,
  note,
  children,
  action,
  actionFirst = false,
  status,
}) {
  const actionNode = action && actionFirst ? (
    <div className="hub-experience-summary-action is-first">{action}</div>
  ) : action;
  const blocks = Array.isArray(groups) && groups.length
    ? groups
    : (items.length ? [{ id: "main", items }] : []);
  return (
    <>
      {actionFirst ? actionNode : null}
      <div>
        {eyebrow ? <span className="hub-experience-eyebrow">{eyebrow}</span> : null}
        {title ? <h3>{title}</h3> : null}
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {blocks.map((block) => (
        <div key={block.id || block.heading || "main"} className="hub-experience-summary-block">
          {block.heading ? (
            <p className="hub-experience-summary-group">{block.heading}</p>
          ) : null}
          <SummaryItems items={block.items} />
        </div>
      ))}
      {note ? <p className="hub-experience-summary-note">{note}</p> : null}
      {children}
      {!actionFirst ? actionNode : null}
      {status}
    </>
  );
}
