import { useMemo, useSyncExternalStore } from "react";

/**
 * Chart colors, read from the theme's own CSS custom properties.
 *
 * Recharts needs real color strings — `var(--accent)` in an SVG presentation
 * attribute does not resolve — so the values are read off the document instead
 * of duplicated here. Nothing in this file is a color: a token that has not
 * loaded falls back to `currentColor`, which inherits the surrounding ink.
 *
 * Only one hue does identity work in any of these charts. A second series is
 * told apart by fill, size and a direct label, never by a second hue, because
 * the theme has one accent and it changes between light and dark.
 */
const TOKENS = {
  accent: "--accent",
  ink: "--text-primary",
  muted: "--text-muted",
  grid: "--border",
  surface: "--bg-elevated",
};

const subscribe = (listener) =>
  typeof window === "undefined" || !window.scoreSenseTheme
    ? () => {}
    : window.scoreSenseTheme.subscribe(listener);

const snapshot = () =>
  typeof window === "undefined" || !window.scoreSenseTheme
    ? "dark"
    : window.scoreSenseTheme.getSnapshot();

export function readChartTokens() {
  const fallback = { surface: "transparent" };
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") {
    return Object.fromEntries(
      Object.keys(TOKENS).map((name) => [name, fallback[name] || "currentColor"]),
    );
  }
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    Object.entries(TOKENS).map(([name, token]) => [
      name,
      style.getPropertyValue(token).trim() || fallback[name] || "currentColor",
    ]),
  );
}

/** Re-reads whenever the theme toggle fires, so charts repaint with the page. */
export default function useChartTokens() {
  const theme = useSyncExternalStore(subscribe, snapshot, () => "dark");
  return useMemo(() => readChartTokens(), [theme]);
}
