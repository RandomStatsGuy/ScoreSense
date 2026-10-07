import React, { useMemo, useState } from "react";
import useMobileLayout from "../../useMobileLayout";
import { orderedHubPositions } from "../hubPositions";
import { HubFilterChip, HubFilterMenu } from "../HubUILayout";
import { InsightsIdentity } from "./InsightsBoards";
import { contractRanks, periodYears } from "./insightsPeriods";
import { contractHistoryNote, contractCoverage, formatPoints, insightsIdentityParts, INSIGHTS_COPY } from "./insightsPresentation";

const money = n => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
function ContractManager({ row, ownerMap, yearSpecific }) {
  const { primary, secondary } = insightsIdentityParts(row, ownerMap, yearSpecific);
  return <span>{primary}{secondary ? " · " + secondary : ""}</span>;
}

function ContractFeature({ row, best, ownerMap, yearSpecific }) {
  const copy = INSIGHTS_COPY.contracts;
  if (!row) return null;
  return <article className={"hub-insights-board-panel hub-insights-contract-feature" + (best ? " is-best" : "")}>
    <span className="hub-insights-board-kicker">{best ? copy.bestContract : copy.lowestReturn}</span>
    <h3>{row.player_name} <span>{row.position}</span></h3>
    <InsightsIdentity row={row} ownerMap={ownerMap} yearSpecific={yearSpecific} />
    <div className="hub-insights-contract-return"><strong>{row.return.toFixed(2)}</strong><span className="table-meta">pts / $</span></div>
    <div className="hub-insights-contract-feature-totals"><div><strong>{formatPoints(row.points)}</strong><span>{copy.actualPoints}</span></div><div><strong>{money(row.salary)}</strong><span>{copy.salaryPaid(row.seasons.length)}</span></div></div>
  </article>;
}

export default function InsightsContracts({ contracts, period, years, loading, ownerMap }) {
  const [position, setPosition] = useState("all");
  const [mode, setMode] = useState("best");
  const mobile = useMobileLayout();
  const copy = INSIGHTS_COPY.contracts;
  const positions = orderedHubPositions((contracts?.rows || []).map(row => row.position));
  const selectedPosition = positions.includes(position) ? position : "all";
  const selectedYears = periodYears(years, period);
  const ranks = useMemo(() => contractRanks(contracts?.rows, periodYears(years, period), selectedPosition), [contracts, years, period, selectedPosition]);
  const note = contractHistoryNote(contracts?.season_status, selectedYears);
  const coverage = contractCoverage(contracts?.rows, selectedYears);
  const yearSpecific = period.mode === "range" && Number(period.from) === Number(period.through);
  const boards = [{ id: "best", title: copy.best, rows: ranks.best }, { id: "worst", title: copy.worst, rows: ranks.worst }];
  return <div className="hub-insights-contracts" aria-busy={loading}>
    <div className="hub-insights-contract-toolbar">
      <div><h2>{copy.heading}</h2><p className="table-meta" role="status">{loading ? copy.loading : ranks.count + " contracts"}</p></div>
      <HubFilterMenu label="Position" value={selectedPosition} onChange={setPosition} ariaLabel="Contract position" options={[{ id: "all", label: "All positions" }, ...positions.map(pos => ({ id: pos, label: pos }))]} />
    </div>
    {!loading && note && <p className="chart-note hub-insights-contract-history-note" role="status">{note}</p>}
    {!mobile && ranks.count > 0 && <div className="hub-insights-contract-features"><ContractFeature row={ranks.best[0]} best ownerMap={ownerMap} yearSpecific={yearSpecific} /><ContractFeature row={ranks.worst[0]} ownerMap={ownerMap} yearSpecific={yearSpecific} /></div>}
    {mobile && <div className="hub-insights-contract-mode" role="group" aria-label={copy.rankBy}>{boards.map(board => <HubFilterChip key={board.id} active={mode === board.id} onClick={() => setMode(board.id)}>{board.title}</HubFilterChip>)}</div>}
    <div className="hub-insights-contract-boards">
      {boards.filter(board => !mobile || mode === board.id).map(board => <section className="hub-insights-overview-panel" key={board.id}>
        <div className="hub-insights-talk-head"><h3>{board.title}</h3><p>{copy.metric}</p></div>
        <ol className="hub-insights-contract-list">
          {loading && !contracts && Array.from({ length: 5 }, (_, index) => <li key={"loading-" + index} aria-hidden="true"><span className="hub-insights-skeleton-block" /><div className="hub-insights-contract-identity hub-insights-skeleton-block" /><div className="hub-insights-contract-return hub-insights-skeleton-block" /></li>)}
          {board.rows.slice(mobile ? 0 : 1, 10).map((row, index) => <li key={row.deal_id}>
            <span className="hub-insights-rank-place">{index + (mobile ? 1 : 2)}</span>
            <div className="hub-insights-contract-identity"><strong>{row.player_name} <span className="table-meta">{row.position}</span></strong><ContractManager row={row} ownerMap={ownerMap} yearSpecific={yearSpecific} /><small>{row.seasons.join(", ")}</small><small>{formatPoints(row.points)} pts · {money(row.salary)} paid</small></div>
            <div className="hub-insights-contract-return"><strong>{row.return.toFixed(2)}</strong><span className="table-meta">pts / $</span></div>
          </li>)}
        </ol>
        {!loading && !board.rows.length && <p className="chart-note">{copy.empty}</p>}
        {!mobile && board.rows.length === 1 && <p className="chart-note">{copy.singleContract}</p>}
      </section>)}
    </div>
    <details className="hub-insights-methodology"><summary>{copy.methodology}</summary><p className="chart-note">{contracts?.methodology || copy.explanation}</p>{coverage && <p className="chart-note">{copy.coverage(coverage)}</p>}{contracts?.excluded > 0 && <p className="chart-note">{copy.excluded(contracts.excluded)}</p>}</details>
  </div>;
}
