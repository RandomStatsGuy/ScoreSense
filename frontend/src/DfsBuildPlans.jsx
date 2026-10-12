import React, { useEffect, useRef, useState } from "react";
import { createBuildPlan, readBuildPlan, writeBuildPlan, previewBuildPlan, applyBuildPlan, assertBuildPlanApplied, BUILD_PLAN_MAX_BYTES } from "./dfsBuildPlans.js";
import { DFS_GUARDRAIL_COPY as C, buildPlanValue } from "./dfsToolPresentation.js";

export default function DfsBuildPlans({ b }) {
  const [label, setLabel] = useState(""), [preview, setPreview] = useState(null), [error, setError] = useState("");
  const fileInput = useRef(null), importButton = useRef(null), readGeneration = useRef(0);
  const contextKey = JSON.stringify([b.context, b.buildPlanValidation.salarySnapshot?.id]);
  useEffect(() => {
    readGeneration.current++; setPreview(null); setError("");
    const reset = () => { readGeneration.current++; setPreview(null); setError(""); };
    window.addEventListener("scoresense-auth-changed", reset);
    return () => { readGeneration.current++; window.removeEventListener("scoresense-auth-changed", reset); };
  }, [contextKey]);
  const validation = b.buildPlanValidation;
  let matches = true;
  if (b.appliedPlan) { try { assertBuildPlanApplied(b.appliedPlan.manifest, b.getStrategyRequest()); } catch { matches = false; } }
  const download = () => {
    try {
      const plan = createBuildPlan({ id: `plan:${crypto.randomUUID()}`, label: label.trim() }, b.getStrategyRequest(), validation);
      const url = URL.createObjectURL(new Blob([writeBuildPlan(plan, validation)], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = "scoresense-build-plan.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setError("");
    } catch (e) { setError(e.message); }
  };
  const read = async file => {
    if (!file) return;
    const version = ++readGeneration.current;
    // Capture exact slate and controls before reading; apply will reject a stale preview.
    const original = b.getStrategyRequest(), originalValidation = validation;
    try {
      if (file.size > BUILD_PLAN_MAX_BYTES) throw new Error(C.planReadError);
      const plan = readBuildPlan(await file.text(), originalValidation);
      if (version !== readGeneration.current) return;
      setPreview(previewBuildPlan(plan, original, originalValidation)); setError("");
    } catch (e) { if (version === readGeneration.current) { setPreview(null); setError(e.message || C.planReadError); } }
  };
  const apply = () => {
    try {
      const result = applyBuildPlan(preview, b.getStrategyRequest(), validation);
      b.applyBuildPlanInputs({ ...result, label: preview.plan.label }); importButton.current?.focus(); setPreview(null); setError("");
    } catch (e) { setError(e.message); }
  };
  return <details className="dfw-plans" data-testid="dfs-build-plans"><summary>{C.plans}</summary>
    <div className="dfw-guardrail-body">
      <p className="dfw-note">{C.planHelp}</p>
      <label className="dfw-field"><span>{C.planName}</span><input maxLength="100" value={label} disabled={b.building} onChange={e => setLabel(e.target.value)} /></label>
      <div className="dfw-plan-actions"><button type="button" disabled={b.building} onClick={download}>{C.downloadPlan}</button>
        <button ref={importButton} type="button" disabled={b.building} onClick={() => fileInput.current?.click()}>{C.importPlan}</button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden aria-label={C.importPlan}
          onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; read(file).catch(err => setError(err.message)); }} /></div>
      {preview && <section className="dfw-global-verdict" aria-label={C.preview}>
        <h3>{C.preview}: {preview.plan.label}</h3>
        <p className="dfw-note">{C.planContext(preview.plan.inputs.lineup_count, preview.plan.inputs.locked_player_ids.length, preview.plan.inputs.excluded_player_ids.length, preview.plan.inputs.group_exposure_limits.length)}</p>
        <strong>{C.planChanges}</strong>
        {preview.manifest.changes.length ? <ul className="dfw-plan-changes">{preview.manifest.changes.map(change => <li key={change.field}>
          <strong>{C.fields[change.field] || change.field}</strong><div>{buildPlanValue(change.field, change.before, b.pool)} → {buildPlanValue(change.field, change.after, b.pool)}</div>
        </li>)}</ul> : <p className="dfw-note">{C.unchanged}</p>}
        <div className="dfw-plan-actions"><button type="button" disabled={b.building} onClick={apply}>{C.applyPlan}</button>
          <button type="button" onClick={() => { importButton.current?.focus(); readGeneration.current++; setPreview(null); setError(""); }}>{C.cancelPlan}</button></div>
      </section>}
      {b.appliedPlan && <div role="status" className="dfw-global-verdict"><strong>{C.approved(b.appliedPlan.label)}</strong>
        <p className={matches ? "dfw-note" : "dfw-error"}>{matches ? C.planReady : C.changed}</p>
        <button type="button" disabled={b.building} onClick={b.releaseBuildPlan}>{C.release}</button><p className="dfw-note">{C.releaseHelp}</p></div>}
      {error && <p role="alert" className="dfw-error">{error}</p>}
    </div>
  </details>;
}
