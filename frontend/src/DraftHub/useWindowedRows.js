import { useCallback, useEffect, useState } from "react";

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
