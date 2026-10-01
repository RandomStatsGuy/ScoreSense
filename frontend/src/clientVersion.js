import { hasPendingClientWrite } from "./clientActivity.js";
const CHECK_INTERVAL_MS = 60_000;
const SERVICE_WORKER_WAIT_MS = 10_000;
const RELOAD_ATTEMPT_KEY = "scoresense-build-reload-attempt";

// These destinations can contain a live session or edits that have not been saved.
export function isProtectedReloadPath(pathname) {
  const path = String(pathname || "").replace(/\/$/, "") || "/";
  return path === "/hub/draft"
    || path === "/tools/mock-draft"
    || path === "/hub/rules"
    || path === "/hub/trades"
    || path === "/hub/roster"
    || path === "/hub/cap"
    || path === "/hub/free-agents"
    || path.startsWith("/hub/roster-management")
    || path.startsWith("/hub/office")
    || path === "/tools/dfs"
    || path.startsWith("/account")
    || path.startsWith("/admin");
}

export function canReload() {
  return document.visibilityState === "visible"
    && !isProtectedReloadPath(window.location.pathname)
    && !hasPendingClientWrite()
    && !document.querySelector('[role="dialog"], dialog[open], [aria-busy="true"]')
    && !document.activeElement?.matches("input, textarea, select, [contenteditable='true']");
}

async function waitForUpdatedServiceWorker() {
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return true;
  const currentController = navigator.serviceWorker.controller;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return true;

  let timeout;
  let onChange;
  const changed = new Promise((resolve) => {
    onChange = () => resolve(true);
    navigator.serviceWorker.addEventListener("controllerchange", onChange);
    timeout = setTimeout(() => resolve(false), SERVICE_WORKER_WAIT_MS);
  });
  try {
    await registration.update();
    if (navigator.serviceWorker.controller !== currentController) return true;
    // The worker may have updated before this check. In that case the old page
    // still needs a reload, but there will be no new controllerchange event.
    if (!registration.installing && !registration.waiting) return true;
    return await changed;
  } finally {
    clearTimeout(timeout);
    navigator.serviceWorker.removeEventListener("controllerchange", onChange);
  }
}

export function startClientVersionWatcher() {
  const currentVersion = document.querySelector('meta[name="scoresense-build"]')?.content;
  if (!currentVersion) return () => {};

  let checking = false;
  let assetFailure = false;
  const check = async () => {
    if (checking || !canReload()) return;
    checking = true;
    try {
      const response = await fetch("/api/client-version", { cache: "no-store" });
      if (!response.ok) return;
      const { version } = await response.json();
      if (!version || (version === currentVersion && !assetFailure) || !canReload()) return;
      const previous = JSON.parse(sessionStorage.getItem(RELOAD_ATTEMPT_KEY) || "null");
      const attempts = previous?.version === version ? previous.count : 0;
      // One same-build recovery handles a transient CSS/import fetch failure.
      // Never loop offline or substitute new code under an old asset hash.
      if (version === currentVersion && attempts >= 1) return;
      if (attempts >= 3 || (attempts && Date.now() - previous.at < 30_000)) return;
      if (!(await waitForUpdatedServiceWorker()) || !canReload()) return;
      sessionStorage.setItem(RELOAD_ATTEMPT_KEY, JSON.stringify({ version, count: attempts + 1, at: Date.now() }));
      window.location.reload();
    } catch {
      // A deployment or network interruption is transient; the next check retries.
    } finally {
      checking = false;
    }
  };

  const onVisible = () => { if (document.visibilityState === "visible") void check(); };
  const onFocus = () => { void check(); };
  const onAssetFailure = () => { assetFailure = true; void check(); };
  const timer = window.setInterval(check, CHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onFocus);
  window.addEventListener("vite:preloadError", onAssetFailure);
  void check();
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("vite:preloadError", onAssetFailure);
  };
}
