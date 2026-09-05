/** Safe numeric display + API field aliases for ROS rows. */

export function fmtNum(value, digits = 1, fallback = "—") {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : fallback;
}

/** Weighted mention counts — avoid float noise like 12.500000000000002. */
export function fmtMentions(value, fallback = "0") {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.round(n * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 0.001) return String(Math.round(rounded));
  return rounded.toFixed(1);
}

export function fmtSentiment(value, digits = 2, fallback = "—") {
  return fmtNum(value, digits, fallback);
}

export function mentionCountLabel(value) {
  const n = Number(value);
  const text = fmtMentions(n);
  const singular = Number.isFinite(n) && Math.abs(n - 1) < 0.001;
  return `${text} mention${singular ? "" : "s"}`;
}

export function pickRow(row, ...keys) {
  if (!row) return null;
  for (const key of keys) {
    const value = row[key];
    if (value != null && value !== "") return value;
  }
  return null;
}

export function rosRegPts(row) {
  return pickRow(row, "Reg Season Pts", "Points YTD");
}

export function rosGamesPlayed(row) {
  const value = pickRow(row, "Games Played", "G");
  return value != null && value !== "" ? value : null;
}

export function rosPPG(row) {
  const pts = Number(rosRegPts(row));
  const games = Number(rosGamesPlayed(row));
  if (!Number.isFinite(pts) || !Number.isFinite(games) || games <= 0) return null;
  return pts / games;
}

export function rosNextWeekP50(row) {
  return pickRow(row, "Next Week P50", "Weekly Proj");
}

export function rosP50(row) {
  return pickRow(row, "ROS P50", "ROS Proj");
}

export function rosSeasonP50(row) {
  return pickRow(row, "Season P50", "Season Proj");
}

export function rosSeasonP90(row) {
  return pickRow(row, "Season P90", "Season High");
}

const MOCK_GATEWAY = "This took too long. If you were simulating a mock, open it from Recent mocks — the draft may have finished.";
const MOCK_EMPTY_500 = "The server failed to finish this request. If you were simulating a mock, check Recent mocks.";
const PLAIN_RETRY = "Server did not respond — Retry";

export async function parseApiError(res, fallback = "Request failed", options = {}) {
  const mockInFlight = Boolean(options?.mockInFlight);
  if (res.status === 502 || res.status === 504 || res.status === 524) {
    return mockInFlight ? MOCK_GATEWAY : PLAIN_RETRY;
  }
  const text = await res.text();
  if (!text) {
    if (res.status >= 500) {
      return mockInFlight ? MOCK_EMPTY_500 : PLAIN_RETRY;
    }
    return fallback;
  }
  if (res.status === 404 && text.includes("Not Found")) {
    return "This feature is temporarily unavailable. Please refresh and try again.";
  }
  try {
    const body = JSON.parse(text);
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) return body.detail.map((d) => d.msg || String(d)).join("; ");
    return body.message || text;
  } catch {
    if (res.status >= 500) {
      return mockInFlight ? MOCK_EMPTY_500 : PLAIN_RETRY;
    }
    return text.length > 200 ? fallback : text;
  }
}

export function connectionErrorMessage(err, fallback, options = {}) {
  const mockInFlight = Boolean(options?.mockInFlight);
  const msg = err?.message || "";
  if (
    msg.includes("Failed to fetch") ||
    msg.includes("ECONNRESET") ||
    msg.includes("NetworkError") ||
    msg.includes("proxy error")
  ) {
    return mockInFlight
      ? "Can't reach the server right now. Check your connection and try again."
      : PLAIN_RETRY;
  }
  return msg || fallback;
}

/** Sleeper statuses that should suppress projections in the table and CSV. */
export function isPlayerUnavailable(status) {
  const s = String(status || "").toLowerCase();
  return /(out|ir|pup|inactive|suspended)/.test(s);
}

export function unavailableLabel(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("ir")) return "IR";
  if (s.includes("pup")) return "PUP";
  if (s.includes("suspended")) return "SUSP";
  return "OUT";
}

/** Relative time from Sleeper news_updated (ms epoch) or ISO string. */
export function formatRelativeTime(value) {
  if (value == null || value === "") return null;
  const ms = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const diffSec = Math.round((Date.now() - ms) / 1000);
  if (diffSec < 60) return "Updated just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `Updated ${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 48) return `Updated ${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `Updated ${diffDay}d ago`;
}

export function injuryDetailLine(player) {
  const parts = [player?.injury_body_part, player?.injury_notes]
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Tokens that make a heuristic return window meaningful (beyond a vague body part).
 * Bare "knee" / "undisclosed" alone do not qualify — see SCORE-35.
 */
const RETURN_ESTIMATE_SPECIFICITY_RE =
  /\b(acl|mcl|pcl|lcl|achilles|meniscus|patella|surgery|surgical|fracture|sprain|strain|tear|torn|rupture|dislocat|broken|grade\s*[1-3]|scope|cartilage|bone\s*bruise)\b/i;

const VAGUE_BODY_ONLY_RE = /^(knee|knee injury|undisclosed|undisclosed injury)$/i;

/**
 * SCORE-35 — low-information injuries should not show fabricated return windows.
 * Examples: body part is only "knee" or "undisclosed" with no specific notes.
 */
export function isLowInformationInjury(injury) {
  const body = String(injury?.injury_body_part || "").trim();
  const notes = String(injury?.injury_notes || "").trim();
  const detail = `${body} ${notes}`.trim();
  if (!detail) return false;

  if (RETURN_ESTIMATE_SPECIFICITY_RE.test(detail)) return false;

  if (VAGUE_BODY_ONLY_RE.test(body)) {
    // Notes empty or just restate the vague body part
    if (!notes || VAGUE_BODY_ONLY_RE.test(notes) || notes.toLowerCase() === body.toLowerCase()) {
      return true;
    }
  }

  if (/\bundisclosed\b/i.test(body) || /\bundisclosed\b/i.test(notes)) {
    const withoutUndisclosed = detail.replace(/\bundisclosed(?:\s+injury)?\b/gi, "").trim();
    if (!withoutUndisclosed || VAGUE_BODY_ONLY_RE.test(withoutUndisclosed)) return true;
  }

  return false;
}

/**
 * Format a return estimate for display. Pass `injury` so low-info cases omit the window.
 * When shown, copy stays estimate-labeled (never implies an official team timeline).
 */
export function formatReturnEstimate(estimate, injury = null) {
  if (injury && isLowInformationInjury(injury)) return null;
  if (!estimate?.label) return null;
  const label = String(estimate.label).trim();
  if (!label || /^unknown$/i.test(label)) return null;
  const conf = estimate.confidence ? String(estimate.confidence) : "low";
  return { text: `Est. return: ${label}`, confidence: conf, isEstimate: estimate.is_estimate !== false };
}
