import React, { useMemo, useState } from "react";
import useMobileLayout from "../useMobileLayout";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
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
  HubPageSticky,
  HubFilterMenu,
  rosterAlertVariant,
} from "./HubUILayout";
import {
  againstCap,
  capEquationNote,
  displayCapPair,
  capHeroCopy,
  capRailPrimary,
  capSheetYearOffsets,
  leftoverAfterMoveDisplay,
  leftoverMoveReadout,
  fmtCapMoney,
  parseNeedErrors,
  rosterNeedLine,
  rosterPositionNeeds,
  CAP_DRAFT_COPY,
  CAP_EXTEND_COPY,
  CAP_FIGURE_COPY,
  CAP_MODEL_COPY,
  CAP_MOVE_COPY,
  CAP_NEED_COPY,
  CAP_SHEET_COPY,
} from "./capPlannerPresentation";
import { buildCapStatusCard } from "./capStatusCard";
import { contractDeadCapStory, fmtSal, leagueStepUp } from "./rosterFormat";
import ContractHistoryLink from "./ContractHistoryLink";
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
    if (sched?.length) {
      const amounts = sched.map((year) => Number(year.salary));
      const isFlat = amounts.length > 0 && amounts.every((v) => Math.abs(v - base) < 0.001);
      if (!isFlat) {
        const hit = sched.find((year) => Number(year.year_offset) === offset);
        if (hit) return Number(hit.salary);
      }
    }
    return Math.round(base + useStep * offset);
  }
  const sched = contract?.schedule;
  if (sched?.length) {
    const hit = sched.find((year) => Number(year.year_offset) === offset);
    if (hit) return Number(hit.salary);
    if (offset === 0) return Number(contract.current_salary ?? row.salary);
    return null;
  }
  return offset === 0 ? Number(row.salary) : Number(row.salary);
}

function CapDenseRow({ name, value, chip, onOpen }) {
  const body = (
    <>
      <span className="hub-cap-dense-name">{name}</span>
      <span className="hub-cap-dense-value">{value}</span>
      {chip ? <span className="hub-cap-dense-chip">{chip}</span> : null}
    </>
  );
  if (onOpen) {
    return (
      <li>
        <button type="button" className="hub-cap-dense-row is-action" onClick={onOpen}>
          {body}
        </button>
      </li>
    );
  }
  return <li className="hub-cap-dense-row">{body}</li>;
}

function CapMoneyField({ id, label, value, onChange }) {
  return (
    <div className="hub-filter-menu hub-cap-money-field">
      <label className="hub-filter-menu-trigger hub-cap-money" htmlFor={id}>
        <span className="hub-filter-menu-kind">{label}</span>
        <span className="hub-cap-money-affix" aria-hidden="true">$</span>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
          aria-label={label}
        />
      </label>
    </div>
  );
}

