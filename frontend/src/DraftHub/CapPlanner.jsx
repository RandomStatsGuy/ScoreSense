import React, { useMemo, useState } from "react";
import useMobileLayout from "../useMobileLayout";
import MobileDataList, { MobileStat } from "../MobileDataList";
import MobilePlayerCard from "../MobilePlayerCard";
import {
  HubAlert,
  HubAlertStack,
  HubExperienceHero,
  HubExperienceLayout,
  HubExperienceSummary,
  HubPage,
  HubSection,
  HubTableCard,
  HubToolbar,
  rosterAlertVariant,
} from "./HubUILayout";
import { capHeroCopy } from "./capPlannerPresentation";
import { buildCapStatusCard } from "./capStatusCard";
import { fmtSal, leagueStepUp, scheduleText } from "./rosterFormat";
import {
  hasPendingExtension,
  postRookieExtend,
  previewRookieExtendStartSalary,
  rookieExtendSuccessMessage,
} from "./rookieExtend";

function capHitForRow(row, offset = 0, rules) {
  const contract = row?.contract;
  const yrs = Number(contract?.years_remaining ?? row?.contract_years ?? 1);
  if (offset >= yrs) return null;
  const ctype = String(contract?.contract_type || "veteran");
  const base = Number(contract?.current_salary ?? row?.salary ?? 0);
  if (ctype === "rookie" && Number.isFinite(base)) {
    if (contract?.rookie_salary_static !== false) return base;
    const hit = contract?.schedule?.find((year) => Number(year.year_offset) === offset);
    if (hit) return Number(hit.salary);
    const step = Number(contract?.step_up_per_year);
    return Math.round(base + (Number.isFinite(step) ? step : leagueStepUp(rules)) * offset);
  }
  if ((ctype === "extension" || ctype === "veteran") && Number.isFinite(base)) {
    const step = Number(contract?.step_up_per_year);
    const useStep = Number.isFinite(step) && step > 0 ? step : leagueStepUp(rules);
    const sched = contract?.schedule;
    // Ignore legacy flat multi-year schedules; prefer stepped preview like scheduleText.
    if (sched?.length) {
      const amounts = sched.map((y) => Number(y.salary));
      const isFlat = amounts.length > 0 && amounts.every((v) => Math.abs(v - base) < 0.001);
      if (!isFlat) {
        const hit = sched.find((y) => Number(y.year_offset) === offset);
        if (hit) return Number(hit.salary);
      }
    }
    return Math.round(base + useStep * offset);
  }
  const sched = contract?.schedule;
  if (sched?.length) {
    const hit = sched.find((y) => Number(y.year_offset) === offset);
    if (hit) return Number(hit.salary);
    if (offset === 0) return Number(contract.current_salary ?? row.salary);
    return null;
  }
  return offset === 0 ? Number(row.salary) : Number(row.salary);
}

