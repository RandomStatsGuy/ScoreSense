import React, { useEffect, useRef, useState } from "react";
import useDfsLateSwap from "./useDfsLateSwap.js";
import { LATE_SWAP_SLOTS } from "./dfsLateSwap.js";
import { DFS_LATE_SWAP_COPY as C } from "./dfsToolPresentation.js";

const number = value => Number(value).toLocaleString("en-US", { maximumFractionDigits: 3 });
const time = value => new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
function Values({ rows, className = "" }) {
  return <dl className={`dfw-evidence-values ${className}`}>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
function Results({ review }) {
  const [page, setPage] = useState(0), target = useRef(null), { report } = review;
  const pool = new Map(review.package.catalog.map(row => [row.player_id, row]));
  const names = id => pool.get(id)?.name || id;
  const changed = report.entries.filter(row => row.changes.length).length;
  const pages = Math.ceil(report.entries.length / 6), current = Math.min(page, pages - 1);
  useEffect(() => { target.current?.focus({ preventScroll: true }); }, []);
  return <section className="dfw-guardrail-body" data-testid="dfs-late-swap-results" ref={target} tabIndex={-1} aria-label={C.result}>
    <h3>{C.result}</h3><p role="status">{C.changed(changed)} · {C.unchanged(report.entries.length - changed)}</p>
    <Values rows={[[C.inputSum, `${number(report.baseline.projection_sum)} → ${number(report.proposed.projection_sum)}`]]} />
    <details data-testid="dfs-late-swap-rosters"><summary>{C.rosters} · {report.entry_count}</summary>
      <ul className="dfw-review-list">{report.entries.slice(current * 6, current * 6 + 6).map(entry => <li key={entry.entry_id}>
        <h4>{C.entry(entry.entry_id)}</h4><p className="dfw-note">{entry.changes.length ? C.changedLabel : C.same}</p>
        <details><summary>{C.rosters}</summary><ol className="dfw-late-slots">{LATE_SWAP_SLOTS.map(slot => {
          const before = entry.before_slots[slot], after = entry.after_slots[slot], player = pool.get(after), locked = Object.hasOwn(entry.locked_slots, slot);
          return <li key={slot}><strong>{slot}{locked ? ` · ${C.lockedLabel}` : ""}</strong>
            <span>{before === after ? names(after) : <><span aria-label={C.before}>{names(before)}</span><span aria-hidden="true"> → </span><span aria-label={C.after}>{names(after)}</span></>}</span>
            <small>{player.team} · {player.position} · {player.dfs_id}</small>
          </li>;
        })}</ol><Values rows={[[C.salary, `${number(entry.salary_before)} → ${number(entry.salary_after)}`], [C.inputSum, `${number(entry.projection_before)} → ${number(entry.projection_after)}`]]} /></details>
      </li>)}</ul>
      {pages > 1 && <div className="dfw-review-controls"><button type="button" disabled={!current} onClick={() => setPage(current - 1)}>{C.previousPage}</button><span>{current + 1} / {pages}</span><button type="button" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>{C.nextPage}</button></div>}
    </details>
    <details data-testid="dfs-late-swap-method"><summary>{C.details}</summary>
      <p className="dfw-note">{C.inputHelp}</p><p className="dfw-note">{C.method}</p>
      <Values rows={[[C.decision, report.decision_at], [C.version, report.package_id], [C.planVersion, report.plan_id], [C.search, report.solver.proven_optimal ? C.optimal : report.solver.status === "feasible_time_limit" ? C.timeLimited : C.limited],
        [C.inputCount, report.candidate_count], [C.tried, report.solver.evaluated_trials], [C.runtime, `${number(report.runtime_seconds)}s`], [C.bound, report.solver.bound == null ? C.unknown : number(report.solver.bound)], [C.gap, report.solver.gap == null ? C.unknown : number(report.solver.gap)]]} />
      {!!report.targets.length && <><h4>{C.targets}</h4><ul>{report.targets.map(row => <li key={`${row.scope}:${row.id}`}>{C.targetMiss(row.scope === "player" ? names(row.id) : row.player_ids.map(names).join(" + "), row.actual_count, row.target_count)}</li>)}</ul></>}
      {!!report.rejected_options.length && <><h4>{C.rejected}</h4><ul>{report.rejected_options.map(row => <li key={row.candidate_id}>{C.entry(row.entry_id)} · {row.issues.map(C.issue).join(" · ")}</li>)}</ul></>}
      {review.summary.sources.map(source => <article key={source.source_id}><h4>{C.sourceKinds[source.kind]}</h4><Values rows={[[C.source, source.source_id], [C.hash, source.content_sha256], [C.known, source.as_of]]} /></article>)}
      {report.warnings.map(warning => <p className="dfw-note" key={warning}>{warning}</p>)}
    </details>
  </section>;
}
export default function DfsLateSwap({ b }) {
  const e = useDfsLateSwap(b);
  return <details className="dfw-panel dfw-flow-disclosure dfw-late-swap" data-testid="dfs-late-swap"><summary><span className="dfw-summary"><strong>{C.title}</strong></span></summary>
    <div className="dfw-detail-body"><div className="dfw-late-intro"><p className="dfw-note">{C.intro}</p><p className="dfw-note">{C.scope}</p></div>
      {e.unavailable && <p className="dfw-note">{C.unavailable}</p>}
      <label className="dfw-field dfw-scenario-file"><span>{C.file}</span><input type="file" accept=".json,application/json" disabled={e.unavailable || e.busy} onChange={event => { e.readFile(event.target.files?.[0]); event.target.value = ""; }} /></label>
      {e.candidate && <p className="dfw-note">{e.candidate.name}</p>}
      <div className="dfw-review-controls">
        {e.candidate && !e.chosen && (!e.preview || e.previewStale) && <button type="button" disabled={e.unavailable || e.busy} onClick={e.runPreview}>{C.preview}</button>}
        {e.preview && !e.chosen && <button type="button" disabled={e.busy || e.previewStale} onClick={e.choose}>{C.use}</button>}
        {e.chosen && <button type="button" disabled={e.busy || e.stale} onClick={e.plan}>{C.compare}</button>}
        {e.busy && <button type="button" onClick={e.cancel}>{C.cancel}</button>}
        {e.review && <button type="button" disabled={e.busy} onClick={e.download}>{C.download}</button>}
      </div>
      <p className="dfw-note" role="status" data-testid="dfs-late-swap-status">{e.status ? `${e.status} ${C.elapsed(e.elapsed)}` : e.notice || (e.chosen ? C.ready : C.idle)}</p>
      {e.error && <p className="dfw-error" role="alert">{e.error}</p>}
      {e.stale && <p className="dfw-note">{C.stale}</p>}
      {e.previous && <p className="dfw-note">{C.previous}</p>}
      {e.preview && <Values className="dfw-late-facts" rows={[[C.contest, e.preview.summary.contest.name], [C.entries, e.preview.summary.entry_count], [C.decision, time(e.preview.summary.decision_at)], [C.locked, e.preview.summary.locked_slot_count]]} />}
      {e.attempt && !e.attempt.complete && <details><summary>{C.conflicts}</summary><ul>{e.attempt.rejected_options.map(row => <li key={row.candidate_id}>{C.entry(row.entry_id)} · {row.issues.map(C.issue).join(" · ")}</li>)}</ul></details>}
      {e.review && <Results key={e.review.report.plan_id} review={e.review} />}
      <p className="dfw-note">{C.exportGate}</p>
      <details><summary>{C.fileHelp}</summary><p className="dfw-note">{C.fileFormat}</p><p className="dfw-note">{C.method}</p></details>
    </div>
  </details>;
}
