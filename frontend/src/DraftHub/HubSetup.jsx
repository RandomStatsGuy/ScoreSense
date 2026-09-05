import React from "react";
import SleeperLink from "./SleeperLink";
import SalaryRangeImport from "./SalaryRangeImport";
import LeagueSheetImport from "./LeagueSheetImport";
import CapSheetImport from "./CapSheetImport";
import LeagueInvites from "./LeagueInvites";
import LeagueSetup from "./LeagueSetup";
import HubSetupChecklist, { hasSleeper } from "./HubSetupChecklist";
import useMobileLayout from "../useMobileLayout";
import { effectiveHubContext } from "./hubContext";

/**
 * Collapsible setup section (desktop and mobile). Sections that still need
 * attention default open; completed/secondary ones start collapsed so the
 * page reads as a short checklist instead of a wall of expanded panels.
 */
function SetupSection({
  title,
  hint,
  children,
  mobileLayout,
  defaultOpen = false,
  flat = false,
  className = "hub-setup-panel",
}) {
  if (flat) {
    return (
      <section className={`panel ${className}${flat && mobileLayout ? " hub-setup-panel--flat" : ""}`}>
        {children}
      </section>
    );
  }
  return (
    <details className={`hub-setup-accordion panel ${className}`} open={defaultOpen}>
      <summary>
        {title}
        {hint ? <span className="hub-setup-accordion-hint">{hint}</span> : null}
      </summary>
      <div className="hub-setup-accordion-body">{children}</div>
    </details>
  );
}

export default function HubSetup({
  workspace,
  hubContext,
  memberships = [],
  roster,
  rosterLoading = false,
  presets,
  onSleeperLinked,
  onRosterChanged,
  onWorkspaceSaved,
  onRangesUpdated,
  onLeagueChanged,
  onLeagueSwitch,
  onNavigate,
  onLeagueSync,
  leagueSyncing = false,
  leagueSyncMessage,
  leagueSyncError,
  startCreateOpen = false,
  onCreateLeague,
}) {
  const mobileLayout = useMobileLayout();
  const ctx = effectiveHubContext(hubContext, workspace);
  const inLeague = ctx?.mode === "league";
  const isCommissioner = ctx?.is_commissioner;
  const sleeperLinked = hasSleeper(workspace, ctx);

  return (
    <div className={`hub-setup hub-setup-compact${mobileLayout ? " hub-setup--mobile" : ""}`}>
      <div className="hub-setup-home-link">
        {onNavigate ? (
          <button type="button" className="btn-link" onClick={() => onNavigate("home")}>
            ← League Home
          </button>
        ) : null}
        <h2 className="hub-tab-intro-title">League connections</h2>
        <p className="chart-note hub-setup-lead">
          Create or join a league, then connect Sleeper and imports. Contract rules live on Rules.
        </p>
        {onNavigate && (
          <button type="button" className="btn-primary btn-sm" onClick={() => onNavigate("rules")}>
            {inLeague && !isCommissioner ? "View league rules" : "Open league rules"}
          </button>
        )}
      </div>
      <HubSetupChecklist
        workspace={workspace}
        hubContext={ctx}
        memberships={memberships}
        onNavigate={onNavigate}
        onCreateLeague={onCreateLeague}
      />
      <SetupSection
        flat
        mobileLayout={mobileLayout}
        className="hub-setup-panel hub-setup-panel--league"
      >
        <LeagueSetup
          workspace={workspace}
          hubContext={ctx}
          memberships={memberships}
          presets={presets}
          onLeagueCreated={onLeagueChanged}
          onLeagueSwitch={onLeagueSwitch}
          onCreateLeague={onCreateLeague}
          onNavigate={onNavigate}
          onLeagueSync={onLeagueSync}
          leagueSyncing={leagueSyncing}
          leagueSyncMessage={leagueSyncMessage}
          leagueSyncError={leagueSyncError}
          hideActiveHero={mobileLayout}
          startCreateOpen={startCreateOpen}
        />
      </SetupSection>

      <SetupSection
        title="Sleeper connection"
        hint={sleeperLinked ? "Linked" : "Not linked"}
        defaultOpen={!sleeperLinked}
        mobileLayout={mobileLayout}
        className="hub-setup-panel hub-setup-panel--sleeper"
      >
        <SleeperLink
          workspace={workspace}
          hubContext={ctx}
          onLinked={onSleeperLinked}
          onRosterChanged={onRosterChanged}
        />
        {inLeague && isCommissioner && onNavigate && (
          <div className="hub-toolbar hub-setup-inline-actions">
            <button type="button" className="btn-ghost btn-sm" onClick={() => onNavigate("league-rosters")}>
              All teams →
            </button>
          </div>
        )}
      </SetupSection>

      {inLeague && isCommissioner && (
        <SetupSection
          title="League access & imports"
          hint="Invites · imports"
          mobileLayout={mobileLayout}
          className="hub-setup-panel hub-setup-alt"
        >
          <LeagueInvites
            leagueId={ctx.league_id}
            hubContext={ctx}
            onChanged={onRosterChanged}
          />
          <LeagueSheetImport
            season={workspace?.season}
            onImported={onRosterChanged}
            embedded
            commissionerMode
          />
          <CapSheetImport onImported={onRosterChanged} embedded />
        </SetupSection>
      )}

      {!inLeague && (
        <SetupSection
          title="Spreadsheet import"
          hint="Optional"
          mobileLayout={mobileLayout}
          className="hub-setup-panel hub-setup-alt"
        >
          <LeagueSheetImport season={workspace?.season} onImported={onRosterChanged} embedded />
          <SalaryRangeImport season={workspace?.season} onImported={onRangesUpdated} embedded />
        </SetupSection>
      )}
    </div>
  );
}
