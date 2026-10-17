import { apiFetch } from "../auth";
import { parseApiError } from "../format";

export async function downloadLeagueWorkbook(leagueId, { isCurrent = () => true } = {}) {
  const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/export`);
  if (!res.ok) throw new Error(await parseApiError(res));
  const blob = await res.blob();
  if (!isCurrent()) return;
  const header = res.headers.get("Content-Disposition") || "";
  const match = /filename="([^"]+)"/.exec(header);
  const filename = match?.[1] || "ScoreSense-league.xlsx";
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
