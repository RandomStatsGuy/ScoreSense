/** Labels and counts for the Draft room entry status card (SCORE-17). */

export const DRAFT_TZ_OPTIONS = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "UTC",
];

export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

export function utcIsoToWall(iso, timeZone) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  const hour = String(get("hour")).padStart(2, "0");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

export function formatDraftScheduleLabel(iso, timeZone) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    timeZone: timeZone || undefined,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function formatDraftWait(secondsUntilStart) {
  const secs = Number(secondsUntilStart);
  if (!Number.isFinite(secs)) return "";
  if (secs <= 0) return "Starting now";
  if (secs < 60) return `${Math.ceil(secs)}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 48) return rem ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function isPickDraft(rules) {
  const t = String(rules?.draft_type || "").toLowerCase();
  return t === "snake" || t === "linear";
}

export function draftFormatLabel(rules) {
  const t = String(rules?.draft_type || "").toLowerCase();
  if (t === "snake") return "Snake draft";
  if (t === "linear") return "Linear draft";
  if (!rules || rules.auction != null) return "Salary cap auction";
  return "Auction";
}

export function draftEntryPhase({
  hubContext = null,
  testMode = false,
  draftCompleted = false,
  inDraftSetup = false,
  usingHubLeague = false,
  leagueId = "",
} = {}) {
  if (draftCompleted || hubContext?.draft_completed) {
    return { id: "in_season", label: "In season" };
  }
  if (testMode) {
    return { id: "practice", label: "Practice room" };
  }
  if (leagueId && inDraftSetup) {
    return { id: "pre_draft", label: "Lobby open" };
  }
  if (usingHubLeague || hubContext?.mode === "league") {
    return { id: "pre_draft", label: "Pre-draft" };
  }
  return { id: "solo", label: "Solo prep" };
}

/** Joined managers vs league size (bots excluded when any human teams exist). */
export function draftParticipantSummary({
  teams = [],
  teamCount = 12,
  botCount = 7,
  hasLeague = false,
} = {}) {
  const target = Math.max(1, Number(teamCount) || 12);
  if (!hasLeague) {
    const planned = 1 + Math.max(0, Number(botCount) || 0);
    return {
      label: `${Math.min(planned, target)} / ${target}`,
      detail: "You + bots (practice)",
    };
  }
  const claimed = teams.filter((t) => !t?.is_bot && t?.user_sub);
  if (claimed.length > 0) {
    return {
      label: `${claimed.length} / ${target}`,
      detail: claimed.length === target ? "Full" : `${target - claimed.length} open`,
    };
  }
  const joined = teams.length;
  return {
    label: `${joined} / ${target}`,
    detail: joined === target ? "Full" : `${Math.max(0, target - joined)} open`,
  };
}
