import React, { useEffect, useRef, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import { confirmDialog } from "../ui/confirm";
import { HubAlert } from "./HubUILayout";
import { SCORING_COPY } from "./rulesPresentation";
import { LEAGUE_SCORING_CONTROL_COPY as COPY } from "./gameCenterPresentation";

export default function LeagueScoringControl({ leagueId, data, hubContext, onNavigate, onScored }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const sleeperId = data?.hub_context?.sleeper_league_id || hubContext?.sleeper_league_id;
  const linked = Boolean(sleeperId || data?.source === "sleeper");
  const control = data?.scoring_control;
  const scored = Boolean(control?.scored);
  const disabled = busy || !control || !data?.week || !hubContext?.draft_completed;
  const calculate = async () => {
    if (disabled || linked || !hubContext?.is_commissioner) return;
    if (scored && !(await confirmDialog({ title: COPY.recalculate, message: COPY.confirm(data.week), confirmLabel: COPY.recalculate, danger: true }))) return;
    if (!mounted.current) return;
    setBusy(true); setMessage(""); setError("");
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/score-week`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ season: Number(data.season), week: Number(data.week) }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const result = await res.json();
      if (!mounted.current) return;
      setMessage(COPY.result(result));
      if (result.scored) onScored?.();
    } catch (e) {
      if (mounted.current) setError(e.message || COPY.failed);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <section className="league-scoring-control" aria-label={COPY.title}>
      <strong>{linked ? COPY.sleeper : COPY.native}</strong>
      <p className="chart-note">{linked ? COPY.sleeperHelp : COPY.nativeHelp}</p>
      <div className="hub-form-row">
        {linked && sleeperId && <a className="btn-ghost" href={`https://sleeper.com/leagues/${encodeURIComponent(sleeperId)}`} target="_blank" rel="noreferrer">{SCORING_COPY.openSleeper}</a>}
        {!linked && hubContext?.is_commissioner && <button type="button" className="btn-ghost" disabled={disabled} onClick={calculate}>{busy ? COPY.busy : scored ? COPY.recalculate : COPY.calculate}</button>}
        <button type="button" className="btn-ghost" onClick={() => onNavigate?.("rules")}>{COPY.rules}</button>
      </div>
      {!linked && <>
        <p className="chart-note">{SCORING_COPY.supported}</p>
        {!hubContext?.draft_completed && <p className="chart-note">{COPY.draftFirst}</p>}
        {!hubContext?.is_commissioner && <p className="chart-note">{COPY.staff}</p>}
        {control?.run?.scored_at && <p className="chart-note">{COPY.lastCalculated(control.run.scored_at)}</p>}
        {control?.settings_changed && <HubAlert variant="warn">{COPY.changed}</HubAlert>}
      </>}
      <p className="chart-note">{COPY.projections}</p>
      {message && <HubAlert variant="info">{message}</HubAlert>}
      {error && <HubAlert variant="danger">{error}</HubAlert>}
    </section>
  );
}
