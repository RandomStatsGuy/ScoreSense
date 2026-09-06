/** Detect whether a background /api/refresh job has finished after a click. */

const CLOCK_SKEW_MS = 5_000;
export const REFRESH_POLL_MS = 3_000;
export const REFRESH_TIMEOUT_MS = 45 * 60 * 1000;

export function refreshHasFinished(status, cutoffMs) {
  if (!status || typeof status !== "object") return false;
  if (status.status === "never_run" || status.status === "running") return false;
  if (status.status === "error") {
    throw new Error(status.error || "Refresh failed");
  }
  const doneAt = Date.parse(status.completed_at);
  if (Number.isFinite(doneAt)) {
    return doneAt >= cutoffMs - CLOCK_SKEW_MS;
  }
  if (status.status === "completed") {
    const startedAt = Date.parse(status.started_at);
    if (Number.isFinite(startedAt)) {
      return startedAt >= cutoffMs - CLOCK_SKEW_MS;
    }
    return true;
  }
  return false;
}

export async function waitForRefreshComplete({
  fetchStatus,
  cutoffMs,
  intervalMs = REFRESH_POLL_MS,
  timeoutMs = REFRESH_TIMEOUT_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const status = await fetchStatus();
    if (refreshHasFinished(status, cutoffMs)) return status;
    if (Date.now() >= deadline) {
      throw new Error(
        "Refresh is still running. The projections date updates when the rebuild finishes.",
      );
    }
    await sleep(intervalMs);
  }
}
