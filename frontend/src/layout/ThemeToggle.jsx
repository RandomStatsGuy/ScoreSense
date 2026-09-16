import React, { useSyncExternalStore } from "react";
import { THEME_COPY } from "../themePresentation";

const subscribe = (listener) => window.scoreSenseTheme.subscribe(listener);
const snapshot = () => window.scoreSenseTheme.getSnapshot();

export default function ThemeToggle({ compact = false, menu = false }) {
  const theme = useSyncExternalStore(subscribe, snapshot, () => "dark");
  const next = theme === "dark" ? "light" : "dark";
  return <button type="button"
    className={`theme-toggle${compact ? " theme-toggle--compact" : ""}${menu ? " app-mobile-sheet-item" : " btn-ghost"}`}
    aria-label={THEME_COPY[next]} title={THEME_COPY[next]}
    onClick={() => window.scoreSenseTheme.set(next)}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      {next === "light" ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></> : <path d="M20.5 14.5A9 9 0 0 1 9.5 3.5a9 9 0 1 0 11 11Z" />}
    </svg>
    {!compact && <span>{THEME_COPY[next]}</span>}
  </button>;
}
