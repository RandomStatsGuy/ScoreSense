/**
 * One roster mutation per player. PATCH /roster already accepts contract_type
 * with salary / years / status — do not also POST /roster/contract-type.
 */

export function buildRosterWriteRequest(change = {}) {
  const playerId = String(change.playerId || "").trim();
  if (!playerId) return null;
  const slotId = Number(change.rosterSlotId);
  const hasSlot = Number.isFinite(slotId) && slotId > 0;
  if (change.drop) {
    const body = { player_id: playerId };
    if (hasSlot) body.roster_slot_id = slotId;
    return {
      path: "/api/hub/roster",
      method: "DELETE",
      body,
    };
  }
  const body = { player_id: playerId };
  if (hasSlot) body.roster_slot_id = slotId;
  const ctype = String(change.contractType || "").trim().toLowerCase();
  if (ctype) body.contract_type = ctype;
  if (change.salary != null && Number.isFinite(Number(change.salary))) {
    body.salary = Number(change.salary);
  }
  if (change.years != null && Number.isFinite(Number(change.years))) {
    body.contract_years = Number(change.years);
  }
  if (change.rosterStatus) body.roster_status = change.rosterStatus;
  if (change.note) body.note = change.note;
  if (Object.keys(body).length <= 1) return null;
  return {
    path: "/api/hub/roster",
    method: "PATCH",
    body,
  };
}

/** One request per player when a commissioner tray holds type + salary together. */
export function buildPendingRosterWrites(pendingByPlayer, { note } = {}) {
  return Object.entries(pendingByPlayer || {})
    .map(([playerId, change]) => buildRosterWriteRequest({
      playerId,
      note,
      ...(change || {}),
    }))
    .filter(Boolean);
}

export function sendRosterWrite(fetcher, change) {
  const req = buildRosterWriteRequest(change);
  if (!req || typeof fetcher !== "function") return Promise.resolve(null);
  return fetcher(req.path, {
    method: req.method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req.body),
  });
}
