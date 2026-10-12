import React, { useState } from "react";
import { HubFilterMenu } from "./DraftHub/HubUILayout.jsx";
import useDfsContestPortfolio from "./useDfsContestPortfolio.js";
import { moneyFraction } from "./dfsContestResearch.js";
import { DFS_CONTEST_PORTFOLIO_COPY as C } from "./dfsToolPresentation.js";

const money = value => `≈${(moneyFraction(value) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}`;
const fraction = value => `${(moneyFraction({ ...value, unit: "USD_cents" }) * 100).toFixed(1)}%`;
const number = value => Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
function Values({ rows }) {
  return <dl className="dfw-evidence-values">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
function Results({ review }) {
  const [page, setPage] = useState(0), { report, snapshot } = review;
  const pool = new Map(snapshot.pool.map(row => [row.player_id, row])), indices = new Map(snapshot.lineups.map((row, index) => [row.lineup_id, index]));
  const selected = report.selected.evaluation_metrics, baseline = report.baseline.evaluation_metrics;
  const searchLabel = report.solver.proven_optimal ? C.optimal : report.solver.status === "feasible_time_limit" ? C.timeLimited : C.limited;
  const baselineAssumptions = new Map(report.baseline.evaluation.assumptions.map(row => [row.scenario_id, row]));
  const rows = [[C.average, money(baseline.mean_net_cents), money(selected.mean_net_cents)],
    [C.low, money(baseline.net_distribution.p10_cents), money(selected.net_distribution.p10_cents)],
    [C.top(report.objective.top_k), fraction(baseline.top_finish_fraction), fraction(selected.top_finish_fraction)]];
  if (report.objective.mode === "conditional_risk_adjusted_net") rows.push(
    [C.downside, money(baseline.cvar_loss_cents), money(selected.cvar_loss_cents)],
    [C.adjusted, money(baseline.risk_adjusted_net_cents), money(selected.risk_adjusted_net_cents)]);
  const pages = Math.ceil(report.selected_lineups.length / 6), visible = Math.min(page, pages - 1);
  return <div className="dfw-guardrail-body" data-testid="dfs-contest-portfolio-results">
    <h3>{C.result}</h3><p className="dfw-note">{C.conditional}</p>
    <div className="dfw-table-scroll"><table className="dfw-table dfw-review-compare"><thead><tr><th>{C.metric}</th><th className="num">{C.baseline}</th><th className="num">{C.proposed}</th></tr></thead>
      <tbody>{rows.map(([label, before, after]) => <tr key={label}><td>{label}</td><td className="num">{before}</td><td className="num">{after}</td></tr>)}</tbody></table></div>
    <p className="dfw-note">{C.search}: {searchLabel}</p>
    <details data-testid="dfs-contest-portfolio-rosters"><summary>{C.rosters} · {report.selected_count}</summary>
      <ul className="dfw-review-list">{report.selected_lineups.slice(visible * 6, visible * 6 + 6).map(row => <li key={row.lineup_id}>
        <h4>{snapshot.labels?.[indices.get(row.lineup_id)] || C.lineup(indices.get(row.lineup_id) + 1)}</h4>
        <p className="dfw-note">{C.salary}: {row.player_ids.reduce((sum, id) => sum + pool.get(id).salary, 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}</p>
        <details><summary>{C.roster}</summary><ol>{row.player_ids.map(id => <li key={id}>{pool.get(id).position} · {snapshot.player_labels?.[id] || id} · {pool.get(id).team}</li>)}</ol></details>
      </li>)}</ul>
      {pages > 1 && <div className="dfw-review-controls"><button type="button" disabled={!visible} onClick={() => setPage(visible - 1)}>{C.previousPage}</button><span>{visible + 1} / {pages}</span><button type="button" disabled={visible + 1 >= pages} onClick={() => setPage(visible + 1)}>{C.nextPage}</button></div>}
    </details>
    <details data-testid="dfs-contest-portfolio-method"><summary>{C.comparisonDetails}</summary>
      <p className="dfw-note">{C.projectionHelp}</p><p className="dfw-note">{C.lowHelp}</p><p className="dfw-note">{C.candidateOnly}</p><p className="dfw-note">{C.targetHelp}</p>
      <Values rows={[[C.goal, C.goals.find(row => row.id === report.objective.mode)?.label], [C.source, report.objective.scenario_id],
        [C.worst, `${((1 - Number(report.objective.risk_alpha)) * 100).toFixed(1)}%`], [C.weight, report.objective.risk_weight],
        [C.fees, money(report.selected.evaluation.assumptions[0].fees_cents)], [C.projection, `${number(report.baseline.projection_sum)} → ${number(report.selected.projection_sum)}`],
        [C.difference, money(report.comparison.evaluation_mean_net_difference_cents)], [C.selectionDraws, report.selected.evaluation.draw_count], [C.reviewDraws, report.selected.evaluation.draw_count],
        [C.frozen, snapshot.input_snapshot_id], [C.request, report.selection_request_id]]} />
      <Values rows={[[C.candidateCount, report.candidate_count], [C.requestedCount, report.requested_count], [C.chosenCount, report.unique_count],
        [C.trials, report.solver.evaluated_trials], [C.feasibleTrials, report.solver.evaluated_feasible_sets], [C.runtime, `${number(report.runtime_seconds)}s`],
        [C.baselineSearch, report.solver.baseline_proven_exact === true ? C.baselineProved : C.baselineUnproven],
        [C.targetProof, report.solver.target_stage_status === "optimal" ? C.targetProved : report.solver.target_stage_status === "not_applicable" ? C.noTargets : C.targetUnproven],
        [C.bound, report.solver.bound ? report.solver.bound.unit === "sample_fraction" ? fraction(report.solver.bound) : money(report.solver.bound) : C.unknown],
        [C.gap, report.solver.gap === null ? C.unknown : number(report.solver.gap)]]} />
      {!!report.targets.length && <><h4>{C.target}</h4><ul>{report.targets.map(row => <li key={`${row.scope}:${row.id}`}>{C.targetMiss({ ...row, id: row.scope === "player" ? snapshot.player_labels?.[row.id] || row.id : row.id })}</li>)}</ul></>}
      {report.warnings.map(row => <p className="dfw-note" key={row}>{row}</p>)}
      <p className="dfw-note">{C.exportHelp}</p>
    </details>
    <details data-testid="dfs-contest-portfolio-sensitivity"><summary>{C.sensitivity}</summary><p className="dfw-note">{C.sensitivityHelp}</p><p className="dfw-note">{C.baseline} → {C.proposed}</p>
      <ul className="dfw-review-list">{report.selected.evaluation.assumptions.map(row => {
        const before = baselineAssumptions.get(row.scenario_id);
        return <li key={row.scenario_id}><h4>{row.provider} · {row.scenario_id}</h4><Values rows={[
          [C.average, `${money(before.net.mean_cents)} → ${money(row.net.mean_cents)}`],
          [C.top(report.objective.top_k), `${(before.sampled_finish_fractions.top_k * 100).toFixed(1)}% → ${(row.sampled_finish_fractions.top_k * 100).toFixed(1)}%`],
        ]} /></li>;
      })}</ul>
    </details>
  </div>;
}
export default function DfsContestPortfolio({ shared, contest }) {
  const e = useDfsContestPortfolio(shared, contest);
  const scenarios = contest.chosen?.summary.field.scenarios || [];
  const assumption = scenarios.find(row => row.scenario_id === e.scenarioId);
  const count = shared.selected?.snapshot.lineups.length || 0;
  return <details className="dfw-shared-review" data-testid="dfs-contest-portfolio"><summary>{C.title}</summary>
    <p className="dfw-note">{C.intro}</p>
    {e.unavailable ? <p className="dfw-note">{C.unavailable}</p> : <p className="dfw-note">{C.candidates(count)}</p>}
    <div className="dfw-settings-grid dfw-control-fields" data-control-row>
      <div className="dfw-field"><span>{C.assumption}</span><HubFilterMenu className="hub-filter-menu--field" label={C.assumption} value={e.scenarioId}
        options={[{ id: "", label: C.chooseAssumption }, ...scenarios.map(row => ({ id: row.scenario_id, label: `${row.provider} · ${row.scenario_id}` }))]} disabled={e.unavailable} onChange={e.setScenarioId} /></div>
      <label className="dfw-field"><span>{C.count}</span><input type="number" min="1" max={Math.min(count || 1, 150)} step="1" disabled={e.unavailable} value={Number.isNaN(e.count) ? "" : e.count} onChange={event => e.setCount(event.target.value === "" ? NaN : Number(event.target.value))} /></label>
      <div className="dfw-field"><span>{C.goal}</span><HubFilterMenu className="hub-filter-menu--field" label={C.goal} value={e.objective} options={C.goals} disabled={e.unavailable} onChange={e.setObjective} /></div>
    </div>
    {assumption && <p className="dfw-note">{assumption.injury_assumption}</p>}
    <p className="dfw-note">{C.goalHelp[e.objective]}</p>
    {e.objective === "conditional_risk_adjusted_net" && <details data-testid="dfs-contest-portfolio-risk"><summary>{C.risk}</summary>
      <div className="dfw-settings-grid dfw-control-fields" data-control-row>
        <div className="dfw-field"><span>{C.worst}</span><HubFilterMenu className="hub-filter-menu--field" label={C.worst} value={e.riskAlpha} options={C.tails} disabled={e.unavailable} onChange={e.setRiskAlpha} /></div>
        <label className="dfw-field"><span>{C.weight}</span><input type="number" min="0" max="100" step="0.1" disabled={e.unavailable} value={e.riskWeight} onChange={event => e.setRiskWeight(event.target.value)} /></label>
      </div><p className="dfw-note">{C.riskHelp}</p>
    </details>}
    <div className="dfw-review-controls">
      <button type="button" disabled={e.unavailable || e.busy || !e.scenarioId || Boolean(e.inputError)} onClick={e.select}>{C.select}</button>
      {e.busy && <button type="button" onClick={e.cancel}>{C.cancel}</button>}
      {e.review && <button type="button" disabled={e.busy} onClick={e.download}>{C.download}</button>}
    </div>
    <p className="dfw-note" role="status" data-testid="dfs-contest-portfolio-status">{e.status ? `${e.status} ${C.elapsed(e.elapsed)}` : e.notice || C.idle}</p>
    {e.inputError && <p className="dfw-error" role="alert">{e.inputError}</p>}
    {e.error && <p className="dfw-error" role="alert">{e.error}</p>}
    {!!e.attempt?.solver.conflicts.length && <div><h4>{C.conflicts}</h4><ul>{e.attempt.solver.conflicts.map((row, index) => <li key={index}>{typeof row === "string" ? row : row.message || JSON.stringify(row)}</li>)}</ul></div>}
    {e.previous && <p className="dfw-note" role="status">{C.previous}</p>}
    {e.review && <Results key={e.review.report.manifest} review={e.review} />}
    <details><summary>{C.controls}</summary><p className="dfw-note">{C.inheritance(contest.draws, contest.topK)}</p><p className="dfw-note">{C.targetHelp}</p></details>
  </details>;
}
