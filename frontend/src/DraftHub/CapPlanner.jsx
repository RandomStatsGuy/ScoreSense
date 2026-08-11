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
import { fmtSal, leagueStepUp, scheduleText } from "./rosterFormat";

function capHitForRow(row, offset = 0, rules) {
  const contract = row?.contract;
  const yrs = Number(contract?.years_remaining ?? row?.contract_years ?? 1);
  if (offset >= yrs) return null;
  const ctype = String(contract?.contract_type || "veteran");
  const base = Number(contract?.current_salary ?? row?.salary ?? 0);
  // Rookie deals are flat; don't trust a stale stepped schedule.
  if (ctype === "rookie" && Number.isFinite(base)) {
    return offset === 0 || offset < yrs ? base : null;
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

  const expiryBadge = (playerId) => {
    const pid = String(playerId);
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
      <p><strong>Rookie extension</strong> — Only after a 2-year rookie deal; one 1–3 year extension.</p>
      <p><strong>Dead cap</strong> — Counts after a cut.</p>
      <p><strong>Step-up</strong> — Rookies stay flat; +${stepUp}/yr only on extensions.</p>
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
          hint={
            mobileLayout
              ? "Cuts, expiry & extensions"
              : `Final-year deals leave before draft (FA). Rookies can extend once. Cuts free ${cutPct}% cap.`
          }
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
              <summary>{mustExtend.length} extend to keep (rookie deal ending)</summary>
              <ul className="hub-pre-draft-list">
                {mustExtend.map((p) => (
                  <li key={p.player_id}>
                    {p.position && <span className="hub-roster-pos-tag">{p.position}</span>}{" "}
                    {p.player_name}: {fmtSal(p.salary)}
                    <span className="table-meta"> · extend 1–3 yrs or FA</span>
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
              ? "Rookies finishing a 2-year deal — one extension of 1–3 years."
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
                      {r.player_name} (rookie)
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
          ) : (
            <p className="chart-note">
              {mustExtend.length === 0 && droppingAtDraft.length === 0
                ? "No deals end at this draft — nothing to extend yet."
                : "Veteran Deals and Rookie Extensions expire to free agency — they cannot be re-signed."}
            </p>
          )}
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
                    <tr key={r.player_id} className={droppingIds.has(String(r.player_id)) || extendableIds.has(String(r.player_id)) ? "hub-cap-row--expiring" : undefined}>
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
    </HubPage>
  );
}
