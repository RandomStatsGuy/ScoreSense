/** Complete, non-overlapping scoring bands. No tier has a player-count limit. */
export const PROJECTION_TIERS = Object.freeze(['S', 'A', 'B', 'C', 'D', 'F']);

export function projectionValue(value) {
  if (value == null || typeof value === 'boolean' || typeof value === 'object'
      || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function projectionTier(value) {
  const points = projectionValue(value);
  if (points == null) return 'unknown';
  if (points >= 24) return 'S';
  if (points >= 18) return 'A';
  if (points >= 12) return 'B';
  if (points >= 9) return 'C';
  if (points > 6) return 'D';
  return 'F'; // Includes exactly six, zero, and every negative projection.
}

/** Preserve every input occurrence, its original row, and its sort within a tier. */
export function groupProjectionRows(rows, getValue, getStatus = () => null) {
  const groups = new Map([...PROJECTION_TIERS, 'inactive', 'left', 'unknown'].map(id => [id, []]));
  for (const row of rows || []) {
    const status = getStatus(row);
    const id = status === 'inactive' || status === 'left' ? status : projectionTier(getValue(row));
    groups.get(id).push(row);
  }
  return [...groups].filter(([, items]) => items.length).map(([id, items]) => ({id, rows:items}));
}

/** Fixed, measured row heights + explicit header offsets keep the F-tier tail reachable. */
export function projectionTierLayout(groups, rowHeight = 80, headerHeight = 64) {
  const entries = [];
  let offset = 0, rowIndex = 0;
  for (const group of groups) {
    entries.push({kind:'tier', group, key:`tier:${group.id}`, offset, height:headerHeight});
    offset += headerHeight;
    for (const row of group.rows) {
      entries.push({kind:'player', row, key:`player:${rowIndex}`, rowIndex:rowIndex++, offset, height:rowHeight});
      offset += rowHeight;
    }
  }
  return {entries, height:offset};
}

export function projectionTierWindow(layout, startPixel, endPixel) {
  const {entries, height} = layout;
  const first = (predicate) => {
    let low = 0, high = entries.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (predicate(entries[mid])) high = mid;
      else low = mid + 1;
    }
    return low;
  };
  const start = first(entry => entry.offset + entry.height > Math.max(0, startPixel));
  const end = Math.max(start, first(entry => entry.offset >= endPixel));
  const slice = entries.slice(start, end);
  return {entries:slice, top:slice[0]?.offset ?? height,
    bottom:slice.length ? height - slice.at(-1).offset - slice.at(-1).height : 0};
}

export function remainingGameProjection(row, points) {
  const games = projectionValue(row?.['Games Remaining']);
  const total = projectionValue(points);
  return games != null && games > 0 && total != null ? total / games : null;
}
