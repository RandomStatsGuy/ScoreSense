import React, { useEffect, useRef, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import { confirmDialog } from "../ui/confirm";
import useAsyncActionScope from "../ui/useAsyncActionScope";
import { HubAlert } from "./HubUILayout";
import { SCORING_COPY } from "./rulesPresentation";
import { LEAGUE_SCORING_CONTROL_COPY as COPY } from "./gameCenterPresentation";

export default function LeagueScoringControl({ leagueId, data, hubContext, onNavigate, onScored }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const sleeperId = data?.hub_context?.sleeper_league_id || hubContext?.sleeper_league_id;
  const linked = Boolean(sleeperId || data?.source === "sleeper");
  const control = data?.scoring_control;
  const scored = Boolean(control?.scored);
  const live = Boolean(control?.live) && !control?.slate_complete;
  const canCalculate = Boolean(hubContext?.is_commissioner && !hubContext?.readonly && !linked
    && control && data?.week && hubContext?.draft_completed && control.week_started !== false);
  const scope = JSON.stringify([leagueId, data?.season, data?.week, canCalculate, linked]);
  const captureScope = useAsyncActionScope(scope);
  const inFlight = useRef(false);
  useEffect(() => {
    inFlight.current = false;
    setBusy(false); setMessage(""); setError("");
  }, [scope]);
  const disabled = busy || !canCalculate;
  const calculate = async () => {
    if (disabled || inFlight.current) return;
    const isCurrent = captureScope();
    inFlight.current = true;
    try {
      if (scored && !(await confirmDialog({ title: COPY.recalculate, message: COPY.confirm(data.week, { live }), confirmLabel: COPY.recalculate, danger: true }))) return;
      if (!isCurrent()) return;
      setBusy(true); setMessage(""); setError("");
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/score-week`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ season: Number(data.season), week: Number(data.week) }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const result = await res.json();
      if (!isCurrent()) return;
      setMessage(COPY.result(result));
      if (result.scored) onScored?.();
    } catch (e) {
      if (isCurrent()) setError(e.message || COPY.failed);
    } finally {
      if (isCurrent()) { inFlight.current = false; setBusy(false); }
    }
  };
  const lastCalculated = control?.run?.scored_at
    ? COPY.lastCalculated(control.run.scored_at)
    : "";
  return (
    <details className="league-scoring-control">
      <summary>
        <span className="league-scoring-control__summary-row">
          <span>
            <strong>{linked ? COPY.sleeper : COPY.native}</strong>
            {lastCalculated && <small>{lastCalculated}</small>}
          </span>
          <span className="league-scoring-control__label">{COPY.details}</span>
        </span>
      </summary>
      <div className="league-scoring-control__body">
        <p className="chart-note">{linked ? COPY.sleeperHelp : COPY.nativeHelp}</p>
        <div className="hub-form-row">
          {linked && sleeperId && <a className="btn-ghost" href={`https://sleeper.com/leagues/${encodeURIComponent(sleeperId)}`} target="_blank" rel="noreferrer">{SCORING_COPY.openSleeper}</a>}
          {!linked && hubContext?.is_commissioner && !hubContext?.readonly && <button type="button" className="btn-ghost" disabled={disabled} onClick={calculate}>{busy ? COPY.busy : scored ? COPY.recalculate : COPY.calculate}</button>}
          <button type="button" className="btn-ghost" onClick={() => onNavigate?.("rules")}>{COPY.rules}</button>
        </div>
        {!linked && <>
          {data?.scoring_status === "live" && <p className="chart-note">{COPY.live}</p>}
          {data?.scoring_status === "pending" && <p className="chart-note">{COPY.pending}</p>}
          <p className="chart-note">{SCORING_COPY.supported}</p>
          {!hubContext?.draft_completed && <p className="chart-note">{COPY.draftFirst}</p>}
          {(!hubContext?.is_commissioner || hubContext?.readonly) && <p className="chart-note">{COPY.staff}</p>}
          {control?.settings_changed && <HubAlert variant="warn">{COPY.changed}</HubAlert>}
        </>}
        <p className="chart-note">{COPY.projections}</p>
        {message && <HubAlert variant="info">{message}</HubAlert>}
        {error && <HubAlert variant="danger">{error}</HubAlert>}
      </div>
    </details>
  );
}
