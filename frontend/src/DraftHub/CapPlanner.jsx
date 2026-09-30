import React, { useEffect, useRef, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import { HubPage, HubFilterMenu, HubAlert, HubLoadingSkeleton } from "./HubUILayout";
import { leagueUsesSalaries } from "./leagueCapabilities";
import { identityFor, useTeamIdentities } from "./TeamIdentityContext";
import IdentityCropMedia from "./IdentityCropMedia";
import { identityMediaUrl, mergeTeamIdentity, HUB_MEDIA_HERO_WIDTH } from "./atmosphereCatalog";
import { hubTeamParts } from "./hubTeamLabel";
import ContractHistoryLink from "./ContractHistoryLink";
import { fmtSal, contractDeadCapStory } from "./rosterFormat";
import { confirmDialog } from "../ui/confirm";
import { postRookieExtend, cancelRookieExtend, canManagerRookieExtend, rookieExtendSuccessMessage } from "./rookieExtend";
import { playersTabAddMode, playersTabBanner } from "./acquisitionWindow";
import { CAP_PLANNER_COPY as C, CAP_UNAVAILABLE_COPY, CAP_CUT_COPY, capPlannerProjection, previewCutFunds, capCutFundsAction, capCutConfirmCopy, capStepUpLine, capCutRefundLine, rosterPositionNeeds, rosterNeedLine, parseNeedErrors } from "./capPlannerPresentation";
import "../styles/cap-planner.css";
export default function CapPlanner({
  capSheet,
  roster = [],
  workspace,
  hubContext,
  onChanged,
  onNavigate,
  valueRows = [],
  acquisitionWindow,
  onOpenContractHistory
}) {
  const scope = `${hubContext?.league_id || workspace?.id || "solo"}:${hubContext?.team_id || ""}`;
  return <CapPlannerView key={scope} {...{
    capSheet,
    roster,
    workspace,
    hubContext,
    onChanged,
    onNavigate,
    valueRows,
    acquisitionWindow,
    onOpenContractHistory
  }} />;
}
function CapPlannerView({
  capSheet,
  roster,
  workspace,
  hubContext,
  onChanged,
  onNavigate,
  valueRows,
  acquisitionWindow,
  onOpenContractHistory
}) {
  const [teamId, setTeamId] = useState("");
  const [around, setAround] = useState(false);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [year, setYear] = useState(0);
  const [plans, setPlans] = useState({});
  const [editor, setEditor] = useState("");
  const [mode, setMode] = useState("add");
  const [cutId, setCutId] = useState("");
  const [target, setTarget] = useState("");
  const [msg, setMsg] = useState("");
  const [cutBusyId, setCutBusyId] = useState("");
  const [extendBusy, setExtendBusy] = useState(false);
  const {
    identities
  } = useTeamIdentities();
  const leagueId = hubContext?.mode === "league" ? hubContext.league_id : "";
  const ownId = String(hubContext?.team_id || "mine");
  const selected = teams.find(t => String(t.team.id) === teamId);
  const own = !teamId || teamId === ownId;
  const scopeId = own ? ownId : teamId;
  const sheet = own ? capSheet : selected?.cap_sheet;
  const rules = workspace?.rules || hubContext?.rules;
  const base = Number(capSheet?.season || workspace?.season || new Date().getFullYear());
  const chosenPlans = plans[scopeId] || {};
  const projection = capPlannerProjection(sheet, chosenPlans);
  const offset = Math.min(year, Math.max(0, projection.years.length - 1));
  const current = projection.years[offset];
  const draftCompleted = Boolean(hubContext?.draft_completed);
  const cap = Number(sheet?.summary?.salary_cap ?? rules?.salary_cap);
  const activeRows = projection.rows.filter(r => Number(r.cap_hits[offset]) > 0 || offset === 0 && r.is_active);
  const cutRow = projection.rows.find(r => String(r.player_id) === cutId);
  const savedRow = (own ? roster : projection.rows).find(r => String(r.player_id) === cutId);
  const hit = Number(cutRow?.cap_hits[offset] || 0);
  const refund = rules?.contracts?.cut_refund_pct ?? .5;
  const newDead = offset === 0 ? Math.floor(hit * (1 - refund)) : 0;
  const remaining = Number(current?.cap_remaining);
  const after = remaining + (mode === 'cut' ? hit - newDead : 0) - (Number(target) || 0);
  const cuts = sheet?.pre_draft?.pending_cuts || [];
  const queued = sheet?.pre_draft?.queued_extensions || [];
  const caption = own ? hubContext?.team_name || C.own : hubTeamParts(selected?.team).team || selected?.team.name;
  const owner = own ? "" : hubTeamParts(selected?.team).owner;
  const triggerRefs = useRef({});
  const aroundRef = useRef(null);
  const headingRef = useRef(null);
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (around) headingRef.current?.focus({
      preventScroll: true
    });
  }, [around]);
  const loadTeams = async () => {
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    setLoading(true);
    setLoadError("");
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/cap-plans`, {
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      if (!ctrl.signal.aborted) setTeams(data.teams || []);
    } catch (e) {
      if (!ctrl.signal.aborted) setLoadError(e.message || C.loadError);
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  };
  const closeAround = () => {
    setAround(false);
    requestAnimationFrame(() => aroundRef.current?.focus({
      preventScroll: true
    }));
  };
  const selectTeam = id => {
    setTeamId(String(id));
    setYear(0);
    setEditor("");
    setCutId("");
    setMode("add");
    setTarget("");
    setMsg("");
    closeAround();
  };
  const chooseYears = (row, n) => {
    setPlans(prev => ({
      ...prev,
      [scopeId]: {
        ...(prev[scopeId] || {}),
        [row.player_id]: n
      }
    }));
    setEditor("");
    requestAnimationFrame(() => triggerRefs.current[row.player_id]?.focus({
      preventScroll: true
    }));
  };
  const reset = () => {
    setMode("add");
    setCutId("");
    setTarget("");
    setEditor("");
    setPlans(prev => ({
      ...prev,
      [scopeId]: {}
    }));
  };
  const cutPreview = own && savedRow ? previewCutFunds({
    row: savedRow,
    leftover: sheet?.summary?.remaining,
    rules,
    availableRows: valueRows,
    addMode: playersTabAddMode(acquisitionWindow, {
      inLeague: Boolean(leagueId)
    }),
    minBid: Number(rules?.auction?.min_bid || 1)
  }) : null;
  const cutAction = capCutFundsAction(cutPreview);
  const cutAndHandoff = async () => {
    if (!cutPreview || cutPreview.is_cut || cutBusyId) return;
    if (!own || offset !== 0 || !canWrite) return;
    const ok = await confirmDialog({
      title: CAP_CUT_COPY.confirmTitle(cutPreview.player_name),
      message: capCutConfirmCopy(cutPreview),
      confirmLabel: cutAction.label,
      cancelLabel: CAP_CUT_COPY.keep,
      danger: true
    });
    if (!ok) return;
    setCutBusyId(String(cutPreview.player_id));
    setMsg("");
    try {
      const res = await apiFetch("/api/hub/roster", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          player_id: cutPreview.player_id,
          roster_status: "cut_before_draft"
        })
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      setMsg(C.cutSaved);
      setCutId("");
      onChanged?.();
      if (['cut-add', 'cut-bid'].includes(cutAction.kind)) onNavigate?.("available", {
        player: cutPreview.funded_player_id || "",
        pos: cutPreview.funded_position || undefined
      });
    } catch (e) {
      setMsg(e.message || C.errorCut);
    } finally {
      setCutBusyId("");
    }
  };
  const undoCut = async playerId => {
    if (!own || !canWrite) return;
    setCutBusyId(String(playerId));
    setMsg("");
    try {
      const res = await apiFetch("/api/hub/roster", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          player_id: playerId,
          roster_status: "active"
        })
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      onChanged?.();
    } catch (e) {
      setMsg(e.message || C.errorUndo);
    } finally {
      setCutBusyId("");
    }
  };
  const saveExtension = async row => {
    if (!own || !canWrite || !canManagerRookieExtend(row, {
      draftCompleted,
      rules
    }).ok) return;
    setExtendBusy(true);
    setMsg("");
    try {
      const data = await postRookieExtend(row.player_id, chosenPlans[row.player_id], rules?.contracts?.max_years);
      chooseYears(row, 0);
      setMsg(rookieExtendSuccessMessage(data));
      onChanged?.();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setExtendBusy(false);
    }
  };
  const undoExtension = async id => {
    if (!own || !canWrite) return;
    setExtendBusy(true);
    try {
      await cancelRookieExtend(id);
      onChanged?.();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setExtendBusy(false);
    }
  };
  const canWrite = (!leagueId || Boolean(hubContext?.team_id)) && hubContext?.readonly !== true;
  const needs = own ? rosterPositionNeeds({
    roster,
    limits: rules?.roster || {}
  }) : {
    needs: []
  };
  const needLine = rosterNeedLine(needs.needs, {
    minimumTotal: needs.minimumTotal
  });
  const otherErrors = parseNeedErrors(sheet?.validation_errors || []).other;
  if (!leagueUsesSalaries(hubContext)) return <HubPage><h1>{CAP_UNAVAILABLE_COPY.heading}</h1><p>{CAP_UNAVAILABLE_COPY.body}</p></HubPage>;
  if (!sheet?.summary || !current) return <HubPage><p role="status">{C.noData}</p></HubPage>;
  const sumDead = Number(current.dead_cap || 0);
  const salary = Number(current.total_committed) - sumDead;
  const moveBanner = own && leagueId ? playersTabBanner(acquisitionWindow) : null;
  return <HubPage frameless className="cap-planner-page">
    {around ? <section className="cap-planner-discovery" aria-labelledby="cap-league-title">
      <header><h1 id="cap-league-title" ref={headingRef} tabIndex={-1}>{C.around}</h1><button className="btn-ghost" onClick={closeAround}>← {C.back}</button></header>
      <input type="search" aria-label={C.search} placeholder={C.search} value={query} onChange={e => setQuery(e.target.value)} />
      <p className="cap-planner-meta">{base} · {C.available}</p>
      {loading ? <div className="cap-planner-teams" aria-label={C.loading}>{[0, 1].map(i => <div className="cap-planner-team-loading" key={i}><HubLoadingSkeleton label={C.loading} rows={2} /></div>)}</div> : loadError ? <HubAlert variant="danger">{loadError}<button className="btn-ghost" onClick={loadTeams}>{C.retry}</button></HubAlert> : <div className="cap-planner-teams">
        {teams.filter(t => `${hubTeamParts(t.team).team} ${hubTeamParts(t.team).owner}`.toLowerCase().includes(query.toLowerCase())).map(block => {
          const team = block.team,
            look = mergeTeamIdentity(identityFor(identities, team)),
            url = identityMediaUrl(look, "banner", {
              width: HUB_MEDIA_HERO_WIDTH
            }),
            parts = hubTeamParts(team);
          return <button key={team.id} className="cap-planner-team" onClick={() => selectTeam(team.id)} aria-label={`${parts.team}, ${fmtSal(block.cap_sheet.summary.remaining)} ${C.available}`}>
            <span className={`cap-planner-team-banner hub-banner-fill--${look.banner_preset}`}>{url && <IdentityCropMedia src={url} focus={look.banner_focus} width={HUB_MEDIA_HERO_WIDTH} />}<span><strong>{parts.team || team.name}</strong><small>{parts.owner}</small></span></span>
            <span className="cap-planner-team-cap"><span>{C.available}<strong>{fmtSal(block.cap_sheet.summary.remaining)}</strong></span><span aria-hidden="true">↗</span></span>
          </button>;
        })}{!teams.filter(t => `${hubTeamParts(t.team).team} ${hubTeamParts(t.team).owner}`.toLowerCase().includes(query.toLowerCase())).length && <p role="status">{C.noTeams}</p>}
      </div>}
    </section> : <>
      <header className="cap-planner-context"><div><strong>{caption}</strong>{owner && <small>{owner} · {C.preview}</small>}</div>
        {leagueId && <button ref={aroundRef} className="btn-ghost" onClick={() => {
          setAround(true);
          setQuery("");
          loadTeams();
        }}>{C.around} ↗</button>}</header>
      <section className="cap-planner-balance"><h1>{offset ? `${base + offset} ${C.available}` : !draftCompleted ? C.draft : C.available}</h1><strong>{fmtSal(remaining)}</strong><p className="cap-planner-meta">{base + offset} · {fmtSal(cap)} cap</p>
        <div className="cap-planner-bar" aria-hidden="true"><span style={{
            width: `${Math.min(100, Math.max(0, salary / cap * 100))}%`
          }} /><i style={{
            width: `${Math.min(100, Math.max(0, sumDead / cap * 100))}%`
          }} /></div>
        <p className="cap-planner-meta">{fmtSal(salary)} {C.salary} · {fmtSal(sumDead)} {C.dead} · {fmtSal(current.total_committed)} {C.used}</p>
        <div className="cap-planner-years" role="group" aria-label="Cap season">{projection.years.map((_, i) => <button key={i} aria-pressed={i === offset} onClick={() => {
            setYear(i);
            setEditor("");
            setCutId("");
          }}>{base + i}</button>)}</div>
      </section>
      <div className="cap-planner-columns"><div className="cap-planner-main"><section className="cap-planner-card">
        <header><h2>{C.sheet}</h2><span className="cap-planner-meta">{activeRows.length} players · {base + offset}</span></header>
        <div className="cap-planner-list">{activeRows.map(row => {
                const id = String(row.player_id),
                  added = Number(chosenPlans[id] || 0),
                  saved = queued.find(q => String(q.player_id) === id);
                const eligible = Boolean(row.extension_terms?.length) && offset === row.extension_eligible_offset;
                const reason = row.contract?.contract_type === 'extension' || row.contract?.renewal_used ? C.alreadyExtended : row.extension_terms?.length ? C.notFinal : C.extensionsOff;
                const yearsLeft = row.preview_term ? row.preview_term.start_offset + row.preview_term.years - offset : Number(row.contract?.years_remaining || row.contract_years || 1) - offset;
                return <div className="cap-planner-row" key={row.id || id}>
            <button className="cap-planner-player" aria-label={`${row.player_name}, ${fmtSal(row.cap_hits[offset])}, preview cut`} aria-pressed={id === cutId} disabled={!row.is_active} onClick={() => {
                    setCutId(id);
                    setMode('cut');
                  }}><span><strong>{row.player_name}</strong><small>{row.position} · {row.team}</small></span><span><strong>{fmtSal(row.cap_hits[offset])}</strong><small>{row.is_active ? yearsLeft > 0 ? C.yearsLeft(yearsLeft) : C.expiring : C.dead}</small></span></button>
            {row.is_active && <div className="cap-planner-extension"><small>{added ? C.preview : saved ? `${C.queued} · ${saved.queued_years} yrs` : eligible ? C.eligible(base + row.extension_eligible_offset) : reason}</small>{(eligible || Boolean(added)) && <button ref={el => {
                      triggerRefs.current[id] = el;
                    }} className="btn-ghost" aria-expanded={editor === id} aria-controls={`cap-extend-${id}`} onClick={() => setEditor(editor === id ? '' : id)}>{added ? C.previewYears(added) : `${C.extend} +`}</button>}</div>}
            {editor === id && <div className="cap-planner-extension-years" id={`cap-extend-${id}`} role="group" aria-label={`${row.player_name} extension years`}><button className="btn-ghost" onClick={() => chooseYears(row, 0)}>{C.revert}</button>{row.extension_terms.map(t => <button key={t.years} className="btn-ghost" aria-pressed={added === t.years} onClick={() => chooseYears(row, t.years)}>+{t.years} {t.years === 1 ? 'yr' : 'yrs'}</button>)}</div>}
          </div>;
              })}{!activeRows.length && <p>{C.noRoster}</p>}</div>
      </section>
      <details className="cap-planner-card cap-planner-disclosure"><summary><span className="cap-planner-disclosure-title">{C.contracts}<i aria-hidden="true" /></span></summary><div className="cap-planner-details">
        {own && projection.rows.filter(r => chosenPlans[r.player_id] && canManagerRookieExtend(r, {
                draftCompleted,
                rules
              }).ok).map(r => <div key={r.player_id}><span>{r.player_name} · +{chosenPlans[r.player_id]} yrs</span><button className="btn-ghost" disabled={extendBusy || !canWrite} onClick={() => saveExtension(r)}>{C.saveExtension}</button></div>)}
        {queued.map(q => <div key={q.player_id}><span>{q.player_name} · {q.queued_years} {C.queued.toLowerCase()}</span>{own && <button className="btn-ghost" disabled={extendBusy || !canWrite} onClick={() => undoExtension(q.player_id)}>{C.revert}</button>}</div>)}
        {cuts.map(c => <div key={c.player_id}><span>{c.player_name} · {contractDeadCapStory(c, rules).cutBullet}</span>{own && c.can_undo_cut !== false && <button className="btn-ghost" disabled={Boolean(cutBusyId) || !canWrite} onClick={() => undoCut(c.player_id)}>{C.removeCut}</button>}</div>)}
        {projection.rows.map(r => <ContractHistoryLink key={r.id || r.player_id} playerId={r.player_id} playerName={r.player_name} onOpen={onOpenContractHistory}>{r.player_name}</ContractHistoryLink>)}
      </div></details></div>
      <aside className="cap-planner-side" aria-label="Move preview"><section className="cap-planner-card cap-planner-move"><h2>{C.move}</h2>
        <div className="cap-planner-modes" role="group" aria-label="Move preview">{[['add', C.add], ['cut', C.cutAdd]].map(([id, label]) => <button key={id} aria-pressed={mode === id} onClick={() => {
                setMode(id);
                setCutId("");
              }}>{label}</button>)}</div>
        {mode === 'cut' && <HubFilterMenu label={C.cutPlayer} value={cutId} options={[{
              id: '',
              label: C.choose
            }, ...activeRows.filter(r => r.is_active).map(r => ({
              id: String(r.player_id),
              label: r.player_name
            }))]} onChange={setCutId} />}
        <label className="cap-planner-field"><span>{C.target}</span><div><span aria-hidden="true">$</span><input inputMode="numeric" type="text" aria-label={C.target} value={target} onChange={e => setTarget(e.target.value.replace(/[^0-9]/g, ''))} /></div></label>
        <div className="cap-planner-impact" aria-live="polite"><div><span>{C.now}</span><strong>{fmtSal(remaining)}</strong></div><div><span>{C.after}</span><strong className={after >= 0 ? 'is-positive' : 'is-negative'}>{fmtSal(after)}</strong></div></div>
        {mode === 'cut' && cutRow && <p className="cap-planner-meta">{C.cutDead} · {fmtSal(newDead)}</p>}
        {after < 0 && <HubAlert variant="warn">{C.over(fmtSal(-after))}</HubAlert>}
        {own ? mode === 'cut' && cutRow && offset === 0 ? <><p className="cap-planner-meta">{cutAction.support}</p>{moveBanner && <p className="cap-planner-meta">{moveBanner.text || moveBanner}</p>}<button className="btn-primary" disabled={!canWrite || Boolean(cutBusyId) || !cutPreview || cutPreview.is_cut || after < 0} onClick={cutAndHandoff}>{cutAction.label || C.reviewCut}</button></> : <button className="btn-primary" disabled={after < 0} onClick={() => onNavigate?.('available')}>{C.freeAgents} →</button> : <button className="btn-ghost" onClick={() => selectTeam(ownId)}>{C.myCap} →</button>}
        <button className="btn-ghost cap-planner-reset" onClick={reset}>{C.reset}</button><p className="cap-planner-meta">{C.previewOnly}</p>
        {own && needLine && <p className="cap-planner-meta">{needLine}</p>}
      </section><details className="cap-planner-card cap-planner-disclosure"><summary><span className="cap-planner-disclosure-title">{C.rules}<i aria-hidden="true" /></span></summary><div className="cap-planner-details"><p>{capStepUpLine({
                  rookieStatic: rules?.contracts?.rookie_salary_static !== false,
                  veteranStatic: rules?.contracts?.veteran_salary_static !== false,
                  stepUp: rules?.contracts?.extension_step_up
                })}</p><p>{capCutRefundLine(refund * 100)}</p></div></details></aside></div>
      {msg && <p role="status">{msg}</p>}{otherErrors.map((e, i) => <HubAlert key={i} variant="warn">{e}</HubAlert>)}
    </>}
  </HubPage>;
}
