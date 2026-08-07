import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import { fmtSal } from "./rosterFormat";

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
  maxContractYears: maxYearsProp,
  onSaved,
}) {
  const [report, setReport] = useState(null);
  const [yearsByPlayer, setYearsByPlayer] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedNote, setSavedNote] = useState("");

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
        const next = {};
        for (const p of data.picks || []) {
          next[p.player_id] = Number(p.contract_years) || 1;
        }
        setYearsByPlayer(next);
      } catch (e) {
        if (!cancelled) setError(e.message || "Could not load your draft report");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [leagueId]);

  const maxYears = Number(report?.max_contract_years || maxYearsProp || 3);
  const yearOptions = useMemo(
    () => Array.from({ length: maxYears }, (_, i) => i + 1),
    [maxYears],
  );

  const dirty = useMemo(() => {
    if (!report?.picks) return false;
    return report.picks.some(
      (p) => Number(yearsByPlayer[p.player_id] || 1) !== Number(p.contract_years || 1),
    );
  }, [report, yearsByPlayer]);

  const saveContracts = async () => {
    if (!leagueId || !report?.picks?.length) return;
    setSaving(true);
    setError("");
    setSavedNote("");
    try {
      const contracts = report.picks.map((p) => ({
        player_id: p.player_id,
        contract_years: Number(yearsByPlayer[p.player_id]) || 1,
      }));
      const res = await apiFetch(`/api/hub/league/${leagueId}/draft-contracts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contracts }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setReport((prev) => ({
        ...prev,
        picks: (prev?.picks || []).map((p) => ({
          ...p,
          contract_years: Number(yearsByPlayer[p.player_id]) || 1,
        })),
      }));
      setSavedNote(`Saved ${data.updated} contract${data.updated === 1 ? "" : "s"}`);
      onSaved?.(data.state);
    } catch (e) {
      setError(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="chart-note hub-owner-report-loading">Loading your draft…</p>;
  }
  if (error && !report) {
    return <div className="error">{error}</div>;
  }
  if (!report) return null;

  return (
    <section className="hub-owner-report">
      <header className="hub-owner-report-head">
        <div>
          <p className="hub-owner-report-kicker">Your draft</p>
          <h3>{report.team_name || "Your team"}</h3>
          <p className="chart-note">
            {report.pick_count} picks · {fmtSal(report.total_spent)} spent
            {report.budget_remaining != null && <> · {fmtSal(report.budget_remaining)} left</>}
            {report.steals > 0 && <> · {report.steals} steal{report.steals === 1 ? "" : "s"}</>}
            {report.reaches > 0 && <> · {report.reaches} reach{report.reaches === 1 ? "" : "es"}</>}
          </p>
        </div>
        <button
          type="button"
          className="btn-primary btn-sm"
          disabled={saving || !dirty}
          onClick={saveContracts}
        >
          {saving ? "Saving…" : dirty ? "Save contracts" : "Contracts saved"}
        </button>
      </header>

      {report.by_position?.length > 0 && (
        <div className="hub-owner-report-pos">
          {report.by_position.map((b) => (
            <span key={b.position} className="hub-cap-chip">
              {b.position} {b.count} · {fmtSal(b.spent)}
            </span>
          ))}
        </div>
      )}

      {error && <div className="error hub-owner-report-error">{error}</div>}
      {savedNote && <p className="chart-note hub-owner-report-saved">{savedNote}</p>}

      <div className="hub-owner-report-table-wrap">
        <table className="hub-owner-report-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Paid</th>
              <th>Fair</th>
              <th>Grade</th>
              <th>Years</th>
            </tr>
          </thead>
          <tbody>
            {report.picks.map((p) => (
              <tr key={p.player_id}>
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
                <td>
                  <select
                    className="hub-owner-years"
                    value={yearsByPlayer[p.player_id] ?? 1}
                    onChange={(e) => {
                      const v = Number(e.target.value) || 1;
                      setYearsByPlayer((prev) => ({ ...prev, [p.player_id]: v }));
                      setSavedNote("");
                    }}
                    aria-label={`Contract years for ${p.player_name}`}
                  >
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>{y}y</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="chart-note hub-owner-report-hint">
        Set contract length for each pick (1–{maxYears} years), then save.
      </p>
    </section>
  );
}
