/**
 * SCORE-33: helpers for POST /api/injuries/refresh (rate-limited enqueue + snapshot).
 */

export function parseInjuryRefreshPayload(payload) {
  const players = payload?.injuries?.players;
  return {
    allowed: Boolean(payload?.allowed),
    status: payload?.status || null,
    message: payload?.message || null,
    retryAfterSeconds:
      payload?.retry_after_seconds != null && Number.isFinite(Number(payload.retry_after_seconds))
        ? Math.max(0, Math.round(Number(payload.retry_after_seconds)))
        : null,
    players: Array.isArray(players) ? players : null,
    poll: payload?.poll || null,
    httpStatusHint: payload?.http_status_hint ?? null,
  };
}

export function injuryRefreshFeedback(parsed) {
  if (!parsed) return "";
  if (parsed.allowed) {
    return parsed.message || "Refresh queued; serving current snapshot.";
  }
  const wait = parsed.retryAfterSeconds;
  if (wait != null && wait > 0) {
    const mins = Math.ceil(wait / 60);
    return `Refresh rate-limited — try again in ${mins} min. Showing current snapshot.`;
  }
  return parsed.message || "Refresh rate-limited; serving current snapshot.";
}

export function formatInjuryPollCadence(poll) {
  if (!poll) return null;
  const phase = poll.phase ? String(poll.phase) : null;
  const cadence = Number(poll.cadence_seconds);
  let cadenceLabel = null;
  if (Number.isFinite(cadence) && cadence > 0) {
    if (cadence < 90) cadenceLabel = `${Math.round(cadence)}s`;
    else if (cadence < 3600) cadenceLabel = `${Math.round(cadence / 60)}m`;
    else cadenceLabel = `${Math.round(cadence / 3600)}h`;
  }
  if (phase && cadenceLabel) return `Poll · ${phase} · every ${cadenceLabel}`;
  if (phase) return `Poll · ${phase}`;
  if (cadenceLabel) return `Poll every ${cadenceLabel}`;
  return null;
}
