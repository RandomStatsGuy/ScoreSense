import { useCallback, useEffect, useState } from "react";

export const DEFAULT_ROW_HEIGHT = 44;
export const DEFAULT_OVERSCAN = 12;
export const WINDOW_AFTER = 48;

export function windowRange(count, scrollTop, clientHeight, rowHeight, overscan) {
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visible = Math.ceil(clientHeight / rowHeight) + overscan * 2;
  return { start, end: Math.min(count, start + visible) };
}

export function useWindowedRows(count, {
  rowHeight = DEFAULT_ROW_HEIGHT,
  overscan = DEFAULT_OVERSCAN,
  enabled = true,
} = {}) {
  const [scroller, setScroller] = useState(null);
  const [range, setRange] = useState({ start: 0, end: Math.min(count, WINDOW_AFTER) });
  const scrollerRef = useCallback((node) => {
    setScroller(node);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setRange({ start: 0, end: count });
      return undefined;
    }
    if (!scroller) return undefined;
    const update = () => {
      setRange(windowRange(count, scroller.scrollTop, scroller.clientHeight, rowHeight, overscan));
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [count, rowHeight, overscan, enabled, scroller]);

  return { scrollerRef, range };
}
