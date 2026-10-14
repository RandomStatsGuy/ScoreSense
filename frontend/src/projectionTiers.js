/** Complete, non-overlapping scoring bands. No tier has a player-count limit. */
export const PROJECTION_TIERS = Object.freeze(['S', 'A', 'B', 'C', 'D', 'F']);

export function projectionValue(value) {
  if (value == null || typeof value === 'boolean' || typeof value === 'object'
      || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Reviewed 2026-10-14 against FantasyPros consensus and ESPN's 2026 guide.
// These are fixed design benchmarks, never fitted to the current ScoreSense slate.
// Provenance, scoring assumptions, and annual normalization: docs/PROJECTION_TIERS.md.
export const PROJECTION_TIER_PROFILES = Object.freeze({
  weekly: Object.freeze({
    QB: Object.freeze({S:21, A:18, B:15, C:12, F:6}),
    RB: Object.freeze({S:20, A:16, B:12, C:9, F:6}),
    WR: Object.freeze({S:19, A:15, B:12, C:9, F:6}),
    TE: Object.freeze({S:14, A:11, B:9, C:7.5, F:6}),
  }),
  season: Object.freeze({
    QB: Object.freeze({S:350, A:300, B:250, C:200, F:100}),
    RB: Object.freeze({S:340, A:270, B:205, C:150, F:100}),
    WR: Object.freeze({S:320, A:255, B:205, C:150, F:100}),
    TE: Object.freeze({S:240, A:190, B:150, C:125, F:100}),
  }),
});

const canonicalPosition = value => {
  const key=String(value ?? '').trim().toUpperCase();
  return Object.hasOwn(PROJECTION_TIER_PROFILES.weekly,key)?key:null;
};

/** Real WR/TE identity wins over the combined board's `wr` route/model key. */
export function projectionPosition(row, boardPosition) {
  const values=[row?.Position,row?.position].filter(value=>value!=null&&String(value).trim());
  for(const value of values) {
    const position=canonicalPosition(value);
    if(position)return position;
  }
  // An explicitly unsupported/malformed position must not inherit a misleading tier.
  if(values.length)return null;
  const fallback=canonicalPosition(boardPosition);
  return fallback==='WR'?null:fallback;
}

export function projectionTier(value, position, horizon='weekly') {
  const points=projectionValue(value);
  const profile=PROJECTION_TIER_PROFILES[horizon]?.[canonicalPosition(position)];
  if(points==null||!profile)return 'unknown';
  for(const tier of ['S','A','B','C'])if(points>=profile[tier])return tier;
  return points>profile.F?'D':'F'; // F has no lower bound, including zero/negative values.
}

/** Preserve every occurrence, its original row, and its sort within a tier. */
export function groupProjectionRows(rows, getValue, getStatus=()=>null,
  getPosition=row=>projectionPosition(row), horizon='weekly') {
  const groups=new Map([...PROJECTION_TIERS,'bye','inactive','left','unknown'].map(id=>[id,[]]));
  for(const row of rows||[]) {
    const status=getStatus(row);
    const id=status==='bye'||status==='inactive'||status==='left'?status:projectionTier(getValue(row),getPosition(row),horizon);
    groups.get(id).push(row);
  }
  return [...groups].filter(([,items])=>items.length).map(([id,items])=>({id,rows:items}));
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
