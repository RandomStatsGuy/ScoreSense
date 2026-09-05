import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  WEEKLY_WINDOW_INITIAL,
  WEEKLY_WINDOW_OVERSCAN,
  WEEKLY_WINDOW_ROW_PX,
  weeklyWindowRange,
} from "./weeklyBoardFilter.js";

/**
 * Window a long ranking list against the page scroll so off-screen cards
 * are not mounted. Expanded rows can grow; overscan covers the jitter.
 */
export default function WindowedList({
  items,
  renderItem,
  estimate = WEEKLY_WINDOW_ROW_PX,
  overscan = WEEKLY_WINDOW_OVERSCAN,
  initialCount = WEEKLY_WINDOW_INITIAL,
  className = "",
}) {
  const rootRef = useRef(null);
  const [range, setRange] = useState(() => ({
    start: 0,
    end: Math.min(items.length, initialCount),
  }));

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const next = weeklyWindowRange({
        count: items.length,
        scrollTop: Math.max(0, -rect.top),
        viewportHeight: window.innerHeight,
        rowHeight: estimate,
        overscan,
      });
      setRange((prev) => (
        prev.start === next.start && prev.end === next.end ? prev : next
      ));
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [estimate, items.length, overscan]);

  const slice = useMemo(
    () => items.slice(range.start, range.end),
    [items, range.end, range.start],
  );
  const topPad = range.start * estimate;
  const bottomPad = Math.max(0, items.length - range.end) * estimate;

  return (
    <div ref={rootRef} className={className}>
      {topPad > 0 ? <div style={{ height: topPad }} aria-hidden="true" /> : null}
      {slice.map((item, index) => renderItem(item, range.start + index))}
      {bottomPad > 0 ? <div style={{ height: bottomPad }} aria-hidden="true" /> : null}
    </div>
  );
}
