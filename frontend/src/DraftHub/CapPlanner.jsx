import React, { useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import MobileDataList, { MobileStat } from "../MobileDataList";
import MobilePlayerCard from "../MobilePlayerCard";
import HubTabIntro from "./HubTabIntro";
import {
  HubAlert,
  HubAlertStack,
  HubPage,
  HubPageMeta,
  HubSection,
  HubStatCard,
  HubStatGrid,
  HubTableCard,
  HubToolbar,
  rosterAlertVariant,
} from "./HubUILayout";
import { fmtSal, scheduleText } from "./rosterFormat";

function capHitForRow(row, offset = 0) {
  const contract = row?.contract;
  const yrs = Number(contract?.years_remaining ?? row?.contract_years ?? 1);
  if (offset >= yrs) return null;
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
  const stepUp = workspace?.rules?.contracts?.default_step_up ?? workspace?.rules?.step_up ?? 5;
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
      const res = await apiFetch("/api/hub/contract/renew", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: extendPlayer, extension_years: Number(extendYears) }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      setMsg("Contract extended.");
      onChanged?.();
    } catch (e) {
      setMsg(e.message);
    }
  };

  const glossary = (
    <>
      <p><strong>Dead cap</strong> — Counts after a cut.</p>
      <p><strong>Step-up</strong> — +${stepUp}/yr on extensions.</p>
      <p><strong>Cut refund</strong> — {cutPct}% back; rest is dead cap.</p>
    </>
  );

  if (!summary) {
    return (
      <HubPage>
        <HubTabIntro title="Cap planner" compact />
        <p className="chart-note">No cap data. Add players on Roster first.</p>
      </HubPage>
    );
  }

  const remainingTone = summary.remaining < 0 ? "danger" : "accent";

  return (
    <HubPage>
      <HubTabIntro title="Cap planner" compact learnMore={glossary} />

      <HubPageMeta>
        {workspace?.name}
        {" · "}
        ${workspace?.rules?.salary_cap} cap
        {" · "}
        {baseSeason} season
        {inLeague && onNavigate && (
          <>
            {" · "}
            <button type="button" className="btn-link" onClick={() => onNavigate("insights")}>
              League spend →
            </button>
          </>
        )}
      </HubPageMeta>

      <HubStatGrid>
        <HubStatCard label="Committed" value={fmtSal(summary.spent)} />
        <HubStatCard
          label={preDraft ? "Left this season" : "Auction budget"}
          value={fmtSal(summary.remaining)}
          tone={remainingTone}
        />
        <HubStatCard label="Roster" value={String(summary.roster_size)} />
        {yearLabels.slice(0, 3).map((year) => (
          <HubStatCard
            key={year.label}
            label={String(year.seasonLabel)}
            value={fmtSal(year.total_committed)}
            sub={`${fmtSal(year.cap_remaining)} free`}
          />
        ))}
      </HubStatGrid>

      {errors.length > 0 && (
        <HubAlertStack>
          {errors.map((e) => (
            <HubAlert
              key={e}
              variant={rosterAlertVariant(e)}
              action={
                onNavigate && /RB|WR|TE|QB|K|DEF/i.test(e) ? (
                  <button type="button" className="btn-link" onClick={() => onNavigate("value")}>
                    Browse players
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
          hint={mobileLayout ? "Cuts & dead money" : `Cuts free ${cutPct}% cap; the rest is dead money each year left on the deal.`}
        >
          <div className="hub-pre-draft-stats">
            <div className="hub-pre-draft-stat-card">
              <span className="hub-stat-label">Committed</span>
              <strong>{fmtSal(preDraft.season_committed)}</strong>
            </div>
            <div className="hub-pre-draft-stat-card">
              <span className="hub-stat-label">Auction budget</span>
              <strong>{fmtSal(preDraft.draft_budget_available)}</strong>
            </div>
            {preDraft.dead_cap > 0 && (
              <div className="hub-pre-draft-stat-card">
                <span className="hub-stat-label">Dead cap</span>
                <strong>{fmtSal(preDraft.dead_cap)}</strong>
              </div>
            )}
          </div>
          {preDraft.pending_cuts?.length > 0 && (
            <details className="hub-pre-draft-details" open>
              <summary>{preDraft.pending_cuts.length} pending cut(s)</summary>
              <ul className="hub-pre-draft-list">
                {preDraft.pending_cuts.map((p) => (
                  <li key={p.player_id}>
                    {p.player_name}: frees {fmtSal(p.cap_freed)}, dead {fmtSal(p.dead_cap)}
                    {p.dead_cap_years > 1 ? ` (${p.dead_cap_years} yrs)` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {preDraft.expiring_after_draft?.length > 0 && (
            <details className="hub-pre-draft-details">
              <summary>{preDraft.expiring_after_draft.length} free at draft (1 yr left)</summary>
              <ul className="hub-pre-draft-list">
                {preDraft.expiring_after_draft.map((p) => (
                  <li key={p.player_id}>{p.player_name}: {fmtSal(p.salary)}</li>
                ))}
              </ul>
            </details>
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
                      <td>{pos}</td>
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

      {roster.length > 0 && (
        <HubSection title="Extend contract">
          <HubToolbar>
            <label>
              Player
              <select value={extendPlayer} onChange={(e) => setExtendPlayer(e.target.value)}>
                <option value="">Select player…</option>
                {roster.map((r) => (
                  <option key={r.player_id} value={r.player_id}>
                    {r.player_name} ({r.contract?.years_remaining ?? r.contract_years}y)
                  </option>
                ))}
              </select>
            </label>
            <label>
              Years
              <input
                type="number"
                min={1}
                max={3}
                value={extendYears}
                onChange={(e) => setExtendYears(e.target.value)}
              />
            </label>
            <button type="button" className="btn-primary btn-sm" onClick={extend} disabled={!extendPlayer}>
              Extend
            </button>
          </HubToolbar>
        </HubSection>
      )}

      {msg && <p className={`hub-msg${msg.includes("fail") || msg.includes("Could") ? " hub-msg--error" : ""}`}>{msg}</p>}

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
                    heroValue={fmtSal(capHitForRow(r, 0))}
                    heroLabel={String(baseSeason)}
                    expanded={(
                      <div className="mobile-stat-grid">
                        {yearLabels.slice(1, 3).map((y, idx) => (
                          <MobileStat
                            key={y.seasonLabel}
                            label={String(y.seasonLabel)}
                            value={fmtSal(capHitForRow(r, idx + 1))}
                          />
                        ))}
                        <MobileStat
                          label="Schedule"
                          value={scheduleText(r) || "—"}
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
                    <tr key={r.player_id}>
                      <td>{r.player_name}</td>
                      <td>{fmtSal(capHitForRow(r, 0))}</td>
                      <td>{r.contract?.years_remaining ?? r.contract_years ?? "—"}</td>
                      <td className="chart-note">{scheduleText(r)}</td>
                      {yearLabels.slice(1, 3).map((y, idx) => (
                        <td key={y.seasonLabel}>{fmtSal(capHitForRow(r, idx + 1))}</td>
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
    </HubPage>
  );
}
