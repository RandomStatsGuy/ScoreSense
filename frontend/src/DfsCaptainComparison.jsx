import React from "react";
import { DFS_CAPTAIN_COMPARISON_COPY as C, captainComparisonSummary, formatSalary } from "./dfsToolPresentation";

const score = value => Number.isFinite(value) ? value.toFixed(2) : "—";

export default function DfsCaptainComparison({ b }) {
  if (!b.isCaptain) return null;
  const report = b.comparison;
  const summary = captainComparisonSummary(report);
  return (
    <section className="dfw-panel" aria-labelledby="dfw-captain-comparison-title" aria-busy={b.comparing}>
      <div className="dfw-panel-head">
        <h2 id="dfw-captain-comparison-title">{C.title}</h2>
        <button type="button" onClick={b.compareCaptains} disabled={b.busy || b.building || b.comparing || !b.pool.length || !b.salaries.length}>
          {b.comparing ? C.loading : C.action}
        </button>
      </div>
      <p className="dfw-note">{C.help}</p>
      {b.settings.lockedCaptain && <p className="dfw-note">{C.locked}</p>}
      {b.comparisonError && <p role="alert" className="dfw-error">{b.comparisonError}</p>}
      {b.comparing && <p role="status" className="dfw-note">{C.loading}</p>}
      {!report && !b.comparing && !b.comparisonError && <p className="dfw-note">{b.pool.length ? C.ready : C.empty}</p>}
      {report && <>
        <p role="status" className="dfw-note">{summary.count} · {summary.objective}</p>
        {!summary.complete && <p className="dfw-notice">{C.partial}</p>}
        {!summary.solved.length && <p className="dfw-note">{C.none}</p>}
        <p className="dfw-note">{C.semantics}</p>
        {summary.rows.map(row => {
          const valid = summary.solved.includes(row);
          return valid ? (
            <details key={row.captain_id}>
              <summary>{row.captain_name} · {score(row.objective_score)} · {C.gap}: {score(row.gap_from_best_evaluated)}</summary>
              <p className="dfw-note">{C.salary}: {formatSalary(row.result.total_salary)}</p>
              {row.result.lineup.map(player => <div className="dfw-lineup-row" key={player.slot}>
                <small>{player.slot}</small>
                <div><strong>{player.player}</strong><small>{player.team} · {player.position}</small></div>
                <span>{formatSalary(player.salary)}</span>
              </div>)}
            </details>
          ) : <p className="dfw-note" key={row.captain_id}>{row.captain_name} · {row.status === "optimal" ? C.status.invalid : (C.status[row.status] || C.status.unresolved)}</p>;
        })}
      </>}
    </section>
  );
}
