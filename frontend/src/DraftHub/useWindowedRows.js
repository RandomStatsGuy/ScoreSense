import { useCallback, useEffect, useRef, useState } from "react";

export const DEFAULT_ROW_HEIGHT = 44;
export const AVAILABLE_ROW_HEIGHT = 52;
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
  root = "element",
} = {}) {
  const [node, setNode] = useState(null);
  const [range, setRange] = useState({ start: 0, end: Math.min(count, WINDOW_AFTER) });
  const scrollerRef = useCallback((el) => {
    setNode(el);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setRange({ start: 0, end: count });
      return undefined;
    }
    const update = () => {
      if (root === "page") {
        if (!node) return;
        const rect = node.getBoundingClientRect();
        setRange(windowRange(
          count,
          Math.max(0, -rect.top),
          window.innerHeight,
          rowHeight,
          overscan,
        ));
        return;
      }
      if (!node) return;
      setRange(windowRange(count, node.scrollTop, node.clientHeight, rowHeight, overscan));
    };
    update();
    if (root === "page") {
      window.addEventListener("scroll", update, { passive: true });
      window.addEventListener("resize", update);
      const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
      if (node) observer?.observe(node);
      return () => {
        window.removeEventListener("scroll", update);
        window.removeEventListener("resize", update);
        observer?.disconnect();
      };
    }
    if (!node) return undefined;
    node.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(node);
    return () => {
      node.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [count, rowHeight, overscan, enabled, node, root]);

  return { scrollerRef, range };
}

/** Window rows against the page scroll so a nested table scroller is not needed. */
export function usePageWindowedRows(count, {
  rowHeight = DEFAULT_ROW_HEIGHT,
  overscan = DEFAULT_OVERSCAN,
  enabled = true,
} = {}) {
  const rootRef = useRef(null);
  const [range, setRange] = useState({ start: 0, end: Math.min(count, WINDOW_AFTER) });

  useEffect(() => {
    if (!enabled) {
      setRange({ start: 0, end: count });
      return undefined;
    }
    let frame = 0;
    const measure = () => {
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const next = windowRange(
        count,
        Math.max(0, -rect.top),
        window.innerHeight,
        rowHeight,
        overscan,
      );
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
  }, [count, rowHeight, overscan, enabled]);

  return { rootRef, range };
}
