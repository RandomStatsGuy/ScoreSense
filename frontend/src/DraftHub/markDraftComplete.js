import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import { confirmDialog } from "../ui/confirm";

export const MARK_DRAFT_COMPLETE_COPY = Object.freeze({
  action: "Mark draft complete",
  confirmTitle: "Mark draft complete",
  confirm:
    "Mark draft complete: burns one year on every contract. Cannot be undone.",
  done: "Draft complete",
});

export async function markDraftComplete(leagueId) {
  const ok = await confirmDialog({
    title: MARK_DRAFT_COMPLETE_COPY.confirmTitle,
    message: MARK_DRAFT_COMPLETE_COPY.confirm,
    confirmLabel: MARK_DRAFT_COMPLETE_COPY.action,
    danger: true,
  });
  if (!ok) return null;
  const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draft_completed: true }),
  });
  if (!res.ok) throw new Error(await parseApiError(res));
  return res.json();
}
