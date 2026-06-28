export function fmtSal(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `$${Number(v).toFixed(0)}`;
}

export function scheduleText(row) {
  const sched = row?.contract?.schedule;
  if (sched?.length) return sched.map((y) => `$${y.salary}`).join(" → ");
  return fmtSal(row?.salary);
}

export function previewSchedule(salary, years, stepUp) {
  const sal = Number(salary);
  const yrs = Number(years);
  const step = Number(stepUp);
  if (!Number.isFinite(sal) || !Number.isFinite(yrs) || yrs < 1) return "";
  const parts = [];
  for (let i = 0; i < yrs; i += 1) {
    parts.push(`$${Math.round(sal + (Number.isFinite(step) ? step : 0) * i)}`);
  }
  return parts.join(" → ");
}

export function leagueStepUp(rules) {
  return Number(rules?.contracts?.extension_step_up ?? 5);
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