export default function CapPlanner({ capSheet, roster, workspace, hubContext, onChanged, onNavigate }) {
  const [extendPlayer, setExtendPlayer] = useState("");
  const [extendYears, setExtendYears] = useState("1");
  const [cutPlayer, setCutPlayer] = useState("");
  const [bidAmount, setBidAmount] = useState("");
  const [msg, setMsg] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  const [cutBusyId, setCutBusyId] = useState("");

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
      return <span className="hub-expire-chip hub-expire-chip--extend">Extension queued</span>;
    }
    if (extendableIds.has(pid)) {
      return <span className="hub-roster-status hub-roster-status--keep">Extend to keep</span>;
    }
    if (droppingIds.has(pid)) {
      return <span className="hub-roster-status hub-roster-status--warn">Expires — FA</span>;
    }
    return null;
  };

  const glossary = (
    <>
      <p><strong>Expire before draft</strong> — Final-year deals leave your roster (FA) unless extended.</p>
      <p><strong>Years left</strong> — Includes the upcoming season; drops by 1 when the draft is marked complete.</p>
      <p><strong>Contract extension</strong> — Eligible final-year {veteranExtensions ? "rookie and veteran deals" : "rookie deals"}; one 1–{maxExtensionYears} year extension. Start salary is server-set (current + ${stepUp}).</p>
      <p><strong>Queued</strong> — Extension activates when draft is marked complete (1- and 3-year terms preserved).</p>
      <p><strong>Against this cap</strong> — This year&apos;s salary plus dead cap. Leftover is the rest of the cap.</p>
      <p><strong>Keep past this draft</strong> — Players still under contract after this draft. On this sheet is every row listed below.</p>
      <p><strong>Step-up</strong> — Rookie deals {rookieSalaryStatic ? "stay flat" : `increase $${stepUp}/yr`}; veteran deals and extensions increase ${stepUp}/yr.</p>
      <p><strong>Cut refund</strong> — {cutPct}% back; rest is dead cap.</p>
    </>
  );

  const undoCut = async (playerId) => {
    if (!playerId) return;
    setCutBusyId(String(playerId));
    setMsg("");
    try {
      const res = await apiFetch("/api/hub/roster", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: playerId, roster_status: "active" }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      onChanged?.();
    } catch (e) {
      setMsg(e.message || "Could not undo the cut");
    } finally {
      setCutBusyId("");
    }
  };

  const resetMove = () => {
    setCutPlayer("");
    setBidAmount("");
  };

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
  const sheetCount = roster?.length ?? 0;
  const keepCount = Number(summary.roster_size);
  const statusCard = buildCapStatusCard({
    remaining: summary.remaining,
    spent: summary.spent,
    salaryCap,
    rosterSize: keepCount,
    sheetSize: sheetCount,
    deadCap,
    preDraft: Boolean(preDraft),
  });
  const seasonPlan = yearLabels.slice(0, 3);
  const cutRow = (roster || []).find((row) => String(row.player_id) === String(cutPlayer));
  const cutHits = seasonPlan.map((_, idx) => (
    cutRow ? Number(capHitForRow(cutRow, idx, workspace?.rules) || 0) : 0
  ));
  const currentPair = displayCapPair({ leftover: summary.remaining, salaryCap });
  const movedPlan = leftoverAfterMoveDisplay({
    years: seasonPlan,
    salaryCap,
    cutHits,
    cutRefundPct: workspace?.rules?.contracts?.cut_refund_pct ?? 0.5,
    bid: Number(bidAmount) || 0,
  });
  const moveReadout = leftoverMoveReadout({
    current: currentPair.leftover,
    after: movedPlan[0]?.cap_remaining ?? currentPair.leftover,
  });
  const nowPair = currentPair;
  const afterPair = displayCapPair({ leftover: moveReadout?.after, salaryCap });
  const afterOverBy = afterPair.leftover != null && afterPair.leftover < 0
    ? Math.abs(afterPair.leftover)
    : 0;
  const hasMove = Boolean(cutPlayer || bidAmount);
  const against = againstCap({ spent: summary.spent, deadCap });

  const pendingCut = (preDraft?.pending_cuts || [])[0] || null;
  const railPrimary = capRailPrimary({ pendingCut, remaining: summary.remaining });
  const selectedCapRow = selectedPlayerId
    ? (roster || []).find((row) => String(row.player_id) === String(selectedPlayerId))
    : null;
  const selectedStory = selectedCapRow
    ? contractDeadCapStory(selectedCapRow, workspace?.rules)
    : null;

  const computedNeeds = rosterPositionNeeds({
    roster,
    limits: workspace?.rules?.roster || {},
  });
  const { needs: parsedNeeds, other: otherErrors } = parseNeedErrors(errors);
  const needs = computedNeeds.needs.length ? computedNeeds.needs : parsedNeeds;
  const needLine = rosterNeedLine(needs, { minimumTotal: computedNeeds.minimumTotal });
  const futureYearOffsets = capSheetYearOffsets({
    roster: roster || [],
    yearCount: yearLabels.length,
    hitFor: (row, offset) => capHitForRow(row, offset, workspace?.rules),
  });

  const teamItems = [
    { id: "leftover", label: CAP_FIGURE_COPY.leftover, value: fmtCapMoney(currentPair.leftover) },
    { id: "against", label: CAP_FIGURE_COPY.againstCap, value: fmtCapMoney(currentPair.against) },
    { id: "dead", label: CAP_FIGURE_COPY.deadCap, value: fmtSal(deadCap) },
  ];
  if (preDraft && Number.isFinite(keepCount)) {
    teamItems.push({
      id: "keep",
      label: CAP_FIGURE_COPY.keepPastDraft,
      value: String(keepCount),
    });
  }
  if (sheetCount && (!preDraft || sheetCount !== keepCount)) {
    teamItems.push({
      id: "sheet",
      label: CAP_FIGURE_COPY.onThisSheet,
      value: String(sheetCount),
    });
  }

  const yearOptions = Array.from({ length: maxExtensionYears }, (_, idx) => ({
    id: String(idx + 1),
    label: `${idx + 1}`,
  }));

  return (
    <HubPage className="hub-experience-page hub-planner-page">
      <HubExperienceHero
        {...capHeroCopy({ preDraft: Boolean(preDraft) })}
        chip={statusCard?.label || "Cap plan"}
        chipTone={statusCard?.tone === "over" ? "caution" : "readonly"}
      >
        {statusCard && !mobileLayout ? (
          <p className="hub-experience-hero-status">{statusCard.headline}</p>
        ) : null}
        <p className="hub-cap-model-line">{CAP_MODEL_COPY.years}</p>
        <details className="hub-cap-model-details">
          <summary>{CAP_MODEL_COPY.summary}</summary>
          <div>{glossary}</div>
        </details>
      </HubExperienceHero>

      <HubExperienceLayout
        summaryLabel="Cap snapshot"
        summary={(
          <HubExperienceSummary
            title={workspace?.name || "Your team"}
            subtitle={`${baseSeason} season · ${fmtSal(salaryCap)} cap`}
            groups={[
              { id: "you", items: teamItems },
              {
                id: "rules",
                heading: CAP_FIGURE_COPY.rulesHeading,
                items: [
                  { id: "step", label: CAP_FIGURE_COPY.stepUp, value: fmtSal(stepUp) },
                  { id: "cut", label: CAP_FIGURE_COPY.cutRefund, value: `${cutPct}%` },
                ],
              },
            ]}
            note={capEquationNote({
              against,
              leftover: summary.remaining,
              salaryCap,
            })}
            action={(
              <div className="hub-cap-rail-actions">
                {railPrimary.kind === "undo-cut" ? (
                  <div className="hub-cap-undo-cut">
                    <button
                      type="button"
                      className="btn-ghost hub-experience-summary-action"
                      disabled={Boolean(cutBusyId)}
                      onClick={() => undoCut(railPrimary.playerId)}
                    >
                      {railPrimary.label}
                    </button>
                    {railPrimary.detail ? (
                      <p className="chart-note">{railPrimary.detail}</p>
                    ) : null}
                  </div>
                ) : onNavigate ? (
                  <button
                    type="button"
                    className="btn-primary hub-experience-summary-action"
                    onClick={() => onNavigate("room")}
                  >
                    {railPrimary.label}
                  </button>
                ) : null}
                {inLeague && onNavigate ? (
                  <button
                    type="button"
                    className="btn-link hub-cap-league-spend"
                    onClick={() => onNavigate("insights")}
                  >
                    {CAP_FIGURE_COPY.leagueSpend}
                  </button>
                ) : null}
              </div>
            )}
          />
        )}
      >
      <div className="hub-cap-tools">
      <HubSection
        title={CAP_MOVE_COPY.title}
        hint={CAP_MOVE_COPY.hint}
        className="hub-cap-move-section"
      >
        <HubPageSticky>
        <HubToolbar>
          <HubFilterMenu
            label={CAP_MOVE_COPY.cutLabel}
            value={cutPlayer}
            options={[
              { id: "", label: CAP_MOVE_COPY.none },
              ...(roster || []).map((row) => ({
                id: row.player_id,
                label: `${row.player_name || row.player_id} · ${fmtSal(row.salary)}`,
              })),
            ]}
            onChange={setCutPlayer}
          />
          <CapMoneyField
            id="cap-move-bid"
            label={CAP_MOVE_COPY.bidLabel}
            value={bidAmount}
            onChange={setBidAmount}
          />
          {hasMove ? (
            <button type="button" className="btn-ghost btn-sm" onClick={resetMove}>
              {CAP_MOVE_COPY.reset}
            </button>
          ) : null}
        </HubToolbar>
        </HubPageSticky>
        {moveReadout ? (
          <div
            className={`hub-cap-move-result${moveReadout.over ? " is-over" : ""}`}
            aria-live="polite"
          >
            <p className="hub-cap-move-result-line">
              <span>
                {CAP_MOVE_COPY.now}
                {" "}
                <strong>{fmtCapMoney(nowPair.leftover)}</strong>
                {" "}
                {CAP_MOVE_COPY.leftoverWord}
              </span>
              <span aria-hidden="true">→</span>
              <span>
                {CAP_MOVE_COPY.after}
                {" "}
                <strong>{fmtCapMoney(afterPair.leftover)}</strong>
                {" "}
                {CAP_MOVE_COPY.leftoverWord}
              </span>
            </p>
            {afterOverBy > 0 ? (
              <p className="hub-cap-move-over">
                {CAP_MOVE_COPY.over(fmtCapMoney(afterOverBy))}
              </p>
            ) : null}
          </div>
        ) : null}
        {movedPlan.length > 0 && (
          <ul className="hub-cap-season-list" aria-label="Leftover after this move, by season">
            {movedPlan.map((year) => {
              const pair = displayCapPair({ leftover: year.cap_remaining, salaryCap });
              const freeOver = pair.leftover != null && pair.leftover < 0;
              return (
                <li key={year.label || year.seasonLabel} className="hub-cap-season-row">
                  <span className="hub-cap-season-year">{year.seasonLabel}</span>
                  <span className="hub-cap-season-committed">
                    {fmtCapMoney(pair.against)}
                    <span className="hub-cap-season-unit"> {CAP_FIGURE_COPY.seasonAgainst}</span>
                  </span>
                  <span className={`hub-cap-season-free${freeOver ? " is-over" : ""}`}>
                    {fmtCapMoney(pair.leftover)}
                    <span className="hub-cap-season-unit"> {CAP_FIGURE_COPY.seasonLeftover}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </HubSection>

      {!draftCompleted && (
        <HubSection
          title={CAP_EXTEND_COPY.title}
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
              <HubFilterMenu
                label={CAP_EXTEND_COPY.playerLabel}
                value={extendPlayer}
                options={[
                  { id: "", label: CAP_EXTEND_COPY.selectPlayer },
                  ...extendableRoster.map((r) => ({
                    id: String(r.player_id),
                    label: `${r.player_name} (${r.contract?.contract_type || "contract"} · ${fmtSal(r.salary)})`,
                  })),
                ]}
                onChange={setExtendPlayer}
              />
              <HubFilterMenu
                label={CAP_EXTEND_COPY.yearsLabel}
                value={String(extendYears)}
                options={yearOptions}
                onChange={setExtendYears}
              />
              {selectedStartSalary != null && (
                <span className="chart-note hub-extend-start-preview">
                  Starts at {fmtSal(selectedStartSalary)}
                </span>
              )}
              <button type="button" className="btn-primary btn-sm" onClick={extend} disabled={!extendPlayer}>
                {CAP_EXTEND_COPY.queue}
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
      </div>

      {needLine && (
        <div className="hub-cap-need">
          <p>{needLine}</p>
          {onNavigate ? (
            <button
              type="button"
              className="btn-primary"
              onClick={() => onNavigate("available", { pos: needs[0]?.position })}
            >
              {CAP_NEED_COPY.browseFreeAgents}
            </button>
          ) : null}
        </div>
      )}

      {otherErrors.length > 0 && (
        <HubAlertStack>
          {otherErrors.map((e) => (
            <HubAlert key={e} variant={rosterAlertVariant(e)}>
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
                    {p.player_name}: {contractDeadCapStory({
                      ...p,
                      salary: p.salary,
                      roster_status: "cut_before_draft",
                    }, workspace?.rules).cutBullet}
                    {p.dead_cap_years > 1 ? ` (${p.dead_cap_years} yrs)` : ""}
                    <button
                      type="button"
                      className="btn-link"
                      disabled={cutBusyId === String(p.player_id)}
                      onClick={() => undoCut(p.player_id)}
                    >
                      Undo cut
                    </button>
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
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => setSelectedPlayerId(p.player_id)}
                    >
                      Contract
                    </button>
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
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => setSelectedPlayerId(p.player_id)}
                    >
                      Contract
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {mustExtend.length === 0 && droppingAtDraft.length === 0 && (
            <p className="chart-note">No deals end at this draft.</p>
          )}
          {!draftCompleted && isCommissioner ? (
            <p className="chart-note hub-pre-draft-note">
              {onNavigate ? (
                <button type="button" className="btn-link" onClick={() => onNavigate("office")}>
                  {CAP_DRAFT_COPY.markComplete}
                </button>
              ) : (
                <strong>{CAP_DRAFT_COPY.markComplete}</strong>
              )}
              {" "}
              {CAP_DRAFT_COPY.markCompleteRest}
            </p>
          ) : null}
        </HubSection>
      )}

      {!hasRoster && onNavigate && (
        <p className="chart-note">
          <button type="button" className="btn-link" onClick={() => onNavigate("setup")}>
            Add players in Setup
          </button>
          {" "}before planning cuts.
        </p>
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
        <HubSection title={CAP_SHEET_COPY.title} hint={mobileLayout ? "By season" : CAP_SHEET_COPY.hint}>
          <HubTableCard>
            {mobileLayout ? (
              <ul className="hub-cap-dense-list" aria-label="Cap sheet">
                {roster.map((r) => (
                  <CapDenseRow
                    key={r.player_id}
                    name={r.player_name}
                    value={fmtSal(capHitForRow(r, 0, workspace?.rules))}
                    chip={r.position || `${r.contract?.years_remaining ?? r.contract_years ?? "—"} yrs`}
                    onOpen={() => setSelectedPlayerId(r.player_id)}
                  />
                ))}
              </ul>
            ) : (
            <div className="table-wrap table-sticky">
              <table className="data-table hub-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>{baseSeason}</th>
                    <th>Yrs</th>
                    {futureYearOffsets.map((offset) => (
                      <th key={yearLabels[offset]?.seasonLabel || offset}>
                        {yearLabels[offset]?.seasonLabel}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {roster.map((r) => (
                    <tr
                      key={r.player_id}
                      className={`hub-cap-row is-action${
                        droppingIds.has(String(r.player_id))
                        || extendableIds.has(String(r.player_id))
                        || pendingExtendIds.has(String(r.player_id))
                          ? " hub-cap-row--expiring"
                          : ""
                      }`}
                      onClick={() => setSelectedPlayerId(r.player_id)}
                    >
                      <td>
                        {r.player_name}
                        {" "}
                        {expiryBadge(r.player_id)}
                      </td>
                      <td>{fmtSal(capHitForRow(r, 0, workspace?.rules))}</td>
                      <td>{r.contract?.years_remaining ?? r.contract_years ?? "—"}</td>
                      {futureYearOffsets.map((offset) => (
                        <td key={yearLabels[offset]?.seasonLabel || offset}>
                          {fmtSal(capHitForRow(r, offset, workspace?.rules))}
                        </td>
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

      {Object.keys(summary.by_position_count || {}).length > 0 && (
        <HubSection title="Spend by position" className="hub-section--flush-table">
          <HubTableCard>
            {mobileLayout ? (
              <ul className="hub-cap-dense-list" aria-label="Spend by position">
                {positionRows.map((pos) => (
                  <CapDenseRow
                    key={pos}
                    name={pos}
                    value={fmtSal(summary.by_position_spend?.[pos])}
                    chip={`${summary.by_position_count?.[pos] ?? 0}`}
                  />
                ))}
              </ul>
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
      </HubExperienceLayout>
      {selectedCapRow ? (
        <div
          className="hub-roster-side-panel-overlay"
          role="presentation"
          onClick={() => setSelectedPlayerId(null)}
        >
          <aside
            className="hub-roster-side-panel panel"
            role="dialog"
            aria-label={`Contract for ${selectedCapRow.player_name}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="hub-roster-side-panel-head">
              <h3 className="hub-roster-side-panel-title">Contract</h3>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setSelectedPlayerId(null)}
                aria-label="Close contract panel"
              >
                Close
              </button>
            </div>
            <div className="hub-roster-contract-panel-body">
              <div className="hub-roster-contract-panel-identity">
                <strong>{selectedCapRow.player_name}</strong>
                <span className="chart-note">
                  {[selectedCapRow.team, selectedCapRow.position].filter(Boolean).join(" · ") || "—"}
                </span>
              </div>
              {selectedStory ? (
                <div className="hub-roster-contract-panel-grid">
                  <div className="hub-roster-contract-panel-stat">
                    <span className="mobile-stat-label">Dead cap</span>
                    <strong>{selectedStory.deadLabel}</strong>
                  </div>
                  <div className="hub-roster-contract-panel-stat">
                    <span className="mobile-stat-label">If undone</span>
                    <strong>{selectedStory.ifUndoneLabel}</strong>
                  </div>
                </div>
              ) : null}
              <div className="hub-roster-contract-panel-actions">
                {selectedStory?.isCut ? (
                  <button
                    type="button"
                    className="btn-ghost btn-sm hub-uncut-btn"
                    disabled={Boolean(cutBusyId)}
                    onClick={() => undoCut(selectedCapRow.player_id)}
                  >
                    Undo cut
                    <span className="hub-btn-support">{selectedStory.undoSupport}</span>
                  </button>
                ) : null}
                <ContractHistoryLink
                  playerId={selectedCapRow.player_id}
                  playerName={selectedCapRow.player_name}
                />
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </HubPage>
  );
}
