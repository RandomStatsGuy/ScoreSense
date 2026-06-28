import React from "react";
import useMobileLayout from "../useMobileLayout";

function fmtSal(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `$${Number(v).toFixed(0)}`;
}

export default function HubSeasonStatus({
  workspace,
  hubContext,
  capSheet,
  rosterLoading,
  onNavigate,
}) {
  const mobileLayout = useMobileLayout();
  if (hubContext?.mode !== "league") return null;

  const season = Number(
    workspace?.season ?? hubContext?.season ?? capSheet?.season ?? new Date().getFullYear(),
  );
  const draftCompleted = Boolean(hubContext?.draft_completed);
  const preDraft = capSheet?.pre_draft;
  const loading = rosterLoading && !capSheet;

  if (draftCompleted) {
    return (
      <div className="hub-season-status hub-season-status--inseason" role="status">
        <span className="hub-season-status-phase">{season} · In season</span>
        <span className="hub-season-status-note">Current contracts and cap apply through this season.</span>
      </div>
    );
  }

  const budget = preDraft?.draft_budget_available;
  const expiring = preDraft?.expiring_after_draft ?? [];
  const cuts = preDraft?.pending_cuts ?? [];

  return (
    <div className="hub-season-status hub-season-status--predraft" role="status">
      <div className="hub-season-status-row">
        <span className="hub-season-status-phase">{season} · Before draft</span>
        {!loading && budget != null && (
          <span className="hub-season-status-chip hub-season-status-chip--budget">
            {fmtSal(budget)} for auction
          </span>
        )}
        {!loading && expiring.length > 0 && (
          <span className="hub-season-status-chip hub-season-status-chip--warn">
            {expiring.length} free at draft
          </span>
        )}
        {!loading && cuts.length > 0 && (
          <span className="hub-season-status-chip">
            {cuts.length} pending cut{cuts.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {!mobileLayout && !loading && expiring.length > 0 && (
        <p className="hub-season-status-expiring">
          <span className="hub-season-status-expiring-label">Contracts ending: </span>
          {expiring.slice(0, 6).map((p) => p.player_name).filter(Boolean).join(" · ")}
          {expiring.length > 6 ? ` · +${expiring.length - 6} more` : ""}
          {onNavigate && (
            <>
              {" · "}
              <button type="button" className="btn-link" onClick={() => onNavigate("planner")}>
                Cap planner
              </button>
              {" · "}
              <button type="button" className="btn-link" onClick={() => onNavigate("roster")}>
                Roster
              </button>
            </>
          )}
        </p>
      )}
      {!mobileLayout && !loading && expiring.length === 0 && preDraft && (
        <p className="hub-season-status-note">
          No contracts expire at this draft — all deals run into next season or beyond.
        </p>
      )}
      {loading && <p className="chart-note hub-season-status-loading">Loading cap snapshot…</p>}
    </div>
  );
}
