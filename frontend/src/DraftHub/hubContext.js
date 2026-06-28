/** Resolve hub context from React state or last workspace payload. */
export function effectiveHubContext(hubContext, workspace) {
  return hubContext ?? workspace?.hub_context ?? null;
}
