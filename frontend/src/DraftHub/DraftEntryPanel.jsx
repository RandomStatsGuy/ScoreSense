import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import DraftCommissionerSettings from "./DraftCommissionerSettings";
import DraftLobby from "./DraftLobby";
import {
  draftEntryPhase,
  draftFormatLabel,
  draftParticipantSummary,
  isPickDraft,
} from "./draftEntryStatus";
import { fmtSal } from "./rosterFormat";
import { HubExperienceHero, HubExperienceLayout, HubExperienceSummary } from "./HubUILayout";

/**
 * Draft room idle entry: live-draft CTA, with mock drafts in Tools.
 */
export default function DraftEntryPanel({
  busy = false,
  onStartLiveDraft,
  onSaveSchedule,
  onStartKeeperSandbox,
  onDeleteSandbox,
  onCommissionerUpdated,
  onNavigate,
  hubContext = null,
  league = null,
  leagueId = "",
  rules = null,
  teams = [],
  session = null,
  poolMode = "full",
  usingHubLeague = false,
  isCommissioner = false,
  testMode = false,
  inDraftSetup = false,
  roomLoading = false,
  mockModeLabel = "",
  expirePreview = null,
  emptySeats = 0,
  claimedHumans = 0,
  viewer = null,
  guestMode = false,
  onUpdated,
}) {
  const navigate = useNavigate();
  const [relaxSandboxLimits, setRelaxSandboxLimits] = useState(false);

  const formatLabel = draftFormatLabel(rules || league?.rules);
  const pickDraft = isPickDraft(rules || league?.rules);
  const budget = Number((rules || league?.rules)?.salary_cap ?? 200);
  const phase = draftEntryPhase({
    hubContext,
    testMode,
    draftCompleted: Boolean(league?.draft_completed),
    inDraftSetup,
    usingHubLeague,
    leagueId,
  });
  const participants = draftParticipantSummary({
    teams,
    teamCount: league?.team_count ?? 12,
    hasLeague: Boolean(leagueId),
  });

  const leagueName = hubContext?.league_name || league?.name || "your league";
  const showLobby = Boolean(leagueId && inDraftSetup && !roomLoading);

  if (showLobby) {
    return (
      <div className="hub-draft-entry hub-experience-stack">
        <DraftLobby
          busy={busy}
          league={league}
          leagueId={leagueId}
          rules={rules}
          teams={teams}
          viewer={viewer}
          isCommissioner={isCommissioner}
          testMode={testMode}
          roomLoading={roomLoading}
          emptySeats={emptySeats}
          claimedHumans={claimedHumans}
          guestMode={guestMode}
          onStartDraft={onStartLiveDraft}
          onSaveSchedule={onSaveSchedule}
          onUpdated={onUpdated || onCommissionerUpdated}
        />
        {usingHubLeague && isCommissioner && expirePreview && (
          <p className="chart-note hub-draft-expire-preview">
            Keepers: {expirePreview.retained_count} retained · {expirePreview.expire_count} expire before draft
            (nominatable). Real league unchanged in a keeper sandbox.
          </p>
        )}
        {testMode && mockModeLabel === "Keeper sandbox" && inDraftSetup && (
          <p className="chart-note hub-draft-expire-preview">
            Sandbox copy of keepers — inspect expire badges, then start when ready.
            {rules?.relax_salary_roster_limits ? " Salary cap and position limits are off." : ""}
          </p>
        )}
        <details className="hub-experience-section hub-draft-more">
          <summary>More options</summary>
          <div className="hub-draft-more-body">
            {usingHubLeague && isCommissioner ? (
              <div className="hub-sandbox-relax-check">
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => onStartKeeperSandbox?.({ relaxSalaryRosterLimits: relaxSandboxLimits })}
                >
                  Keeper sandbox
                </button>
                <label className="hub-toggle-row hub-toggle-row-compact">
                  <input
                    type="checkbox"
                    checked={relaxSandboxLimits}
                    onChange={(e) => setRelaxSandboxLimits(e.target.checked)}
                    disabled={busy}
                  />
                  Ignore salary cap and position limits
                </label>
              </div>
            ) : (
              <p className="chart-note">
                Solo practice lives in{" "}
                <button type="button" className="btn-link" onClick={() => navigate("/tools/mock-draft")}>
                  Tools → Mock draft
                </button>
                .
              </p>
            )}
            {testMode && isCommissioner && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={busy}
                onClick={() => onDeleteSandbox?.()}
              >
                Delete sandbox
              </button>
            )}
            {isCommissioner && onCommissionerUpdated && (
              <DraftCommissionerSettings
                leagueId={leagueId}
                rules={rules}
                teams={teams}
                nominationOrder={session?.nomination_order}
                poolMode={poolMode}
                testMode={testMode}
                disabled={busy}
                onUpdated={onCommissionerUpdated}
              />
            )}
          </div>
        </details>
      </div>
    );
  }

  return (
    <div className="hub-draft-entry hub-experience-stack">
      <HubExperienceHero
        eyebrow="Draft"
        heading="Run draft night like a real league."
        support="Create or join a league to open a lobby. Mock drafts in Tools let friends sit in without an account."
        chip={phase.label}
        chipTone="readonly"
      />
      <HubExperienceLayout
        summaryLabel="Draft snapshot"
        summary={(
          <HubExperienceSummary
            title={leagueName}
            subtitle={formatLabel}
            items={[
              { id: "format", label: "Format", value: formatLabel },
              ...(!pickDraft ? [{ id: "budget", label: "Salary cap", value: fmtSal(budget) }] : []),
              { id: "participants", label: "Participants", value: participants.label },
              { id: "phase", label: "Phase", value: phase.label },
            ]}
            note={participants.detail}
          />
        )}
      >
        <article className="hub-experience-section hub-draft-entry-card hub-draft-entry-card--live is-emphasized">
          <header className="hub-draft-entry-card-head">
            <h3>Open a live lobby</h3>
            <p className="chart-note">Live draft is for your real room. Keepers and contracts apply.</p>
          </header>
          <div className="hub-draft-entry-card-actions">
            {leagueId && roomLoading ? (
              <span className="chart-note">Loading room…</span>
            ) : (
              <button
                type="button"
                className="btn-ghost"
                disabled={!onNavigate}
                onClick={() => onNavigate?.("setup")}
              >
                Open league setup
              </button>
            )}
          </div>
        </article>
        <article className="hub-experience-section hub-draft-entry-card hub-draft-entry-card--practice">
          <header className="hub-draft-entry-card-head">
            <h3>Mock draft</h3>
            <p className="chart-note">Invite friends or draft vs bots. Nothing here changes this league.</p>
          </header>
          <div className="hub-draft-entry-card-actions">
            <button type="button" className="btn-primary" onClick={() => navigate("/tools/mock-draft")}>
              Open mock draft
            </button>
          </div>
        </article>
      </HubExperienceLayout>
    </div>
  );
}
