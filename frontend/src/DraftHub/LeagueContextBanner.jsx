import React, { useMemo } from "react";
import useMobileLayout from "../useMobileLayout";
import LeagueSwitcher from "./LeagueSwitcher";
import { effectiveMemberships, isSoloContext } from "./hubLeagues";

export default function LeagueContextBanner({
  hubContext,
  memberships = [],
  onLeagueSwitch,
  onNavigateSetup,
  onLeagueSync,
  syncing,
  syncMessage,
  syncError,
  switchBusy = false,
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

  return (
    <section className="hub-league-hero" role="status">
      <div className="hub-league-hero-top">
        <div className="hub-league-hero-main">
          {inLeague ? (
            <>
              {!mobileLayout && (
                <p className="hub-league-hero-kicker">
                  {hubContext.draft_completed
                    ? `${hubContext.season ?? ""} · In season`.replace(/^ · /, "")
                    : `${hubContext.season ?? ""} · Before draft`.replace(/^ · /, "")}
                </p>
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
