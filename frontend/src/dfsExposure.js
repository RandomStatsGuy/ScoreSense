import { auditPortfolio, appendPortfolioBatch } from "./dfsPortfolio.js";
import { DFS_EXPOSURE_COPY as C } from "./dfsToolPresentation.js";

export function appearanceMaximum(value, unit = "percent") {
  if (String(value).trim() === "") return "";
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (unit === "percent" ? number > 100 : number > 150 || !Number.isInteger(number))) throw new Error(C.invalid);
  return unit === "percent" ? Math.floor(number * 150 / 100 + 1e-9) : number;
}

export function remainingAppearanceCounts(batches, limits, count, locked = [], current = null) {
  if (current && batches.length) appendPortfolioBatch(batches, current);
  const audit = auditPortfolio(batches, limits);
  if (audit.errors.length) throw new Error(audit.errors.join(" "));
  const usage = new Map(audit.players.map(p => [p.id, p.count]));
  const remaining = {};
  for (const [id, value] of Object.entries(limits)) {
    if (value == null || String(value).trim() === "") continue;
    const available = Math.max(0, Number(value) - (usage.get(id) || 0));
    if (locked.includes(id) && available < count) throw new Error(C.lockConflict(current?.salaryCatalog?.find(p => p.player_id === id)?.Player || id, available, count));
    remaining[id] = Math.min(count, available);
  }
  return remaining;
}

export function exposureRows(pool, batches, limits) {
  const audit = auditPortfolio(batches, limits);
  const rows = new Map(pool.map(p => [String(p.player_id), { id: String(p.player_id), player: p.Player, position: p.Position, team: p.Team, count: 0, percent: 0 }]));
  for (const p of audit.players) rows.set(p.id, { ...rows.get(p.id), ...p });
  for (const id of Object.keys(limits)) if (!rows.has(id)) rows.set(id, { id, player: id, count: 0, percent: 0 });
  return [...rows.values()].map(p => ({ ...p, max: limits[p.id] == null || String(limits[p.id]).trim() === "" ? null : Number(limits[p.id]) }))
    .sort((a, b) => b.count - a.count || a.player.localeCompare(b.player));
}
