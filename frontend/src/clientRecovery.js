// /api is excluded from navigation fallbacks by the deployed offline worker.
// Serve the new shell there, then restore the destination before React starts.
export function clientRecoveryUrl(location = window.location) {
  const returnTo = `${location.pathname}${location.search || ""}${location.hash || ""}`;
  return `/api/client-recovery?${new URLSearchParams({ return_to: returnTo })}`;
}

export function recoverClientPage(location = window.location) {
  location.replace(clientRecoveryUrl(location));
}
