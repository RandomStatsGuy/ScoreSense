/** Projection previews never write a lineup or substitute for missing forecasts. */
export function roomProjectionTotal(players = []) {
  if (!players.length || players.some((p) => !p.player_id || p.projection == null || !Number.isFinite(Number(p.projection)))) return null;
  return players.reduce((sum, p) => sum + Number(p.projection), 0);
}

export function canPreviewRoomSwap(data, starter, bench, slotIndex) {
  return Boolean(data.can_edit && ["pregame", "live"].includes(data.state)
    && Number(data.week) >= Number(data.current_week ?? data.week)
    && starter && bench?.player_id && starter.player_id !== bench.player_id
    && starter.can_manage !== false && bench.can_manage !== false
    && starter.kickoff_available !== false && bench.kickoff_available !== false
    && starter.lineup_locked === false && bench.lineup_locked === false
    && Array.isArray(bench.preview_slots) && bench.preview_slots.includes(slotIndex)
    && bench.projection != null && Number.isFinite(Number(bench.projection)));
}

export function roomPreviewLineup(data, swaps = {}) {
  const all = [...data.starters, ...data.bench];
  const byId = new Map(all.filter((p) => p.player_id).map((p) => [p.player_id, p]));
  let count = 0;
  const starters = data.starters.map((p, index) => {
    const incoming = byId.get(swaps[index]);
    if (!canPreviewRoomSwap(data, p, incoming, index)) return p;
    count += 1;
    return { ...incoming, slot: p.slot };
  });
  const chosen = starters.map((p) => p.player_id).filter(Boolean);
  if (new Set(chosen).size !== chosen.length) return { starters: data.starters, bench: data.bench, count: 0 };
  const selected = new Set(chosen);
  const bench = all.filter((p) => p.player_id && !selected.has(p.player_id)).map((p) => p.slot ? { ...p, slot: null } : p);
  return { starters, bench, count };
}

export function roomPreviewScope(data) {
  return JSON.stringify([data.team.id, data.season, data.week, data.starters.map((p) => [p.player_id, p.slot])]);
}
