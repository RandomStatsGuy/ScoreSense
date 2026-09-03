import React, { useId, useState } from "react";

/**
 * Mobile projection card.
 * Header expands details unless `selecting` is on, then it toggles compare.
 * Optional `aside` stays outside that button so Details stays reachable.
 */
export default function MobilePlayerCard({
  name,
  titleNode,
  meta,
  rank,
  heroValue,
  heroLabel = "",
  heroSub,
  heroMuted = false,
  badge,
  expanded,
  defaultOpen = false,
  selected = false,
  className = "",
  unavailable = false,
  selecting = false,
  onSelect,
  aside = null,
  actions,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const detailsId = useId();
  const hasExpand = Boolean(expanded);

  const toggle = () => {
    if (hasExpand) setOpen((v) => !v);
  };

  const handleHeaderClick = () => {
    if (selecting && onSelect) {
      onSelect();
      return;
    }
    onSelect?.();
    toggle();
  };

  return (
    <article
      className={`mobile-player-card${selected ? " mobile-player-card--selected" : ""}${unavailable ? " mobile-player-card--unavailable" : ""}${open ? " mobile-player-card--open" : ""} ${className}`.trim()}
    >
      <div className="mobile-player-card-top">
        <button
          type="button"
          className="mobile-player-card-header"
          onClick={handleHeaderClick}
          aria-expanded={hasExpand ? open : undefined}
          aria-controls={hasExpand ? detailsId : undefined}
          disabled={!hasExpand && !onSelect}
        >
          <div className="mobile-player-card-main">
            <div className="mobile-player-card-name-row">
              {rank != null ? (
                <span className="mobile-player-card-rank" aria-label={`Rank ${rank}`}>
                  {rank}
                </span>
              ) : null}
              {titleNode || <span className="mobile-player-card-name">{name}</span>}
              {badge}
            </div>
            {meta ? <span className="mobile-player-card-meta">{meta}</span> : null}
          </div>
          <div className={`mobile-player-card-hero${heroMuted ? " mobile-player-card-hero--muted" : ""}`}>
            <span className="mobile-player-card-hero-value">{heroValue}</span>
            {heroLabel ? <span className="mobile-player-card-hero-label">{heroLabel}</span> : null}
            {heroSub ? <span className="mobile-player-card-hero-sub">{heroSub}</span> : null}
            {hasExpand ? (
              <span className="mobile-player-card-chevron" aria-hidden="true">
                {open ? "▴" : "▾"}
              </span>
            ) : null}
          </div>
        </button>
        {aside ? <div className="mobile-player-card-aside">{aside}</div> : null}
      </div>
      {hasExpand && open ? (
        <div className="mobile-player-card-body" id={detailsId}>
          {expanded}
          {actions ? <div className="mobile-player-card-actions">{actions}</div> : null}
        </div>
      ) : null}
    </article>
  );
}
