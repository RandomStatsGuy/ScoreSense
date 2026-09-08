/** Offline / owner-entry helpers. Copy lives in leagueAccessCopy + draftLivePresentation. */

export function isOfflineConduct(session) {
  return String(session?.conduct || "live").toLowerCase() === "offline";
}

export function startDraftSearch({
  force = false,
  allowEmpty = false,
  fillBots = false,
  conduct = "live",
} = {}) {
  const q = new URLSearchParams();
  if (force) q.set("force", "true");
  if (allowEmpty) q.set("allow_empty", "true");
  if (fillBots) q.set("fill_bots", "true");
  if (String(conduct || "live").toLowerCase() === "offline") q.set("conduct", "offline");
  const qs = q.toString();
  return qs ? `?${qs}` : "";
}

export function canRunOfflineCommissioner({ hubContext = null, isCommissioner = false } = {}) {
  if (hubContext && Object.prototype.hasOwnProperty.call(hubContext, "is_primary_commissioner")) {
    return Boolean(hubContext.is_primary_commissioner);
  }
  return Boolean(isCommissioner);
}

export function canShowOwnerRecord({ session = null, hubContext = null, myTeamId = "" } = {}) {
  if (!myTeamId) return false;
  return Boolean(
    session?.owner_entry_open
    || hubContext?.acquisition_window?.can_record_draft_result,
  );
}

export async function downloadDraftResultsCsv(leagueId, { apiFetch, parseApiError } = {}) {
  if (typeof apiFetch !== "function" || typeof parseApiError !== "function") {
    throw new Error("CSV download needs the app fetch helpers.");
  }
  const id = String(leagueId || "").trim();
  if (!id) throw new Error("Missing league");
  const res = await apiFetch(`/api/hub/league/${encodeURIComponent(id)}/draft/results.csv`);
  if (!res.ok) throw new Error(await parseApiError(res));
  const blob = await res.blob();
  const header = res.headers.get("Content-Disposition") || "";
  const match = /filename="([^"]+)"/.exec(header);
  const filename = match?.[1] || "draft-results.csv";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return filename;
}
