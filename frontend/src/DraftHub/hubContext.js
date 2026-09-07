/** Resolve hub context from React state or last workspace payload. */
export function effectiveHubContext(hubContext, workspace) {
  return hubContext ?? workspace?.hub_context ?? null;
}

/** Saved Fantasy focus — never a practice / test_mode room. */
export function focusedLeagueId(hubContext) {
  if (hubContext?.test_mode) return "";
  if (hubContext?.mode !== "league") return "";
  return hubContext?.league_id || "";
}

/**
 * Page fetches may include another room's hub_context. Only Switch league,
 * workspace boot, or a live join/create may replace the strip.
 */
export function shouldApplyHubContext(incoming, current, { force = false } = {}) {
  if (!incoming || typeof incoming !== "object") return false;
  if (incoming.test_mode) return false;
  if (force) return true;
  const currentId = current?.league_id || "";
  const incomingId = incoming.league_id || "";
  if (!currentId) return incoming.mode !== "solo";
  if (incoming.mode === "solo") return false;
  return Boolean(incomingId) && incomingId === currentId;
}
