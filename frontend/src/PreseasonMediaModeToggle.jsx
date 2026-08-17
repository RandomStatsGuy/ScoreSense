import React from "react";
import {
  MEDIA_MODE,
  MEDIA_MODE_SHORT_LABELS,
  hasPreseasonMediaModes,
  isPreseasonMediaMode,
  modesAvailable,
  normalizeMediaMode,
  shouldShowPreseasonMediaModeToggle,
} from "./mediaContext";

const PRESEASON_OPTIONS = [
  MEDIA_MODE.OUTLOOK,
  MEDIA_MODE.WEEK1_PULSE,
];

/**
 * SCORE-34 — explicit Outlook vs Week 1 pulse selector.
 * Older commentary stays on HistoricalMediaOptIn (never auto-shown as current).
 * Both modes stay clickable so the UI can request them even when a bucket is empty.
 */
export default function PreseasonMediaModeToggle({
  value = null,
  media = null,
  week = null,
  modesAvailable: modesAvailableProp = null,
  onChange,
  disabled = false,
  className = "",
}) {
  const flags = modesAvailableProp || modesAvailable(media);
  const show =
    shouldShowPreseasonMediaModeToggle({ media, week })
    || hasPreseasonMediaModes({ modes_available: flags });
  if (!show) return null;

  const selected = isPreseasonMediaMode(value) ? normalizeMediaMode(value) : null;
  const activeMode = selected || (isPreseasonMediaMode(media?.mode) ? media.mode : null);

  return (
    <div
      className={`preseason-media-mode-toggle header-segment ${className}`.trim()}
      role="tablist"
      aria-label="Preseason media mode"
    >
      {PRESEASON_OPTIONS.map((mode) => {
        const available = Boolean(flags[mode]);
        const isActive = activeMode === mode;
        return (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`header-segment-tab preseason-media-mode-tab${isActive ? " active" : ""}${available ? "" : " preseason-media-mode-tab--empty"}`}
            disabled={disabled}
            title={
              available
                ? MEDIA_MODE_SHORT_LABELS[mode]
                : `${MEDIA_MODE_SHORT_LABELS[mode]} (no cached items yet — still requestable)`
            }
            onClick={() => {
              if (typeof onChange !== "function") return;
              onChange(mode);
            }}
          >
            {MEDIA_MODE_SHORT_LABELS[mode]}
          </button>
        );
      })}
    </div>
  );
}
