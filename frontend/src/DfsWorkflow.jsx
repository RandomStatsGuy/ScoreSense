import React, { useEffect, useRef, useState } from "react";
import { DFS_WORKFLOW_COPY as C } from "./dfsToolPresentation.js";
import { solverEvidence } from "./dfsWorkspaceState.js";

const display = value => value == null || value === "" ? "—" : typeof value === "number" ? Number(value.toFixed(2)).toLocaleString() : String(value);

export function DfsBuildStatus({ b, onCancel }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!b.building) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [b.building]);
  const job = b.buildJob;
  const evidence = solverEvidence(b.portfolioSelection);
  if (!job && !evidence) return null;
  const seconds = job ? Math.max(0, Math.floor(((job.finishedAt || now) - job.startedAt) / 1000)) : null;
  return <div className="dfw-build-status" data-testid="dfs-build-status">
    {job && <><div className="dfw-actions"><strong role="status">{job.status === "running" ? C.buildBusy : C.jobs[job.status]}</strong><span>{C.elapsed(seconds)}</span>
      {b.building && <button type="button" onClick={onCancel || b.cancelBuild}>{C.cancelBuild}</button>}</div>
      {b.building && <p className="dfw-note">{C.cancelHelp}</p>}
      {["running", "failed", "cancelled"].includes(job.status) && b.lineups.length > 0 && <p className="dfw-note">{C.buildRetained(b.lineups.length)}</p>}
    </>}
    {evidence && <details><summary>{C.solver}</summary><dl className="dfw-evidence-values">
      {[[C.requested, evidence.requested], [C.selected, evidence.selected], [C.unique, evidence.unique], [C.candidates, evidence.candidates], [C.solverStatus, evidence.status], [C.runtime, evidence.runtime], [C.bound, evidence.bound], [C.gap, evidence.gap]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value == null ? C.unknown : display(value)}</dd></div>)}
    </dl><p className="dfw-note">{C.projectionScope}</p></details>}
  </div>;
}

export function DfsCapabilityReview({ capabilities }) {
  return <details className="dfw-capabilities" data-testid="dfs-capabilities"><summary>{C.capabilities}</summary>
    <dl className="dfw-evidence-values">{Object.entries(C.capabilityLabels).map(([key, label]) => <div key={key}><dt>{label}</dt><dd data-capability={key}>{C.capabilityStates[capabilities[key]]}</dd></div>)}</dl>
    <p className="dfw-note">{C.capabilityHelp}</p>
  </details>;
}

export function DfsInputUpdate({ b }) {
  const [page, setPage] = useState(0);
  const returnFocus = useRef(null);
  const updateRef = useRef(null);
  const previous = useRef(null);
  const update = b.poolUpdate;
  useEffect(() => {
    setPage(0);
    if (update && !previous.current) { returnFocus.current = document.activeElement; updateRef.current?.focus({ preventScroll: true }); }
    if (!update && previous.current) {
      const target = returnFocus.current;
      if (target?.isConnected && target !== document.body && target.getClientRects().length) target.focus({ preventScroll: true });
      else (updateRef.current || document.querySelector('[data-testid="dfs-generate"]'))?.focus({ preventScroll: true });
    }
    previous.current = update;
  }, [update]);
  const history = b.poolUpdateHistory;
  if (!update && !history) return null;
  const diff = update?.diff || history;
  return <section className="dfw-input-update dfw-panel" aria-labelledby="dfs-input-update-title" ref={updateRef} tabIndex={-1} data-testid="dfs-pool-update-preview">
    <div className="dfw-panel-head"><h2 id="dfs-input-update-title">{update ? C.updateTitle : C.appliedUpdate}</h2><span>{C.updateVersion(diff.fromVersion, diff.toVersion)}{history?.undoneAt && !update ? ` · ${C.undoneUpdate}` : ""}</span></div>
    <p className="dfw-note">{C.updateSummary}</p>
    {(update?.resetStrategy || history?.resetStrategy) && <p className="dfw-note">{C.catalogReset}</p>}
    <details key={update ? 'pending' : 'history'}><summary>{C.changedInputs} · <span>{C.updateCount(diff.changes.length)}</span></summary>
      <p className="dfw-note">{C.updateScope}</p>
      {diff.metadataChanged && <p className="dfw-note">{C.metadataChanged}</p>}
      <div className="dfw-update-list">{diff.changes.slice(page * 8, page * 8 + 8).map(change => <article key={change.id}>
        <strong>{change.name}</strong><small>{C.updateKinds[change.kind]}</small>
        <dl>{change.fields.map(field => <div key={field}><dt>{C.metrics[field] || field}</dt><dd><span aria-label={C.before}>{display(change.before?.[field])}</span><span aria-hidden="true"> → </span><span aria-label={C.after}>{display(change.after?.[field])}</span></dd></div>)}</dl>
      </article>)}</div>
      {diff.changes.length > 8 && <div className="dfw-pagination"><span>{page + 1} / {Math.ceil(diff.changes.length / 8)}</span><button type="button" aria-label={C.previousChanges} disabled={!page} onClick={() => setPage(p => p - 1)}>‹</button><button type="button" aria-label={C.nextChanges} disabled={(page + 1) * 8 >= diff.changes.length} onClick={() => setPage(p => p + 1)}>›</button></div>}
    </details>
    <div className="dfw-actions">{update ? <><button type="button" onClick={b.applyPoolUpdate} disabled={b.busy || b.building}>{C.applyUpdate}</button><button type="button" onClick={b.dismissPoolUpdate}>{C.keepInputs}</button></> : b.canUndoPoolUpdate && <button type="button" disabled={b.busy || b.building} onClick={b.undoPoolUpdate}>{C.undoUpdate}</button>}</div>
  </section>;
}

export function DfsJourney({ counts = {}, stage, onBuild, onReview, onEntries, canReview, canBuild = true }) {
  const builtCount = counts.selected || counts.generated || counts.unique || 0;
  const actions = [onBuild, onReview, onEntries];
  const metrics = Object.entries(counts).filter(([key, value]) => value != null && (key !== "assigned" || stage === 2));
  return <div className="dfw-journey" aria-label={C.journey} data-testid="dfs-workflow-summary">
    <ol>{C.stages.map((name, i) => <li key={name} aria-current={stage === i ? "step" : undefined}>
      <button type="button" data-testid={`dfs-flow-${["build", "review", "download"][i]}`} disabled={i === 0 ? !canBuild : !canReview} onClick={actions[i]} aria-current={stage === i ? "step" : undefined}>
        <span className="dfw-journey-number" aria-hidden="true">{i + 1}</span>{name}{i === 1 && builtCount > 0 && <span className="dfw-journey-count">{C.reviewCount(builtCount)}</span>}
      </button>
    </li>)}</ol>
    {builtCount > 0 && <details className="dfw-journey-details"><summary>{C.buildDetails}</summary>
      <dl>{metrics.map(([key, value]) => <div key={key}><dt>{C[key]}</dt><dd>{display(value)}</dd></div>)}</dl>
    </details>}
  </div>;
}
