/** Shared mobile breakpoint — keep in sync with styles.css @media (max-width: 768px). */
export const MOBILE_MAX = 768;

export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_MAX}px)`;

export const DESKTOP_MIN = MOBILE_MAX + 1;

export const DESKTOP_MEDIA_QUERY = `(min-width: ${DESKTOP_MIN}px)`;
