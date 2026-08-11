import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useCoarsePointer from "./useCoarsePointer";

const FLIP_BELOW_ROW_INDEX = 3;

/** Spread ÷ projection at or above this marks a boom/bust (high-variance) projection. */
const VOLATILITY_RATIO_HIGH = 1.25;

function QuantileTooltipContent({ p10, p50, p90, spread, volatile, title, subtitle }) {
  return (
    <div className="quantile-tooltip-body">
      <span className="quantile-tooltip-title">{title || "Likely scoring range"}</span>
      <div className="quantile-tooltip-grid">
        <span className="quantile-tooltip-label">Floor</span>
        <span className="quantile-tooltip-value">{p10.toFixed(1)}</span>
        <span className="quantile-tooltip-label quantile-tooltip-label-mid">Projected</span>
        <span className="quantile-tooltip-value quantile-tooltip-value-mid">{p50.toFixed(1)}</span>
        <span className="quantile-tooltip-label">Ceiling</span>
        <span className="quantile-tooltip-value quantile-tooltip-value-high">{p90.toFixed(1)}</span>
      </div>
      <span className="quantile-tooltip-sub">
        {subtitle || `${spread} pt spread (floor to ceiling)`}
        {volatile ? " · boom/bust" : ""}
      </span>
    </div>
  );
}

export default function QuantileBar({
  p10,
  p50,
  p90,
  scaleMax,
  rowIndex = 0,
  showVolatility = false,
  title,
  subtitle,
}) {
  const barRef = useRef(null);
  const [tip, setTip] = useState(null);
  const coarse = useCoarsePointer();
  const max = scaleMax > 0 ? scaleMax : 1;
  const left = Math.max(0, Math.min(100, (p10 / max) * 100));
  const mid = Math.max(0, Math.min(100, (p50 / max) * 100));
  const right = Math.max(0, Math.min(100, (p90 / max) * 100));
  const spread = (p90 - p10).toFixed(1);
  const volatile =
    showVolatility && p50 > 0 && (p90 - p10) / p50 >= VOLATILITY_RATIO_HIGH;
  const preferBelow = rowIndex < FLIP_BELOW_ROW_INDEX;

  const showTip = useCallback(() => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = rect.left + rect.width / 2;
    const y = preferBelow ? rect.bottom + 12 : rect.top - 12;
    setTip({ x, y, below: preferBelow });
  }, [preferBelow]);

  const hideTip = useCallback(() => setTip(null), []);

  const toggleTouch = useCallback(
    (event) => {
      if (!coarse) return;
      event.preventDefault();
      event.stopPropagation();
      setTip((current) => {
        if (current) return null;
        const rect = barRef.current?.getBoundingClientRect();
        if (!rect) return null;
        const x = rect.left + rect.width / 2;
        const y = preferBelow ? rect.bottom + 12 : rect.top - 12;
        return { x, y, below: preferBelow };
      });
    },
    [coarse, preferBelow],
  );

  useEffect(() => {
    if (!coarse || !tip) return undefined;
    const onPointerDown = (event) => {
      if (barRef.current?.contains(event.target)) return;
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

  const touchOpen = coarse && Boolean(tip);

  return (
    <>
      <div
        ref={barRef}
        className={`quantile-bar quantile-bar-interactive${volatile ? " quantile-bar-volatile" : ""}${touchOpen ? " is-touch-open" : ""}`}
        onMouseEnter={coarse ? undefined : showTip}
        onMouseLeave={coarse ? undefined : hideTip}
        onFocus={showTip}
        onBlur={coarse ? undefined : hideTip}
        onClick={toggleTouch}
        tabIndex={0}
        aria-expanded={touchOpen ? "true" : undefined}
        aria-label={`Floor ${p10.toFixed(1)}, projected ${p50.toFixed(1)}, ceiling ${p90.toFixed(1)}`}
      >
        <div className="quantile-track" aria-hidden="true" />
        <div
          className="quantile-range"
          style={{ left: `${left}%`, width: `${Math.max(right - left, 0.5)}%` }}
          aria-hidden="true"
        />
        <div className="quantile-cap quantile-cap-low" style={{ left: `${left}%` }} aria-hidden="true" />
        <div className="quantile-cap quantile-cap-high" style={{ left: `${right}%` }} aria-hidden="true" />
        <div className="quantile-median" style={{ left: `${mid}%` }} aria-hidden="true" />
      </div>
      {tip &&
        createPortal(
          <div
            className={`quantile-tooltip quantile-tooltip-fixed ${tip.below ? "quantile-tooltip-below" : "quantile-tooltip-above"}`}
            style={{ left: tip.x, top: tip.y }}
            role="tooltip"
          >
            <QuantileTooltipContent
              p10={p10}
              p50={p50}
              p90={p90}
              spread={spread}
              volatile={volatile}
              title={title}
              subtitle={subtitle}
            />
          </div>,
          document.body
        )}
    </>
  );
}
