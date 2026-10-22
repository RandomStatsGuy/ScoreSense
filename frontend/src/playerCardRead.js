/** A card owns one exact context, including every read during background recovery. */
export function pinPlayerCardContext(request, data) {
  return {
    ...request,
    season: request.season ?? data?.meta?.season,
    week: request.week ?? data?.meta?.week,
    position: request.position ?? data?.position,
  };
}

export function playerCardUrl(request) {
  const params = new URLSearchParams();
  for (const key of ["season", "week", "scope", "position"]) {
    if (request[key] != null && request[key] !== "") params.set(key, String(request[key]));
  }
  params.set("apply_injury_adjustments", request.applyInjuryAdjustments === false ? "false" : "true");
  return `/api/player/${encodeURIComponent(request.playerId)}/card?${params}`;
}

function waitForRecovery(delay, signal) {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, delay);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** Only an active server recovery can schedule another card read. */
export async function readPlayerCardWithRecovery({
  request, readCard, signal, onData, onRecovery, onError, onSettled,
  wait = waitForRecovery, now = Date.now, maxRefreshes = 15, maxDurationMs = 90_000,
}) {
  const started = now();
  let pinned = { ...request };
  let refreshes = 0;
  try {
    while (!signal.aborted) {
      const data = await readCard(pinned, signal);
      // Abort can happen while response.json() is still resolving.
      if (signal.aborted) return;
      pinned = pinPlayerCardContext(pinned, data);
      onData(data);
      const recovery = data?.meta?.recovery || { status: "idle" };
      onRecovery(recovery);
      if (!["queued", "running"].includes(recovery.status)) return;
      const requestedDelay = Number(recovery.retry_after_seconds);
      const delay = Math.max(1_000, Math.min(10_000, Number.isFinite(requestedDelay) && requestedDelay > 0 ? requestedDelay * 1_000 : 3_000));
      if (refreshes >= maxRefreshes || now() - started + delay > maxDurationMs) {
        onRecovery({ ...recovery, status: "timed_out" });
        return;
      }
      await wait(delay, signal);
      if (signal.aborted) return;
      if (now() - started >= maxDurationMs) {
        onRecovery({ ...recovery, status: "timed_out" });
        return;
      }
      refreshes += 1;
    }
  } catch (error) {
    if (!signal.aborted && error?.name !== "AbortError") onError(error);
  } finally {
    if (!signal.aborted) onSettled();
  }
}
