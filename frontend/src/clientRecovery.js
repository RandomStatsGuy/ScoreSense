// /api is excluded from navigation fallbacks by the deployed offline worker.
// Serve the new shell there, then restore the destination before React starts.
export function clientRecoveryUrl(location = window.location) {
  const returnTo = `${location.pathname}${location.search || ""}${location.hash || ""}`;
  return `/api/client-recovery?${new URLSearchParams({ return_to: returnTo })}`;
}

const RECOVERY_WAIT_MS = 3_000;
let recovering = null;

async function resetClientAssets(location) {
  const scope = new URL("/", location.href).href;
  const workerUrl = new URL("sw.js", scope).href;
  try {
    const registration = await globalThis.navigator?.serviceWorker?.getRegistration(scope);
    if (registration?.scope === scope && [registration.active, registration.waiting, registration.installing]
      .some(worker => worker?.scriptURL === workerUrl)) {
      await registration.unregister();
    }
  } catch {
    // A worker-storage failure must not prevent clearing the app's asset cache.
  }
  if (!globalThis.caches) return;
  const names = await caches.keys();
  await Promise.allSettled(names.filter(name => name === "scoresense-section-assets"
    || (name.startsWith("workbox-precache-") && name.endsWith(scope)))
    .map(name => caches.delete(name)));
}

// A fresh HTML shell can still request a broken response from the old worker's
// asset cache. Reset only our replaceable app files, after confirming the shell
// is reachable. Cookies, local/session storage, and saved league data stay intact.
export function recoverClientPage(location = window.location, destination = location, { shouldRecover = () => true } = {}) {
  if (!shouldRecover()) return Promise.resolve(false);
  if (recovering) return recovering;
  const url = clientRecoveryUrl(destination);
  recovering = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RECOVERY_WAIT_MS);
    try {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (!shouldRecover()) return false;
      if (response.ok) {
        let cleanupTimeout;
        try {
          await Promise.race([
            resetClientAssets(location),
            new Promise(resolve => { cleanupTimeout = setTimeout(resolve, RECOVERY_WAIT_MS); }),
          ]);
        } finally {
          clearTimeout(cleanupTimeout);
        }
      }
    } catch {
      // Storage may be unavailable or the connection interrupted. The network
      // recovery route remains usable without resetting any account state.
    } finally {
      clearTimeout(timeout);
    }
    if (!shouldRecover()) return false;
    location.replace(url);
    return true;
  })().finally(() => { recovering = null; });
  return recovering;
}
