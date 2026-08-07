import React from "react";

/**
 * Shimmer placeholder primitive. Use instead of "Loading…" text.
 * Renders a single shimmer block; compose several for lists/cards.
 */
export function Skeleton({ width, height = "1rem", radius, className = "", style, ...rest }) {
  return (
    <span
      className={`ui-skeleton ${className}`.trim()}
      style={{
        width: width || "100%",
        height,
        borderRadius: radius || "var(--radius-sm)",
        ...style,
      }}
      aria-hidden="true"
      {...rest}
    />
  );
}

/** Vertical stack of skeleton lines to approximate a text block or list. */
export function SkeletonLines({ lines = 3, gap = "0.5rem", className = "" }) {
  return (
    <span
      className={`ui-skeleton-lines ${className}`.trim()}
      style={{ display: "flex", flexDirection: "column", gap }}
      aria-hidden="true"
    >
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "60%" : "100%"} />
      ))}
    </span>
  );
}

export default Skeleton;
