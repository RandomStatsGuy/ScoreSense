import { dfsPoolCoverage, DFS_WORKFLOW_COPY as C } from "./dfsToolPresentation.js";

const id = p => String(p.player_id ?? "");
const fields = ["dfs_id", "Player", "Position", "Team", "Opponent", "salary", "Projected Points", "Low (P10)", "High (P90)", "projection_source", "Injury Status", "on_bye"];
const value = v => v == null ? null : v;
export function poolVersion(pool) {
  // Exact input content, rather than a timestamp that can advance without a change.
  return JSON.stringify(pool.map(p => [id(p), ...fields.map(k => value(p[k]))]).sort((a, b) => a[0].localeCompare(b[0])));
}
export function countUniqueLineups(lineups) {
  return new Set(lineups.map(entry => {
    const captain = entry.lineup.find(p => ["CPT", "MVP"].includes(p.slot));
    return JSON.stringify([captain ? id(captain) : null, entry.lineup.filter(p => p !== captain).map(id).sort()]);
  })).size;
}
export function previewPoolUpdate(previous, incoming, { fromVersion = 0, source = "live", capturedAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(incoming?.players) || !Array.isArray(incoming?.salaries || [])) throw new Error(C.invalidPool);
  const before = new Map(previous.map(p => [id(p), p]));
  const after = new Map();
  incoming.players.forEach(p => {
    if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error(C.invalidPool);
    if (!id(p) || after.has(id(p))) throw new Error(C.repeatedPoolIdentity);
    after.set(id(p), p);
  });
  const changes = [];
  [...new Set([...before.keys(), ...after.keys()])].forEach(key => {
    const a = before.get(key), b = after.get(key);
    const changed = fields.filter(k => JSON.stringify(value(a?.[k])) !== JSON.stringify(value(b?.[k])));
    if (!a || !b || changed.length) changes.push({ id: key, name: b?.Player || a?.Player || key, kind: !a ? "added" : !b ? "removed" : "changed", fields: changed,
      before: a ? Object.fromEntries(fields.map(k => [k, value(a[k])])) : null,
      after: b ? Object.fromEntries(fields.map(k => [k, value(b[k])])) : null });
  });
  return { version: 1, fromVersion, toVersion: fromVersion + 1, source, capturedAt,
    beforeKey: poolVersion(previous), afterKey: poolVersion(incoming.players), changes };
}

/** Independent capability states; missing research inputs cannot masquerade as legal/illegal entries. */
export function workspaceCapabilities({ pool = [], salaries = [], isDfs = true, template = null, assignmentError = "", prelockConfirmed = false, assigned = 0, selected = 0, exportState = null } = {}) {
  const coverage = dfsPoolCoverage(pool);
  const identities = pool.length > 0 && pool.every(p => id(p)) && new Set(pool.map(id)).size === pool.length;
  const eligible = isDfs ? pool.filter(p => p.salary != null) : pool;
  const salaryIds = eligible.map(p => p.dfs_id);
  const catalogLoaded = identities && (!isDfs || (salaries.length > 0 && eligible.length > 0 && salaryIds.every(value => typeof value === "string" && /^\d+$/.test(value)) && new Set(salaryIds).size === salaryIds.length));
  return {
    identity: catalogLoaded ? "available" : "missing",
    forecasts: !coverage.available.length ? "missing" : coverage.missing.length ? "partial" : "available",
    roles: "unavailable", joint: "unavailable", field: "unavailable", returns: "unavailable", lateSwap: "unavailable",
    entries: !template ? "missing" : assignmentError ? "blocked" : !prelockConfirmed || assigned !== selected || !selected ? "review" : "ready",
    acceptance: "unconfirmed", history: exportState?.syncStatus || "unsaved",
  };
}

export function solverEvidence(selection) {
  if (!selection) return null;
  // Report only returned evidence. A bounded candidate pool is never all-lineup optimality.
  return { requested: selection.requested_count ?? null, selected: selection.selected_count ?? null,
    unique: selection.unique_count ?? null, candidates: selection.candidate_count ?? null,
    status: selection.solver_status || "unknown", runtime: selection.runtime_seconds ?? selection.elapsed_seconds ?? null,
    bound: selection.solver_bound ?? null, gap: selection.solver_gap ?? null,
    violations: selection.violations || [], objective: selection.objective || selection.objective_mode || null };
}
