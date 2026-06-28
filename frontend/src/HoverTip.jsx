import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useCoarsePointer from "./useCoarsePointer";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function computeTipPosition(rect) {
  const x = clamp(rect.left + rect.width / 2, 140, window.innerWidth - 140);
  const belowY = rect.bottom + 10;
  const aboveY = rect.top - 10;
  const preferAbove = belowY > window.innerHeight - 120;
  const y = preferAbove ? aboveY : belowY;
  return { x, y, above: preferAbove };
}

/**
 * Accessible hover/focus tooltip rendered in a portal (avoids clipping + native title styling).
 */
export default function HoverTip({
  content,
  children,
  className = "",
  as = "span",
  variant = "dark",
  ...rest
}) {
  const triggerRef = useRef(null);
  const [tip, setTip] = useState(null);
  const coarse = useCoarsePointer();

  const show = useCallback(() => {
    if (!content) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTip(computeTipPosition(rect));
  }, [content]);

  const hide = useCallback(() => setTip(null), []);

  const toggleTouch = useCallback(
    (event) => {
      if (!coarse || !content) return;
      event.preventDefault();
      event.stopPropagation();
      setTip((current) => {
        if (current) return null;
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return null;
        return computeTipPosition(rect);
      });
    },
    [coarse, content],
  );

  useEffect(() => {
    if (!coarse || !tip) return undefined;
    const onPointerDown = (event) => {
      if (triggerRef.current?.contains(event.target)) return;
      setTip(null);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setTip(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [coarse, tip]);

  const Tag = as;
  const popoverClass =
    variant === "light"
      ? "hover-tip-popover hover-tip-popover-light"
      : "hover-tip-popover hover-tip-popover-dark";
  const touchOpen = coarse && Boolean(tip);

  return (
    <>
      <Tag
        ref={triggerRef}
        className={`hover-tip-trigger${touchOpen ? " is-touch-open" : ""} ${className}`.trim()}
        onMouseEnter={coarse ? undefined : show}
        onMouseLeave={coarse ? undefined : hide}
        onFocus={show}
        onBlur={coarse ? undefined : hide}
        onClick={toggleTouch}
        aria-expanded={touchOpen ? "true" : undefined}
        {...rest}
      >
        {children}
      </Tag>
      {tip &&
        createPortal(
          <div
            className={`${popoverClass}${tip.above ? " hover-tip-popover-above" : ""}`}
            style={{ left: tip.x, top: tip.y }}
            role="tooltip"
          >
            {typeof content === "string" ? (
              <div className="hover-tip-body">{content}</div>
            ) : (
              content
            )}
          </div>,
          document.body
        )}
    </>
  );
}

/**
 * Recharts tooltip content rendered in a fixed portal so it stays readable over dark charts.
 */
export function ChartPortalTooltip({ active, payload, coordinate, chartRef, children }) {
  if (!active || !payload?.length || !chartRef?.current) return null;

  const rect = chartRef.current.getBoundingClientRect();
  const rawX = rect.left + (coordinate?.x ?? rect.width / 2);
  const rawY = rect.top + (coordinate?.y ?? rect.height / 2);
  const x = clamp(rawX, 140, window.innerWidth - 140);
  const y = clamp(rawY - 12, 80, window.innerHeight - 80);

  return createPortal(
    <div
      className="hover-tip-popover hover-tip-popover-dark hover-tip-popover-chart hover-tip-popover-above"
      style={{ left: x, top: y }}
      role="tooltip"
    >
      {children}
    </div>,
    document.body
  );
}

export function TipTitle({ children }) {
  return <div className="hover-tip-title">{children}</div>;
}

export function TipLine({ children, className = "" }) {
  return <div className={`hover-tip-line ${className}`.trim()}>{children}</div>;
}
