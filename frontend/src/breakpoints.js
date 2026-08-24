/** Shared mobile breakpoint — keep in sync with styles.css @media (max-width: 768px). */
export const MOBILE_MAX = 768;

/** Stay mobile until the viewport is clearly past 768 so a scrollbar cannot loop layouts. */
export const MOBILE_HYSTERESIS_PX = 32;

export const MOBILE_EXIT_MAX = MOBILE_MAX + MOBILE_HYSTERESIS_PX;

export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_MAX}px)`;

export const DESKTOP_MIN = MOBILE_MAX + 1;

export const DESKTOP_MEDIA_QUERY = `(min-width: ${DESKTOP_MIN}px)`;

export function nextMobileLayout(wasMobile, viewportWidth) {
  const width = Number(viewportWidth);
  if (!Number.isFinite(width)) return Boolean(wasMobile);
  if (wasMobile) return width <= MOBILE_EXIT_MAX;
  return width <= MOBILE_MAX;
}
