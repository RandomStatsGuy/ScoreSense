import React, { useMemo } from "react";
import useMobileLayout from "../useMobileLayout";
import LeagueSwitcher from "./LeagueSwitcher";
import { effectiveMemberships, isSoloContext } from "./hubLeagues";
import { fmtSal } from "./rosterFormat";

export default function LeagueContextBanner({
  hubContext,
  memberships = [],
  onLeagueSwitch,
  onNavigateSetup,
  onNavigateManage,
  onLeagueSync,
  syncing,
  syncMessage,
  syncError,
  switchBusy = false,
  compact = false,
  capSheet = null,
  onNavigate,
}) {
  const leagues = useMemo(
    () => effectiveMemberships(memberships, hubContext),
    [memberships, hubContext],
  );
  const inLeague = !isSoloContext(hubContext);
  const hasLeagues = leagues.length > 0;
  const mobileLayout = useMobileLayout();

  if (!inLeague && !hasLeagues) return null;

  const isCommish = hubContext?.is_commissioner;
  const syncTitle = "Sync rosters from Sleeper";
  const leagueNote = inLeague
    ? (isCommish
      ? (mobileLayout ? "Sleeper sync only — edits stay here." : "Rosters sync from Sleeper. Edits here don't change Sleeper.")
      : (mobileLayout ? "Link Sleeper · sync after trades." : "Link Sleeper in Setup. Sync after trades."))
    : (mobileLayout ? "Setup → pick or create a league." : "Open Setup to pick a league or create one.");

  const phaseLabel = inLeague
    ? (hubContext.draft_completed
      ? `${hubContext.season ?? ""} · In season`.replace(/^ · /, "")
      : `${hubContext.season ?? ""} · Before draft`.replace(/^ · /, ""))
    : null;

  // Pre-draft cap chips folded in from the former HubSeasonStatus strip.
  const preDraft = inLeague && !hubContext.draft_completed ? capSheet?.pre_draft : null;
  const draftBudget = preDraft?.draft_budget_available;
  const expiring = preDraft?.expiring_before_draft ?? preDraft?.expiring_after_draft ?? [];
  const mustExtend = preDraft?.must_extend ?? [];
  const dropping = preDraft?.dropping_at_draft ?? [];
  const pendingCuts = preDraft?.pending_cuts ?? [];
  const statusChips = preDraft && (draftBudget != null || expiring.length > 0 || pendingCuts.length > 0) ? (
    <div className="hub-league-hero-status" role="status">
      {draftBudget != null && (
        <span className="hub-season-status-chip hub-season-status-chip--budget">
          {fmtSal(draftBudget)} for auction
        </span>
      )}
      {mustExtend.length > 0 && (
        <span className="hub-season-status-chip hub-season-status-chip--warn">
          {mustExtend.length} need extension
        </span>
      )}
      {dropping.length > 0 && (
        <span className="hub-season-status-chip hub-season-status-chip--warn">
          {dropping.length} expire → FA
        </span>
      )}
      {pendingCuts.length > 0 && (
        <span className="hub-season-status-chip">
          {pendingCuts.length} pending cut{pendingCuts.length === 1 ? "" : "s"}
        </span>
      )}
      {expiring.length > 0 && onNavigate && (
        <button type="button" className="btn-link" onClick={() => onNavigate("planner")}>
          Cap planner
        </button>
      )}
    </div>
  ) : null;

  if (compact && inLeague) {
    return (
      <section className="hub-league-hero hub-league-hero--compact" role="status">
        <div className="hub-league-hero-top">
          <div className="hub-league-hero-main hub-league-hero-main--compact">
            {phaseLabel && <span className="hub-league-hero-phase-chip">{phaseLabel}</span>}
            <h2 className="hub-league-hero-title">{hubContext.league_name || "League"}</h2>
            <span className="hub-league-hero-meta">
              {hubContext.team_name}
              {isCommish ? " · Commissioner" : ""}
            </span>
          </div>
          <div className="hub-league-hero-actions">
            {(hasLeagues || inLeague) && onLeagueSwitch && (
              <LeagueSwitcher
                memberships={memberships}
                hubContext={hubContext}
                onSwitch={onLeagueSwitch}
                variant="compact"
                disabled={syncing || switchBusy}
              />
            )}
            {onLeagueSync && hubContext.league_id && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                title={syncTitle}
                onClick={() => onLeagueSync(hubContext.league_id)}
                disabled={syncing || switchBusy}
              >
                {syncing ? "Syncing…" : "Sync Sleeper"}
              </button>
            )}
          </div>
        </div>
        {syncError && <div className="error hub-league-sync-error">{syncError}</div>}
      </section>
    );
  }

  return (
    <section className="hub-league-hero" role="status">
      <div className="hub-league-hero-top">
        <div className="hub-league-hero-main">
          {inLeague ? (
            <>
              {!mobileLayout && phaseLabel && (
                <p className="hub-league-hero-kicker">{phaseLabel}</p>
              )}
              <h2 className="hub-league-hero-title">{hubContext.league_name || "League"}</h2>
              <span className="hub-league-hero-meta">
                {hubContext.team_name}
                {hubContext.league_room_code ? ` · ${hubContext.league_room_code}` : ""}
                {isCommish ? (mobileLayout ? " · Commish" : " · Commissioner") : ""}
              </span>
            </>
          ) : (
            <>
              {!mobileLayout && <p className="hub-league-hero-kicker">Mode</p>}
              <h2 className="hub-league-hero-title">Solo prep</h2>
              <span className="hub-league-hero-meta">
                {mobileLayout ? "Pick a league below" : "Solo workspace — switch to a league for shared tools"}
              </span>
            </>
          )}
        </div>
        {(hasLeagues || inLeague) && onLeagueSwitch && (
          <LeagueSwitcher
            memberships={memberships}
            hubContext={hubContext}
            onSwitch={onLeagueSwitch}
            variant="compact"
            disabled={syncing || switchBusy}
          />
        )}
      </div>
      {statusChips}
      <p className="hub-league-hero-note">
        {leagueNote}
        {onNavigateSetup && (
          <>
            {" "}
            <button type="button" className="btn-link" onClick={onNavigateSetup}>
              {mobileLayout ? "Settings" : "League settings"}
            </button>
          </>
        )}
        {isCommish && onNavigateManage && (
          <>
            {" "}
            <button type="button" className="btn-link" onClick={onNavigateManage}>
              {mobileLayout ? "Desk" : "Commissioner desk"}
            </button>
          </>
        )}
      </p>
      {onLeagueSync && inLeague && hubContext.league_id && (
        <div className="hub-toolbar hub-league-sync-toolbar">
          <button
            type="button"
            className="btn-ghost btn-sm"
            title={syncTitle}
            onClick={() => onLeagueSync(hubContext.league_id)}
            disabled={syncing || switchBusy}
          >
            {syncing ? "Syncing…" : "Sync Sleeper"}
          </button>
          {syncMessage && <p className="chart-note hub-league-sync-msg">{syncMessage}</p>}
          {syncError && <div className="error hub-league-sync-error">{syncError}</div>}
        </div>
      )}
    </section>
  );
}
