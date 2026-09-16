// Per-tab, per-league browsing preferences. Never persist roster payloads.
export const DEFAULT_ROSTER_STATE = Object.freeze({
  view: "deals", teamId: "", query: "", position: "", value: "all",
  sort: "difference", page: 0, selectedKey: null, closed: false,
});
const key = leagueId => `fantasy:rosters:v1:${leagueId}`;
export function normalizeRosterState(input) {
  const state = { ...DEFAULT_ROSTER_STATE };
  if (!input || typeof input !== "object") return state;
  for (const field of ["teamId", "query", "position"]) {
    if (typeof input[field] === "string") state[field] = input[field];
  }
  for (const [field, allowed] of Object.entries({
    view: ["deals", "teams"], value: ["all", "below", "above"],
    sort: ["difference", "salary", "name"],
  })) if (allowed.includes(input[field])) state[field] = input[field];
  if (Number.isSafeInteger(input.page) && input.page >= 0) state.page = input.page;
  if (typeof input.selectedKey === "string") state.selectedKey = input.selectedKey;
  state.closed = input.closed === true;
  return state;
}
export function readRosterState(leagueId, storage) {
  try {
    return normalizeRosterState(JSON.parse((storage ?? window.sessionStorage).getItem(key(leagueId))));
  } catch { return { ...DEFAULT_ROSTER_STATE }; }
}
export function writeRosterState(leagueId, state, storage) {
  if (!leagueId) return;
  try { (storage ?? window.sessionStorage).setItem(key(leagueId), JSON.stringify(normalizeRosterState(state))); }
  catch { /* Browsing still works when storage is unavailable. */ }
}
