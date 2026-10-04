import React, { useMemo, useState } from "react";
import { HubFilterMenu } from "../HubUILayout";
import { contractRanks, periodYears } from "./insightsPeriods";
import { formatPoints, INSIGHTS_COPY } from "./insightsPresentation";

const money = (n) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
export default function InsightsContracts({ contracts, period, years, loading }) {
  const [position, setPosition] = useState("all");
  const copy = INSIGHTS_COPY.contracts;
  const ranks = useMemo(() => contractRanks(contracts?.rows, periodYears(years, period), position), [contracts, years, period, position]);
  const positions = [...new Set((contracts?.rows || []).map((r) => r.position).filter(Boolean))].sort();
  return <div className="hub-insights-contracts" aria-busy={loading}>
    <div className="hub-insights-contract-toolbar">
      <div><h2>{copy.heading}</h2><p className="table-meta" role="status">{loading ? copy.loading : `${ranks.count} contracts`}</p></div>
      <HubFilterMenu label="Position" value={position} onChange={setPosition} ariaLabel="Contract position" options={[{ id: "all", label: "All positions" }, ...positions.map((p) => ({ id: p, label: p }))]} />
    </div>
    <div className="hub-insights-contract-boards">
      {[{ title: copy.best, rows: ranks.best }, { title: copy.worst, rows: ranks.worst }].map((board) => <section className="hub-insights-overview-panel" key={board.title}>
        <div className="hub-insights-talk-head"><h3>{board.title}</h3><p>{copy.metric}</p></div>
        <ol className="hub-insights-contract-list">
          {loading && !contracts && Array.from({ length: 5 }, (_, index) => <li key={`loading-${index}`} aria-hidden="true"><span className="hub-insights-skeleton-block" /><div className="hub-insights-contract-identity hub-insights-skeleton-block" /><div className="hub-insights-contract-return hub-insights-skeleton-block" /></li>)}
          {board.rows.slice(0, 10).map((row, index) => <li key={row.deal_id}>
            <span className="hub-insights-rank-place">{index + 1}</span>
            <div className="hub-insights-contract-identity"><strong>{row.player_name} <span className="table-meta">{row.position}</span></strong><span>{row.owner_name || row.team_name}</span><small>{row.seasons.sort((a, b) => a - b).join(", ")} · {row.contract_phase || "Annual salary"}</small><small>{formatPoints(row.points)} pts / {money(row.salary)}</small><small>Saved through {row.coverage.map((c) => `${c.season} week ${c.week}`).join(" · ")}</small></div>
            <div className="hub-insights-contract-return"><strong>{row.return.toFixed(2)}</strong><span className="table-meta">pts / $</span></div>
          </li>)}
        </ol>
        {!loading && !board.rows.length && <p className="chart-note">{copy.empty}</p>}
      </section>)}
    </div>
    {contracts?.excluded > 0 && <p className="chart-note">{contracts.excluded} salary rows need a resolved player, salary, or complete scoring history.</p>}
    <details className="hub-insights-methodology"><summary>{copy.methodology}</summary><p className="chart-note">{contracts?.methodology || copy.explanation}</p></details>
  </div>;
}
