import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import MobileBottomSheet from "../layout/MobileBottomSheet";
import { fmtSal } from "./rosterFormat";

function JourneyTimeline({ seasons, editingSeason, onEditRow }) {
  const { current, history } = useMemo(() => {
    if (!editingSeason) {
      return { current: [], history: seasons || [] };
    }
    const cur = (seasons || []).filter((s) => s.is_editing_season);
    const hist = (seasons || []).filter((s) => !s.is_editing_season);
    return { current: cur, history: hist };
  }, [seasons, editingSeason]);

  if (!seasons?.length) {
    return <p className="chart-note">No contract rows found for this player.</p>;
  }

  const renderEntry = (s, highlight) => (
    <li
      key={`${s.season_year}-${s.row_id}-${s.roster_status}`}
      className={[
        s.roster_status === "cut" ? "hub-contract-journey-cut" : "",
        highlight ? "hub-contract-journey-editing" : "",
      ].filter(Boolean).join(" ")}
    >
      <div className="hub-contract-journey-head">
        <strong>{s.season_year}</strong>
        <span>{fmtSal(s.cap_hit)}</span>
      </div>
      <div className="hub-contract-journey-meta">
        {s.hub_team_name || s.owner_label}
        {" · "}
        {s.roster_status}
        {s.acquisition_type ? ` · ${s.acquisition_type}` : ""}
        {s.contract_phase ? ` · ${s.contract_phase}` : ""}
        {s.source_kind === "manual" ? " · manual edit" : ""}
      </div>
      {highlight && (
        <p className="hub-contract-journey-editing-note">
          This is the row in the {s.season_year} table you are editing.
        </p>
      )}
      {s.prior_salary != null && s.roster_status === "cut" && (
        <div className="hub-contract-journey-note">
          Prior cap {fmtSal(s.prior_salary)} (dead cap on cut)
        </div>
      )}
      {highlight && onEditRow && s.row_id && (
        <button type="button" className="btn-ghost btn-sm" onClick={() => onEditRow(s.row_id)}>
          Edit this row
        </button>
      )}
    </li>
  );

  return (
    <div className="hub-contract-journey-sections">
      {editingSeason && current.length > 0 && (
        <section>
          <h5 className="hub-contract-journey-section-title">
            {editingSeason} cap sheet (editing now)
          </h5>
          <ol className="hub-contract-journey">
            {current.map((s) => renderEntry(s, true))}
          </ol>
        </section>
      )}
      {editingSeason && current.length === 0 && (
        <p className="chart-note hub-insights-callout">
          No {editingSeason} row for this player in the table — use Add row to create one.
        </p>
      )}
      {history.length > 0 && (
        <section>
          <h5 className="hub-contract-journey-section-title">
            {editingSeason ? "Earlier seasons (reference only)" : "Salary history"}
          </h5>
          <ol className="hub-contract-journey">
            {history.map((s) => renderEntry(s, false))}
          </ol>
        </section>
      )}
      {!editingSeason && (
        <ol className="hub-contract-journey">
          {(seasons || []).map((s) => renderEntry(s, false))}
        </ol>
      )}
    </div>
  );
}

export default function ContractPlayerJourney({
  leagueId,
  playerName,
  editingSeason = "",
  onClose,
  onEditRow,
}) {
  const mobileLayout = useMobileLayout();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!leagueId || !playerName) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ player: playerName });
        if (editingSeason) params.set("season", String(editingSeason));
        const res = await apiFetch(
          `/api/hub/league/${leagueId}/contract-history/player-journey?${params.toString()}`,
        );
        if (!res.ok) throw new Error(await parseApiError(res));
        const payload = await res.json();
        if (!cancelled) setData(payload);
      } catch (e) {
        if (!cancelled) setError(connectionErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [leagueId, playerName, editingSeason]);

  const title = data?.player_name || playerName || "Player";
  const seasonLabel = editingSeason ? `${editingSeason} cap sheet` : "Salary history";

  const body = (
    <>
      {editingSeason && (
        <p className="hub-contract-journey-context">
          Cap sheet rows are end-of-season snapshots. Sleeper moves below show{' '}
          <em>when</em> they traded — tag Acquired on the join season, not renewals.
        </p>
      )}
      {loading && <p className="chart-note">Loading…</p>}
      {error && <p className="error-banner">{error}</p>}
      {!loading && !error && (data?.suggestions || []).length > 0 && (
        <div className="hub-contract-evidence-suggestions">
          <h5 className="hub-contract-journey-section-title">Suggested fixes</h5>
          <ul className="hub-contract-evidence-list">
            {data.suggestions.map((s) => (
              <li key={`${s.season_year}-${s.row_id}`}>{s.message}</li>
            ))}
          </ul>
        </div>
      )}
      {!loading && !error && (data?.evidence || []).length > 0 && (
        <section className="hub-contract-evidence">
          <h5 className="hub-contract-journey-section-title">What we know</h5>
          <ul className="hub-contract-evidence-list">
            {data.evidence.map((ev, i) => (
              <li key={`${ev.kind}-${ev.season_year}-${i}`} className={`hub-contract-evidence--${ev.kind}`}>
                {ev.label || ev.kind}
              </li>
            ))}
          </ul>
        </section>
      )}
      {!loading && !error && (
        <JourneyTimeline
          seasons={data?.seasons}
          editingSeason={editingSeason ? Number(editingSeason) : null}
          onEditRow={onEditRow}
        />
      )}
    </>
  );

  if (mobileLayout) {
    return (
      <MobileBottomSheet
        open
        onClose={onClose}
        title={`${title} — ${seasonLabel}`}
        className="app-mobile-sheet-contract-journey"
      >
        {body}
      </MobileBottomSheet>
    );
  }

  return (
    <aside className="panel hub-contract-journey-panel">
      <header className="hub-contract-journey-headbar">
        <div>
          <h4 className="hub-live-section-title">{title}</h4>
          <p className="hub-page-meta">{seasonLabel}</p>
        </div>
        <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
          Close
        </button>
      </header>
      {body}
    </aside>
  );
}
