export function rosterSlotKey(row) {
  if (row?.id != null && String(row.id) !== "") return `slot-${row.id}`;
  return String(row?.player_id || "");
}

export function pendingForRow(pendingByPlayer, row) {
  if (!pendingByPlayer || !row) return undefined;
  const key = rosterSlotKey(row);
  return pendingByPlayer[key] || pendingByPlayer[row.player_id];
}

export function fmtSal(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `$${Number(v).toFixed(0)}`;
}

export const CONTRACT_TYPE_OPTIONS = [
  { value: "rookie", label: "Rookie contract" },
  { value: "veteran", label: "Veteran contract" },
  { value: "extension", label: "Extension" },
];

export function contractTypeLabel(type) {
  const hit = CONTRACT_TYPE_OPTIONS.find((o) => o.value === type);
  return hit?.label || "Veteran contract";
}

/** Final-year rookie / vet deals may take one extension. An extension cannot. */
export function dealCanTakeExtension(contractType, rules) {
  const ctype = String(contractType || "veteran");
  if (ctype === "extension") return false;
  const contracts = rules?.contracts || {};
  if (ctype === "rookie") return contracts.one_renewal_after_rookie !== false;
  if (ctype === "veteran") return contracts.allow_veteran_renewal !== false;
  return false;
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

/** True when this deal type stays at the signing salary under current rules. */
export function dealSalaryIsStatic(contractType, rules, contract = null) {
  const ctype = String(contractType || "veteran");
  if (ctype === "rookie") {
    return (contract?.rookie_salary_static ?? rules?.contracts?.rookie_salary_static) !== false;
  }
  if (ctype === "veteran") {
    if (contract?.veteran_salary_static === true) return true;
    if (contract?.veteran_salary_static === false) return false;
    return rules?.contracts?.veteran_salary_static !== false;
  }
  return false;
}

/** Step applies to extensions and to deals that opted out of a flat first term. */
export function scheduleStepForType(contractType, rules, storedStep, contract = null) {
  const ctype = String(contractType || "veteran");
  if (dealSalaryIsStatic(ctype, rules, contract)) return 0;
  const stored = Number(storedStep);
  if (Number.isFinite(stored) && stored > 0) return stored;
  return leagueStepUp(rules);
}

/** Join year salaries. A flat run ("$4 → $4") renders as one figure. */
export function joinSalarySchedule(parts) {
  const clean = (parts || []).map((p) => String(p)).filter(Boolean);
  if (!clean.length) return "";
  if (clean.every((p) => p === clean[0])) return clean[0];
  return clean.join(" → ");
}

export function previewSchedule(
  salary,
  years,
  stepUp,
  contractType = "veteran",
  rookieStatic = true,
  veteranStatic = true,
) {
  const sal = Number(salary);
  const yrs = Number(years);
  const ctype = String(contractType || "veteran");
  const flat = (ctype === "rookie" && rookieStatic) || (ctype === "veteran" && veteranStatic);
  const step = flat
    ? 0
    : (Number.isFinite(Number(stepUp)) ? Number(stepUp) : 0);
  if (!Number.isFinite(sal) || !Number.isFinite(yrs) || yrs < 1) return "";
  const parts = [];
  for (let i = 0; i < yrs; i += 1) {
    parts.push(`$${Math.round(sal + step * i)}`);
  }
  return joinSalarySchedule(parts);
}

export function scheduleText(row, rules) {
  const ctype = row?.contract?.contract_type || "veteran";
  const sal = Number(row?.contract?.current_salary ?? row?.salary);
  const yrs = Number(row?.contract?.years_remaining ?? row?.contract_years ?? 1);
  if (Number.isFinite(sal) && Number.isFinite(yrs) && yrs >= 1) {
    const step = scheduleStepForType(ctype, rules, row?.contract?.step_up_per_year, row?.contract);
    const rookieStatic = row?.contract?.rookie_salary_static
      ?? rules?.contracts?.rookie_salary_static
      ?? true;
    const veteranStatic = dealSalaryIsStatic(ctype, rules, row?.contract);
    const fromPreview = previewSchedule(sal, yrs, step, ctype, rookieStatic, veteranStatic);
    if (fromPreview) return fromPreview;
  }
  const sched = row?.contract?.schedule;
  if (sched?.length) return joinSalarySchedule(sched.map((y) => `$${y.salary}`));
  return fmtSal(row?.salary);
}

export function leagueStepUp(rules) {
  return Number(rules?.contracts?.extension_step_up ?? 5);
}

export function contractScheduleHint(stepUp, rules = null) {
  const step = Number.isFinite(Number(stepUp)) ? Number(stepUp) : 5;
  const rookieYears = Math.max(1, Number(rules?.contracts?.rookie_years ?? 2));
  const vetYears = Math.max(1, Number(rules?.contracts?.veteran_years ?? 2));
  const rookiePolicy = rules?.contracts?.rookie_salary_static === false
    ? `Rookies ${rookieYears} yrs +$${step}/yr`
    : `Rookies flat ${rookieYears} yrs`;
  const vetPolicy = rules?.contracts?.veteran_salary_static === false
    ? `Vet deals ${vetYears} yrs +$${step}/yr`
    : `Vet deals flat ${vetYears} yrs`;
  return `${rookiePolicy} · ${vetPolicy} · Extension +$${step}/yr`;
}

/** Read-only auction award line: "Rookie deal · 2y · $12" */
export function auctionAwardContractLabel(pick, stepUp = 5) {
  const ctype = String(pick?.contract_type || "");
  const years = Number(pick?.contract_years || 2);
  const paid = Number(pick?.salary ?? pick?.amount);
  const step = (ctype === "rookie" && pick?.rookie_salary_static !== false)
    || (ctype === "veteran" && pick?.veteran_salary_static !== false)
    ? 0
    : Number(pick?.step_up_per_year ?? stepUp);
  const sched = Array.isArray(pick?.salary_schedule) && pick.salary_schedule.length
    ? joinSalarySchedule(pick.salary_schedule.map((n) => fmtSal(n)))
    : previewSchedule(
      paid,
      years,
      step,
      ctype || "veteran",
      pick?.rookie_salary_static !== false,
      pick?.veteran_salary_static !== false,
    );
  const kind = contractTypeLabel(ctype || "veteran");
  const yrs = Number.isFinite(years) ? `${years}y` : "2y";
  return sched ? `${kind} · ${yrs} · ${sched}` : `${kind} · ${yrs}`;
}

export function cutRefundPct(rules) {
  return Number(rules?.contracts?.cut_refund_pct ?? 0.5);
}

/** Floor the dead-cap charge. $1 → $0 and $7 → $3 at 50% refund. */
export function cutDeadCapAmount(salary, refundPct = 0.5) {
  const sal = Number(salary);
  const pct = Number.isFinite(Number(refundPct)) ? Number(refundPct) : 0.5;
  if (!Number.isFinite(sal) || sal <= 0) return 0;
  const keep = Math.min(1, Math.max(0, 1 - pct));
  return Math.floor(sal * keep + 1e-9);
}

export function cutRefundAmount(salary, refundPct = 0.5) {
  const sal = Number(salary);
  if (!Number.isFinite(sal) || sal <= 0) return 0;
  return Math.round((sal - cutDeadCapAmount(sal, refundPct)) * 100) / 100;
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
  return cutDeadCapAmount(capHitForRow(row, 0), cutRefundPct(rules));
}

/** Dead money if an active player were cut before the draft. */
export function dropDeadCapAmount(row, rules) {
  const sal = Number(capHitForRow(row, 0) || row?.salary || 0);
  if (!Number.isFinite(sal) || sal <= 0) return 0;
  return cutDeadCapAmount(sal, cutRefundPct(rules));
}

/** One dead-cap story for Cap bullets and the My team contract drawer. */
export function contractDeadCapStory(row, rules) {
  const raw = Number(capHitForRow(row, 0) || row?.salary || 0);
  const refundPct = cutRefundPct(rules);
  const salary = Number.isFinite(raw) ? Math.round(raw) : 0;
  const dead = cutDeadCapAmount(salary, refundPct);
  const freed = salary - dead;
  const isCut = String(row?.roster_status || "") === "cut_before_draft";
  const ifUndoneRoom = isCut ? -Math.round(salary) : 0;
  return {
    salary: Number.isFinite(salary) ? Math.round(salary) : 0,
    dead,
    freed,
    isCut,
    ifUndoneRoom,
    deadLabel: fmtSal(dead),
    ifUndoneLabel: isCut ? `room −${fmtSal(Math.abs(ifUndoneRoom || salary))}` : "—",
    cutBullet: `frees ${fmtSal(freed)}, dead ${fmtSal(dead)}`,
    railCut: `(+${fmtSal(dead)} dead, −${fmtSal(Math.round(salary))} room)`,
    undoSupport: `+${fmtSal(Math.round(salary))} room this season, ${fmtSal(dead)} dead cleared.`,
  };
}

export function shortAuctionContractLabel(pick, stepUp = 5) {
  const years = Number(pick?.contract_years || 2);
  const ctype = String(pick?.contract_type || "");
  const paid = Number(pick?.salary ?? pick?.amount);
  const step = (ctype === "rookie" && pick?.rookie_salary_static !== false)
    || (ctype === "veteran" && pick?.veteran_salary_static !== false)
    ? 0
    : Number(pick?.step_up_per_year ?? stepUp);
  const sched = Array.isArray(pick?.salary_schedule) && pick.salary_schedule.length
    ? pick.salary_schedule
    : null;
  const first = sched ? Number(sched[0]) : paid;
  const last = sched ? Number(sched[sched.length - 1]) : (Number.isFinite(paid) ? paid + step * Math.max(0, years - 1) : paid);
  if (!Number.isFinite(first)) return `${Number.isFinite(years) ? years : 2} yrs`;
  const range = joinSalarySchedule([`$${Math.round(first)}`, `$${Math.round(last)}`]);
  return `${Number.isFinite(years) ? years : 2} yrs · ${range}`;
}