export default function CapPlanner({ capSheet, roster, workspace, hubContext, onChanged, onNavigate }) {
  const [extendPlayer, setExtendPlayer] = useState("");
  const [extendYears, setExtendYears] = useState(1);
  const [msg, setMsg] = useState("");

  const summary = capSheet?.summary;
  const errors = capSheet?.validation_errors || [];
  const plan = capSheet?.multi_year_plan || [];
  const preDraft = capSheet?.pre_draft;
  const draftCompleted = Boolean(hubContext?.draft_completed);
  const baseSeason = Number(capSheet?.season ?? workspace?.season ?? new Date().getFullYear());
  const isCommissioner = Boolean(hubContext?.is_commissioner);
  const inLeague = hubContext?.mode === "league";
  const cutPct = Math.round((workspace?.rules?.contracts?.cut_refund_pct ?? 0.5) * 100);
  const stepUp = leagueStepUp(workspace?.rules);
  const maxExtensionYears = Math.max(1, Number(workspace?.rules?.contracts?.max_years ?? 3));
  const rookieSalaryStatic = workspace?.rules?.contracts?.rookie_salary_static !== false;
  const veteranExtensions = workspace?.rules?.contracts?.allow_veteran_renewal === true;
  const hasRoster = (roster?.length ?? 0) > 0;
  const mobileLayout = useMobileLayout();

  const positionRows = useMemo(() => (
    Object.keys({
      ...(summary?.by_position_count || {}),
      ...(summary?.by_position_spend || {}),
    }).sort()
  ), [summary?.by_position_count, summary?.by_position_spend]);

  const yearLabels = useMemo(
    () => plan.map((year, idx) => ({
      ...year,
      seasonLabel: baseSeason + idx,
    })),
    [plan, baseSeason],
  );

  const extend = async () => {
    setMsg("");
    try {
      const data = await postRookieExtend(extendPlayer, extendYears, maxExtensionYears);
      setMsg(rookieExtendSuccessMessage(data));
      setExtendPlayer("");
      onChanged?.();
    } catch (e) {
      setMsg(e.message);
    }
  };

  const mustExtend = preDraft?.must_extend ?? [];
  const droppingAtDraft = preDraft?.dropping_at_draft ?? [];
  const extendableIds = useMemo(
    () => new Set(mustExtend.map((p) => String(p.player_id))),
    [mustExtend],
  );
  const droppingIds = useMemo(
    () => new Set(droppingAtDraft.map((p) => String(p.player_id))),
    [droppingAtDraft],
  );
  const extendableRoster = useMemo(
    () => (roster || []).filter((r) => extendableIds.has(String(r.player_id))),
    [roster, extendableIds],
  );
  const selectedExtendRow = useMemo(
    () => extendableRoster.find((r) => String(r.player_id) === String(extendPlayer)),
    [extendableRoster, extendPlayer],
  );
  const selectedStartSalary = selectedExtendRow
    ? previewRookieExtendStartSalary(selectedExtendRow, workspace?.rules)
    : null;
  const pendingExtendIds = useMemo(
    () => new Set(
      (roster || [])
        .filter((r) => hasPendingExtension(r))
        .map((r) => String(r.player_id)),
    ),
    [roster],
  );

  const expiryBadge = (playerId) => {
    const pid = String(playerId);
    if (pendingExtendIds.has(pid)) {
      return <span className="hub-sleeper-badge hub-pending-badge">Extension queued</span>;
    }
    if (extendableIds.has(pid)) {
      return <span className="hub-sleeper-badge hub-expiring-badge">Extend to keep</span>;
    }
    if (droppingIds.has(pid)) {
      return <span className="hub-sleeper-badge hub-expiring-badge">Expires — FA</span>;
    }
    return null;
  };

  const glossary = (
    <>
      <p><strong>Expire before draft</strong> — Final-year deals leave your roster (FA) unless extended.</p>
      <p><strong>Years left</strong> — Includes the upcoming season; drops by 1 when the draft is marked complete.</p>
      <p><strong>Contract extension</strong> — Eligible final-year {veteranExtensions ? "rookie and veteran deals" : "rookie deals"}; one 1–{maxExtensionYears} year extension. Start salary is server-set (current + ${stepUp}).</p>
      <p><strong>Queued</strong> — Extension activates when draft is marked complete (1- and 3-year terms preserved).</p>
      <p><strong>Dead cap</strong> — Counts after a cut.</p>
      <p><strong>Step-up</strong> — Rookie deals {rookieSalaryStatic ? "stay flat" : `increase $${stepUp}/yr`}; veteran deals and extensions increase ${stepUp}/yr.</p>
      <p><strong>Cut refund</strong> — {cutPct}% back; rest is dead cap.</p>
    </>
  );

  if (!summary) {
    return (
      <HubPage className="hub-experience-page">
        <HubExperienceHero
          {...capHeroCopy({ empty: true })}
          chip="No cap data"
          chipTone="readonly"
        />
        <p className="chart-note hub-experience-empty">No cap data. Add players on Roster first.</p>
      </HubPage>
    );
  }

  const salaryCap = Number(
    summary.salary_cap ?? workspace?.rules?.salary_cap ?? preDraft?.salary_cap,
  );
  const deadCap = Number(summary.dead_cap ?? preDraft?.dead_cap ?? 0);
  const statusCard = buildCapStatusCard({
    remaining: summary.remaining,
    spent: summary.spent,
    salaryCap,
    rosterSize: summary.roster_size,
    deadCap,
    preDraft: Boolean(preDraft),
  });
  const seasonPlan = yearLabels.slice(0, 3);

  return (
    <HubPage className="hub-experience-page">
        <HubExperienceHero
        {...capHeroCopy({ preDraft: Boolean(preDraft) })}
        chip={statusCard?.label || "Cap plan"}
        chipTone={statusCard?.tone === "over" ? "readonly" : "active"}
      >
        {statusCard ? (
          <p className="hub-experience-hero-status">{statusCard.headline}</p>
        ) : null}
      </HubExperienceHero>

      <HubExperienceLayout
        summaryLabel="Cap snapshot"
        summary={(
          <HubExperienceSummary
            title={workspace?.name || "Your team"}
            subtitle={`${baseSeason} season · ${fmtSal(salaryCap)} cap`}
            items={[
              { id: "remaining", label: "Remaining", value: fmtSal(summary.remaining) },
              { id: "spent", label: "Committed", value: fmtSal(summary.spent) },
              { id: "dead", label: "Dead cap", value: fmtSal(deadCap) },
              { id: "roster", label: "Roster", value: String(summary.roster_size ?? roster?.length ?? "—") },
              { id: "step", label: "Annual step-up", value: fmtSal(stepUp) },
              { id: "cut", label: "Cut refund", value: `${cutPct}%` },
            ]}
            note={statusCard?.meta || "Policy changes shape new contracts. Existing deals keep their schedules."}
            action={
              inLeague && onNavigate ? (
                <button
                  type="button"
                  className="btn-ghost hub-experience-summary-action"
                  onClick={() => onNavigate("insights")}
                >
                  League spend
                </button>
              ) : null
            }
          />
        )}
      >
      {statusCard && (
        <article
          className={`hub-cap-status-card hub-cap-status-card--${statusCard.tone}`}
          aria-label={statusCard.label}
        >
          <p className="hub-cap-status-eyebrow">{statusCard.label}</p>
          <p className="hub-cap-status-headline">{statusCard.headline}</p>
          {statusCard.meta ? (
            <p className="hub-cap-status-meta">{statusCard.meta}</p>
          ) : null}
          {statusCard.tone === "over" && onNavigate && (
            <div className="hub-cap-status-actions">
              <button type="button" className="btn-ghost btn-sm" onClick={() => onNavigate("roster")}>
                Review roster
              </button>
              <button type="button" className="btn-link" onClick={() => onNavigate("available")}>
                Browse free agents
              </button>
            </div>
          )}
        </article>
      )}

      {seasonPlan.length > 0 && (
        <HubSection
          title="By season"
          hint="Committed vs free under the same cap each year."
          className="hub-cap-season-section"
        >
          <ul className="hub-cap-season-list" aria-label="Season-by-season cap">
            {seasonPlan.map((year) => {
              const free = Number(year.cap_remaining);
              const freeOver = Number.isFinite(free) && free < 0;
              return (
                <li key={year.label || year.seasonLabel} className="hub-cap-season-row">
                  <span className="hub-cap-season-year">{year.seasonLabel}</span>
                  <span className="hub-cap-season-committed">
                    {fmtSal(year.total_committed)}
                    <span className="hub-cap-season-unit"> committed</span>
                  </span>
                  <span className={`hub-cap-season-free${freeOver ? " is-over" : ""}`}>
                    {fmtSal(year.cap_remaining)}
                    <span className="hub-cap-season-unit"> free</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </HubSection>
      )}

      {errors.length > 0 && (
        <HubAlertStack>
          {errors.map((e) => (
            <HubAlert
              key={e}
              variant={rosterAlertVariant(e)}
              action={
                onNavigate && /RB|WR|TE|QB|K|DEF/i.test(e) ? (
                  <button type="button" className="btn-link" onClick={() => onNavigate("available")}>
                    Browse free agents
                  </button>
                ) : null
              }
            >
              {e}
            </HubAlert>
          ))}
        </HubAlertStack>
      )}

      {preDraft && (
        <HubSection
          title="Pre-draft"
          hint={
            mobileLayout
              ? "Cuts, expiry & extensions"
              : `Final-year deals leave before draft (FA). Rookies can extend once. Cuts free ${cutPct}% cap.`
          }
        >
          {preDraft.dead_cap > 0 && (
            <p className="hub-cap-pre-draft-dead chart-note">
              Dead cap this season: <strong>{fmtSal(preDraft.dead_cap)}</strong>
              {preDraft.cap_freed_from_cuts > 0
                ? ` · pending cuts free ${fmtSal(preDraft.cap_freed_from_cuts)}`
                : ""}
            </p>
          )}
          {preDraft.pending_cuts?.length > 0 && (
            <details className="hub-pre-draft-details" open>
              <summary>{preDraft.pending_cuts.length} pending cut(s)</summary>
              <ul className="hub-pre-draft-list">
                {preDraft.pending_cuts.map((p) => (
                  <li key={p.player_id}>
                    {p.position && <span className="hub-roster-pos-tag">{p.position}</span>}{" "}
                    {p.player_name}: frees {fmtSal(p.cap_freed)}, dead {fmtSal(p.dead_cap)}
                    {p.dead_cap_years > 1 ? ` (${p.dead_cap_years} yrs)` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {mustExtend.length > 0 && (
            <details className="hub-pre-draft-details" open>
              <summary>{mustExtend.length} extend to keep (eligible deal ending)</summary>
              <ul className="hub-pre-draft-list">
                {mustExtend.map((p) => (
                  <li key={p.player_id}>
                    {p.position && <span className="hub-roster-pos-tag">{p.position}</span>}{" "}
                    {p.player_name}: {fmtSal(p.salary)}
                    <span className="table-meta"> · extend 1–{maxExtensionYears} yrs or FA</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {droppingAtDraft.length > 0 && (
            <details className="hub-pre-draft-details" open={mustExtend.length === 0}>
              <summary>{droppingAtDraft.length} expire before draft (FA)</summary>
              <ul className="hub-pre-draft-list">
                {droppingAtDraft.map((p) => (
                  <li key={p.player_id}>
                    {p.position && <span className="hub-roster-pos-tag">{p.position}</span>}{" "}
                    {p.player_name}: {fmtSal(p.salary)}
                    <span className="table-meta"> · cannot re-sign</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {mustExtend.length === 0 && droppingAtDraft.length === 0 && (
            <p className="chart-note">No deals end at this draft.</p>
          )}
        </HubSection>
      )}

      {!draftCompleted && isCommissioner && (
        <p className="chart-note hub-pre-draft-note">
          Mark <strong>Draft completed</strong> in Setup when the auction ends.
        </p>
      )}

      {!hasRoster && onNavigate && (
        <p className="chart-note">
          <button type="button" className="btn-link" onClick={() => onNavigate("setup")}>
            Add players in Setup
          </button>
          {" "}before planning cuts.
        </p>
      )}

      {Object.keys(summary.by_position_count || {}).length > 0 && (
        <HubSection title="Spend by position" className="hub-section--flush-table">
          <HubTableCard>
            {mobileLayout ? (
              <MobileDataList>
                {positionRows.map((pos) => (
                  <MobilePlayerCard
                    key={pos}
                    name={pos}
                    meta={`${summary.by_position_count?.[pos] ?? 0} players`}
                    heroValue={fmtSal(summary.by_position_spend?.[pos])}
                    heroLabel="spend"
                  />
                ))}
              </MobileDataList>
            ) : (
            <div className="table-wrap table-sticky">
              <table className="data-table hub-table">
                <thead>
                  <tr>
                    <th>Pos</th>
                    <th>Count</th>
                    <th>Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {positionRows.map((pos) => (
                    <tr key={pos}>
                      <td><span className="hub-roster-pos-tag">{pos}</span></td>
                      <td>{summary.by_position_count?.[pos] ?? 0}</td>
                      <td>{fmtSal(summary.by_position_spend?.[pos])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </HubTableCard>
        </HubSection>
      )}

      {!draftCompleted && (
        <HubSection
          title="Extend contract"
          hint={
            extendableRoster.length > 0
              ? `Eligible final-year contracts — pick 1–${maxExtensionYears} years. Start salary is current + $${stepUp} (server-calculated).`
              : pendingExtendIds.size > 0
                ? "Extension(s) already queued — they activate when draft is marked complete."
                : "No rookies eligible to extend right now."
          }
        >
          {extendableRoster.length > 0 ? (
            <HubToolbar>
              <label>
                Player
                <select value={extendPlayer} onChange={(e) => setExtendPlayer(e.target.value)}>
                  <option value="">Select player…</option>
                  {extendableRoster.map((r) => (
                    <option key={r.player_id} value={r.player_id}>
                      {r.player_name} ({r.contract?.contract_type || "contract"} · {fmtSal(r.salary)})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Years
                <input
                  type="number"
                  min={1}
                  max={maxExtensionYears}
                  value={extendYears}
                  onChange={(e) => setExtendYears(e.target.value)}
                />
              </label>
              {selectedStartSalary != null && (
                <span className="chart-note hub-extend-start-preview">
                  Starts at {fmtSal(selectedStartSalary)}
                </span>
              )}
              <button type="button" className="btn-primary btn-sm" onClick={extend} disabled={!extendPlayer}>
                Queue extension
              </button>
            </HubToolbar>
          ) : (
            <p className="chart-note">
              {pendingExtendIds.size > 0
                ? "All eligible rookies already have an extension queued."
                : mustExtend.length === 0 && droppingAtDraft.length === 0
                  ? "No deals end at this draft — nothing to extend yet."
                  : "Veteran Deals and Rookie Extensions expire to free agency — they cannot be re-signed."}
            </p>
          )}
        </HubSection>
      )}

      {msg && (
        <p
          className={`hub-msg${
            /fail|could not|only |must |already queued with different|not on roster|403|400/i.test(msg)
              ? " hub-msg--error"
              : ""
          }`}
        >
          {msg}
        </p>
      )}

      {roster.length > 0 && (
        <HubSection title="Cap sheet" hint={mobileLayout ? "By season" : "Current deal and scheduled hits by season."}>
          <HubTableCard>
            {mobileLayout ? (
              <MobileDataList>
                {roster.map((r) => (
                  <MobilePlayerCard
                    key={r.player_id}
                    name={r.player_name}
                    meta={`${r.contract?.years_remaining ?? r.contract_years ?? "—"} yrs left`}
                    badge={expiryBadge(r.player_id)}
                    heroValue={fmtSal(capHitForRow(r, 0, workspace?.rules))}
                    heroLabel={String(baseSeason)}
                    expanded={(
                      <div className="mobile-stat-grid">
                        {yearLabels.slice(1, 3).map((y, idx) => (
                          <MobileStat
                            key={y.seasonLabel}
                            label={String(y.seasonLabel)}
                            value={fmtSal(capHitForRow(r, idx + 1, workspace?.rules))}
                          />
                        ))}
                        <MobileStat
                          label="Schedule"
                          value={scheduleText(r, workspace?.rules) || "—"}
                          className="hub-roster-mobile-schedule"
                        />
                      </div>
                    )}
                  />
                ))}
              </MobileDataList>
            ) : (
            <div className="table-wrap table-sticky">
              <table className="data-table hub-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>{baseSeason}</th>
                    <th>Yrs</th>
                    <th>Schedule</th>
                    {yearLabels.slice(1, 3).map((y) => (
                      <th key={y.seasonLabel}>{y.seasonLabel}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {roster.map((r) => (
                    <tr key={r.player_id} className={
                      droppingIds.has(String(r.player_id))
                      || extendableIds.has(String(r.player_id))
                      || pendingExtendIds.has(String(r.player_id))
                        ? "hub-cap-row--expiring"
                        : undefined
                    }>
                      <td>
                        {r.player_name}
                        {" "}
                        {expiryBadge(r.player_id)}
                      </td>
                      <td>{fmtSal(capHitForRow(r, 0, workspace?.rules))}</td>
                      <td>{r.contract?.years_remaining ?? r.contract_years ?? "—"}</td>
                      <td className="chart-note">{scheduleText(r, workspace?.rules)}</td>
                      {yearLabels.slice(1, 3).map((y, idx) => (
                        <td key={y.seasonLabel}>{fmtSal(capHitForRow(r, idx + 1, workspace?.rules))}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </HubTableCard>
        </HubSection>
      )}
        <details className="hub-experience-learn">
          <summary>How cap years work</summary>
          <div>{glossary}</div>
        </details>
      </HubExperienceLayout>
    </HubPage>
  );
}
