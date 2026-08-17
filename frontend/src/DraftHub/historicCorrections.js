/**
 * SCORE-43 — Historic correction helpers (Office Sheets + correction API).
 */

export const CORRECTION_MODES = {
  HISTORY_ONLY: "history_only",
  PREVIEW_FORWARD: "preview_forward",
  APPLY_FORWARD: "apply_forward",
};

export function formatSourceKind(kind) {
  const raw = String(kind || "").trim();
  if (!raw) return "Unknown source";
  return raw.replace(/_/g, " ");
}

export function formatPhase(phase) {
  const raw = String(phase || "").trim();
  if (!raw) return "—";
  return raw.replace(/_/g, " ");
}

export function moneyDelta(before, after) {
  const a = before == null ? null : Number(before);
  const b = after == null ? null : Number(after);
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) {
    return { changed: a !== b, before: a, after: b };
  }
  return { changed: Math.abs(a - b) >= 0.01, before: a, after: b };
}

/** Build correction updates for a salary field edit on a sheet row. */
export function salaryFieldUpdates(field, parsedValue) {
  if (field === "cap_hit") {
    return { cap_hit: parsedValue, base_salary: parsedValue };
  }
  if (field === "prior_salary") {
    return { prior_salary: parsedValue };
  }
  return {};
}

export function historyOnlyLabel(seasonYear) {
  const yr = seasonYear != null ? String(seasonYear) : "history";
  return `${yr} history only`;
}

export function previewForwardLabel(planningSeason) {
  const yr = planningSeason != null ? String(planningSeason) : "live";
  return `Preview forward rebuild (${yr})`;
}

export function describeLivePreviewChange(livePreview) {
  if (!livePreview) return "No forward preview available.";
  if (!livePreview.matched) {
    return livePreview.message || "No matching live roster player for forward rebuild.";
  }
  const change = livePreview.change;
  if (!change) return livePreview.message || "No live change proposed.";
  if (!change.changed) {
    return livePreview.message || "Live salary already matches the corrected historic value.";
  }
  const name = change.player_name || change.player_id || "Player";
  const team = change.team_name ? ` (${change.team_name})` : "";
  return `${name}${team}: $${change.before} → $${change.after}`;
}
