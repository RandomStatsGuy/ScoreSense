import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import { leagueStepUp } from "./rosterFormat";

/** True when contract has a queued post-draft extension (SCORE-42). */
export function hasPendingExtension(rowOrContract) {
  if (!rowOrContract) return false;
  const contract = rowOrContract.contract && typeof rowOrContract.contract === "object"
    ? rowOrContract.contract
    : rowOrContract;
  const pending = contract?.pending_extension;
  return Boolean(pending && typeof pending === "object");
}

/** Manager-facing eligibility (own-team enforced server-side). */
export function canManagerRookieExtend(row, { draftCompleted = false } = {}) {
  if (draftCompleted) {
    return { ok: false, reason: "Rookie extensions are only available before the draft is marked complete." };
  }
  if (!row || row.roster_status === "cut_before_draft") {
    return { ok: false, reason: "Player is not active on roster." };
  }
  const contract = row.contract || {};
  const ctype = String(contract.contract_type || "veteran");
  if (ctype !== "rookie") {
    return { ok: false, reason: "Only players on a rookie deal can use this extension." };
  }
  const yrs = Number(contract.years_remaining ?? row.contract_years ?? 1);
  if (!Number.isFinite(yrs) || yrs > 1) {
    return { ok: false, reason: "Extension only when the current deal is in its final year." };
  }
  if (hasPendingExtension(row)) {
    return { ok: false, reason: "Extension already queued — activates when draft is marked complete." };
  }
  if (contract.renewal_used) {
    return { ok: false, reason: "Renewal already used — player becomes a free agent." };
  }
  return { ok: true, reason: "Eligible for one post-rookie extension (1–3 years)." };
}

/** Preview of server start salary: current + league extension_step_up. */
export function previewRookieExtendStartSalary(row, rules) {
  const current = Number(row?.contract?.current_salary ?? row?.salary ?? 0);
  if (!Number.isFinite(current)) return null;
  return Math.round(current + leagueStepUp(rules));
}

/**
 * POST /api/hub/contract/rookie-extend — server calculates salary; client sends years only.
 * @returns {Promise<object>} API payload
 */
export async function postRookieExtend(playerId, extensionYears) {
  const years = Number(extensionYears);
  if (!playerId) throw new Error("Pick a player to extend.");
  if (!Number.isFinite(years) || years < 1 || years > 3) {
    throw new Error("Extension years must be 1, 2, or 3.");
  }
  const res = await apiFetch("/api/hub/contract/rookie-extend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      player_id: playerId,
      extension_years: years,
    }),
  });
  if (!res.ok) throw new Error(await parseApiError(res));
  return res.json();
}

export function rookieExtendSuccessMessage(data) {
  const years = Number(data?.extension_years);
  const start = data?.start_salary;
  const salaryBit = start != null && Number.isFinite(Number(start))
    ? ` at $${Math.round(Number(start))}`
    : "";
  const yearsBit = Number.isFinite(years) ? `${years}-yr` : "";
  if (data?.already_applied) {
    return `Extension already queued (${yearsBit}${salaryBit}). Activates when draft is marked complete.`;
  }
  if (data?.pending_extension) {
    return `Extension queued (${yearsBit}${salaryBit}). Activates when draft is marked complete.`;
  }
  return "Contract extended.";
}
