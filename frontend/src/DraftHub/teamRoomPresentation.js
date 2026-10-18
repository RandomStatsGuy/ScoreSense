import { startSurname } from "./weekBoard.js";

/** Totals never substitute for missing forecasts. */
export function roomProjectionTotal(players = []) {
  if (!players.length || players.some((p) => !p.player_id || p.projection == null || !Number.isFinite(Number(p.projection)))) return null;
  return players.reduce((sum, p) => sum + Number(p.projection), 0);
}

const hasProjection = (p) => p?.projection != null && Number.isFinite(Number(p.projection));

/** October 17 approval: an owner's drop or tap saves the lineup in native leagues; Sleeper leagues preview. */
export function roomSavesLineup(data) {
  return Boolean(data?.can_edit && data.lineup_host !== "sleeper");
}

/** Slot, lock, scope and ownership rules shared by saves and previews; forecasts are not required to start someone. */
export function canMoveRoomPlayer(data, starter, bench, slotIndex) {
  return Boolean(data?.can_edit && ["pregame", "live"].includes(data.state)
    && Number(data.week) >= Number(data.current_week ?? data.week)
    && starter && bench?.player_id && starter.player_id !== bench.player_id
    && starter.can_manage !== false && bench.can_manage !== false
    && starter.kickoff_available !== false && bench.kickoff_available !== false
    && starter.lineup_locked === false && bench.lineup_locked === false
    && Array.isArray(bench.preview_slots) && bench.preview_slots.includes(slotIndex));
}

/** Previews compare projections, so the incoming player needs a forecast. */
export function canPreviewRoomSwap(data, starter, bench, slotIndex) {
  return canMoveRoomPlayer(data, starter, bench, slotIndex) && hasProjection(bench);
}

/** What a drop or tap may do in this room: save (native) or preview (Sleeper). */
export function canPlaceRoomPlayer(data, starter, bench, slotIndex) {
  return roomSavesLineup(data) ? canMoveRoomPlayer(data, starter, bench, slotIndex) : canPreviewRoomSwap(data, starter, bench, slotIndex);
}

/** Locker state while a bench player is held: lit with the change, dimmed, or locked. */
export function roomHeldState(data, starter, bench, slotIndex) {
  if (!bench?.player_id || !starter) return null;
  if (canPlaceRoomPlayer(data, starter, bench, slotIndex)) {
    return { fit: true, locked: false, delta: hasProjection(bench) && hasProjection(starter) ? Number(bench.projection) - Number(starter.projection) : null };
  }
  return { fit: false, delta: null, locked: Boolean(starter.player_id && (starter.lineup_locked || starter.kickoff_available === false)) };
}

/** Best eligible starter this bench player beats by at least a point, if any. */
export function roomBenchEdge(data, bench, starters = []) {
  if (!hasProjection(bench)) return null;
  let best = null;
  starters.forEach((starter, index) => {
    if (!hasProjection(starter) || !canPlaceRoomPlayer(data, starter, bench, index)) return;
    const delta = Number(bench.projection) - Number(starter.projection);
    if (delta >= 1 && (!best || delta > best.delta)) best = { starter, index, delta, surname: startSurname(starter.name) || starter.name };
  });
  return best;
}

/** The room after a saved swap, before the server copy arrives. Eligibility metadata is positional, so it still holds. */
export function roomAfterSwap(data, starterId, benchId) {
  const index = data.starters.findIndex((p) => p.player_id === starterId);
  const incoming = data.bench.find((p) => p.player_id === benchId);
  if (index < 0 || !incoming) return data;
  const outgoing = data.starters[index];
  return {
    ...data,
    starters: data.starters.map((p, i) => (i === index ? { ...incoming, slot: outgoing.slot } : p)),
    bench: data.bench.map((p) => (p.player_id === benchId ? { ...outgoing, slot: null } : p)),
  };
}

/** Projected margin against the opponent; unknown when either total is incomplete. */
export function roomOpponentGap(total, opponent) {
  if (total == null || opponent?.projection == null || !Number.isFinite(Number(opponent.projection))) return null;
  return Number(total) - Number(opponent.projection);
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
