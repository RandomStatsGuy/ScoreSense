/**
 * Pick the side of the trigger an anchored menu opens on and how tall it may be.
 * Rects are viewport coordinates. `obstacles` are fixed chrome (bottom nav, chat
 * launcher) that paints above page content and horizontally overlaps the menu.
 */
export function menuPlacement({ trigger, panelHeight, viewportHeight, obstacles = [], gap = 4, margin = 8 }) {
  let ceiling = margin;
  let floor = viewportHeight - margin;
  for (const rect of obstacles) {
    if (rect.bottom <= trigger.top) ceiling = Math.max(ceiling, rect.bottom + margin);
    else if (rect.top >= trigger.bottom) floor = Math.min(floor, rect.top - margin);
  }
  const below = Math.max(0, floor - trigger.bottom - gap);
  const above = Math.max(0, trigger.top - gap - ceiling);
  if (panelHeight <= below || below >= above) return { side: "below", maxHeight: below };
  return { side: "above", maxHeight: above };
}
