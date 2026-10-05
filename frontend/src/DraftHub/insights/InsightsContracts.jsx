import React, { useMemo, useState } from "react";
import { orderedHubPositions } from "../hubPositions";
import { HubFilterMenu } from "../HubUILayout";
import { contractRanks, periodYears } from "./insightsPeriods";
import { contractHistoryNote, contractCoverage, formatPoints, teamDisplayName, INSIGHTS_COPY } from "./insightsPresentation";

const money = (n) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
export default function InsightsContracts({ contracts, period, years, loading }) {
  const [position, setPosition] = useState("all");
  const copy = INSIGHTS_COPY.contracts;
  const ranks = useMemo(() => contractRanks(contracts?.rows, periodYears(years, period), position), [contracts, years, period, position]);
  const note = contractHistoryNote(contracts?.season_status, periodYears(years, period));
  const coverage = contractCoverage(contracts?.rows, periodYears(years, period));
  const positions = orderedHubPositions((contracts?.rows || []).map((r) => r.position));
  return <div className="hub-insights-contracts" aria-busy={loading}>
    <div className="hub-insights-contract-toolbar">
      <div><h2>{copy.heading}</h2><p className="table-meta" role="status">{loading ? copy.loading : `${ranks.count} contracts`}</p></div>
      <HubFilterMenu label="Position" value={position} onChange={setPosition} ariaLabel="Contract position" options={[{ id: "all", label: "All positions" }, ...positions.map((p) => ({ id: p, label: p }))]} />
    </div>
    {!loading && note && <p className="chart-note hub-insights-contract-history-note" role="status">{note}</p>}
    <div className="hub-insights-contract-boards">
      {[{ title: copy.best, rows: ranks.best }, { title: copy.worst, rows: ranks.worst }].map((board) => <section className="hub-insights-overview-panel" key={board.title}>
        <div className="hub-insights-talk-head"><h3>{board.title}</h3><p>{copy.metric}</p></div>
        <ol className="hub-insights-contract-list">
          {loading && !contracts && Array.from({ length: 5 }, (_, index) => <li key={`loading-${index}`} aria-hidden="true"><span className="hub-insights-skeleton-block" /><div className="hub-insights-contract-identity hub-insights-skeleton-block" /><div className="hub-insights-contract-return hub-insights-skeleton-block" /></li>)}
          {board.rows.slice(0, 10).map((row, index) => <li key={row.deal_id}>
            <span className="hub-insights-rank-place">{index + 1}</span>
            <div className="hub-insights-contract-identity"><strong>{row.player_name} <span className="table-meta">{row.position}</span></strong><span>{teamDisplayName(row, null, period.mode === "range" && Number(period.from) === Number(period.through))}</span><small>{row.seasons.join(", ")}</small><small>{formatPoints(row.points)} pts / {money(row.salary)}</small></div>
            <div className="hub-insights-contract-return"><strong>{row.return.toFixed(2)}</strong><span className="table-meta">pts / $</span></div>
          </li>)}
        </ol>
        {!loading && !board.rows.length && <p className="chart-note">{copy.empty}</p>}
      </section>)}
    </div>
    <details className="hub-insights-methodology"><summary>{copy.methodology}</summary><p className="chart-note">{contracts?.methodology || copy.explanation}</p>{coverage && <p className="chart-note">{copy.coverage(coverage)}</p>}{contracts?.excluded > 0 && <p className="chart-note">{copy.excluded(contracts.excluded)}</p>}</details>
  </div>;
}
