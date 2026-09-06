import React, { useEffect, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import { auctionAwardContractLabel, shortAuctionContractLabel, fmtSal } from "./rosterFormat";
import { formatPickSlot } from "./draftRoomHelpers";
import { formatListedProj } from "../seasonQuantiles";

const GRADE_LABEL = {
  steal: "Steal",
  great_value: "Great value",
  fair: "Fair",
  slight_reach: "Slight reach",
  reach: "Reach",
  major_reach: "Major reach",
  pick: "Pick",
};

export default function DraftOwnerReport({
  leagueId,
}) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!leagueId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const res = await apiFetch(`/api/hub/league/${leagueId}/owner-draft-report`);
        if (!res.ok) throw new Error(await parseApiError(res));
        const data = await res.json();
        if (cancelled) return;
        setReport(data);
      } catch (e) {
        if (!cancelled) setError(e.message || "Could not load your draft report");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [leagueId]);

  if (loading) {
    return <p className="chart-note hub-owner-report-loading">Loading your draft…</p>;
  }
  if (error && !report) {
    return <div className="error">{error}</div>;
  }
  if (!report) return null;

  const stepUp = Number(report.extension_step_up ?? 5);
  const pickDraft = Boolean(report.pick_draft);

  return (
    <section className="hub-owner-report">
      <header className="hub-owner-report-head">
        <div>
          <p className="hub-owner-report-kicker">Your draft · This mock</p>
          <h3>{report.team_name || "Your team"}</h3>
          <p className="chart-note">
            {report.pick_count} picks
            {!pickDraft && (
              <>
                {" · "}{fmtSal(report.total_spent)} spent
                {report.budget_remaining != null && <> · {fmtSal(report.budget_remaining)} left</>}
                {report.steals > 0 && <> · {report.steals} steal{report.steals === 1 ? "" : "s"}</>}
                {report.reaches > 0 && <> · {report.reaches} reach{report.reaches === 1 ? "" : "es"}</>}
              </>
            )}
          </p>
        </div>
      </header>

      {report.by_position?.length > 0 && (
        <div className="hub-owner-report-pos">
          {report.by_position.map((b) => (
            <span key={b.position} className="hub-cap-chip">
              {pickDraft ? `${b.position} ${b.count}` : `${b.position} ${b.count} · ${fmtSal(b.spent)}`}
            </span>
          ))}
        </div>
      )}

      {error && <div className="error hub-owner-report-error">{error}</div>}

      <div className="hub-owner-report-table-wrap">
        <table className={`hub-owner-report-table${pickDraft ? " hub-owner-report-table--picks" : ""}`}>
          <thead>
            {pickDraft ? (
              <tr>
                <th>Pick</th>
                <th>Player</th>
                <th>Proj</th>
              </tr>
            ) : (
              <tr>
                <th>Player</th>
                <th>Paid</th>
                <th>Fair</th>
                <th>Grade</th>
                <th>Contract</th>
              </tr>
            )}
          </thead>
          <tbody>
            {report.picks.map((p) => (
              <tr key={p.player_id}>
                {pickDraft ? (
                  <>
                    <td>{formatPickSlot(p) || "—"}</td>
                    <td>
                      <strong>{p.player_name}</strong>
                      <span className="chart-note"> · {p.position}</span>
                    </td>
                    <td>{formatListedProj(p.season_proj, 0)}</td>
                  </>
                ) : (
                  <>
                    <td>
                      <strong>{p.player_name}</strong>
                      <span className="chart-note"> · {p.position}</span>
                    </td>
                    <td>{fmtSal(p.amount)}</td>
                    <td>{p.fair_value != null ? fmtSal(p.fair_value) : "—"}</td>
                    <td>
                      <span className={`hub-draft-recap-grade hub-draft-recap-grade-${p.value_grade}`}>
                        {GRADE_LABEL[p.value_grade] || "Pick"}
                      </span>
                    </td>
                    <td className="hub-owner-contract-cell">
                      <span title={auctionAwardContractLabel(p, stepUp)}>{shortAuctionContractLabel(p, stepUp)}</span>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!pickDraft && (
        <p className="chart-note hub-owner-report-hint">
          Auction deals are automatic: rookies stay 2 years at the sale price;
          veterans are 2 years with a {fmtSal(stepUp)}/yr step-up.
          Choose extra years only during the pre-draft rookie extension window.
        </p>
      )}
    </section>
  );
}
