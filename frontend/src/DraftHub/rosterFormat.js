export function fmtSal(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `$${Number(v).toFixed(0)}`;
}

export const CONTRACT_TYPE_OPTIONS = [
  { value: "rookie", label: "Rookie deal" },
  { value: "veteran", label: "Veteran" },
  { value: "extension", label: "Extension" },
];

export function contractTypeLabel(type) {
  const hit = CONTRACT_TYPE_OPTIONS.find((o) => o.value === type);
  return hit?.label || "Veteran";
}

export function contractTypeBadgeClass(type) {
  if (type === "rookie") return "hub-contract-type-badge hub-contract-type-badge--rookie";
  if (type === "extension") return "hub-contract-type-badge hub-contract-type-badge--extension";
  return "hub-contract-type-badge hub-contract-type-badge--veteran";
}

/** Cap year Y = Historic sheet for season Y (pre-draft keepers, week-1, or after draft). */
export function seasonCapYearHint(year) {
  const y = year != null && String(year).trim() ? String(year) : "this year";
  return `${y} sheet = keepers / after-draft roster for ${y} (edit on the table; not live mid-season).`;
}

export const YEARS_LEFT_HINT = (
  "Includes the upcoming season. Years drop by 1 when the commissioner marks draft complete — "
  + "not when the NFL season ends or the planning season advances."
);

/** Step applies only to extensions; rookies/vets stay flat. */
export function scheduleStepForType(contractType, rules, storedStep) {
  if (String(contractType || "veteran") !== "extension") return 0;
  const stored = Number(storedStep);
  if (Number.isFinite(stored) && stored > 0) return stored;
  return leagueStepUp(rules);
}

export function previewSchedule(salary, years, stepUp, contractType = "veteran") {
  const sal = Number(salary);
  const yrs = Number(years);
  const step = String(contractType || "veteran") === "extension"
    ? (Number.isFinite(Number(stepUp)) ? Number(stepUp) : 0)
    : 0;
  if (!Number.isFinite(sal) || !Number.isFinite(yrs) || yrs < 1) return "";
  const parts = [];
  for (let i = 0; i < yrs; i += 1) {
    parts.push(`$${Math.round(sal + step * i)}`);
  }
  return parts.join(" → ");
}

export function scheduleText(row, rules) {
  const ctype = row?.contract?.contract_type || "veteran";
  const sal = Number(row?.contract?.current_salary ?? row?.salary);
  const yrs = Number(row?.contract?.years_remaining ?? row?.contract_years ?? 1);
  if (Number.isFinite(sal) && Number.isFinite(yrs) && yrs >= 1) {
    if (ctype !== "extension") {
      return previewSchedule(sal, yrs, 0, ctype);
    }
    const step = scheduleStepForType(ctype, rules, row?.contract?.step_up_per_year);
    const fromPreview = previewSchedule(sal, yrs, step, ctype);
    if (fromPreview) return fromPreview;
  }
  const sched = row?.contract?.schedule;
  if (sched?.length) return sched.map((y) => `$${y.salary}`).join(" → ");
  return fmtSal(row?.salary);
}

export function leagueStepUp(rules) {
  return Number(rules?.contracts?.extension_step_up ?? 5);
}

export function contractScheduleHint(stepUp) {
  const step = Number.isFinite(Number(stepUp)) ? Number(stepUp) : 5;
  return `Rookies flat 2 yrs · extension +$${step}/yr`;
}

export function cutRefundPct(rules) {
  return Number(rules?.contracts?.cut_refund_pct ?? 0.5);
}

function capHitForRow(row, offset = 0) {
  const contract = row?.contract;
  const yrs = Number(contract?.years_remaining ?? row?.contract_years ?? 1);
  if (offset >= yrs) return 0;
  const sched = contract?.schedule;
  if (sched?.length) {
    const hit = sched.find((y) => Number(y.year_offset) === offset);
    if (hit) return Number(hit.salary);
    if (offset === 0) return Number(contract.current_salary ?? row.salary ?? 0);
    return 0;
  }
  return offset === 0 ? Number(row?.salary ?? 0) : Number(row?.salary ?? 0);
}

/** Pre-draft cut dead cap for a roster row (current season). */
export function preDraftCutDeadCap(row, rules) {
  if (row?.roster_status !== "cut_before_draft") return 0;
  const sal = capHitForRow(row, 0);
  const refund = sal * cutRefundPct(rules);
  return Math.round((sal - refund) * 100) / 100;
}

/** Dead money if an active player were cut before the draft. */
export function dropDeadCapAmount(row, rules) {
  const sal = Number(capHitForRow(row, 0) || row?.salary || 0);
  if (!Number.isFinite(sal) || sal <= 0) return 0;
  return Math.round((sal - sal * cutRefundPct(rules)) * 100) / 100;
}
