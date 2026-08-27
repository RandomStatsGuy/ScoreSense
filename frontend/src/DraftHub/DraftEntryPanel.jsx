import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import DraftCommissionerSettings from "./DraftCommissionerSettings";
import {
  DRAFT_TZ_OPTIONS,
  browserTimeZone,
  draftEntryPhase,
  draftFormatLabel,
  draftParticipantSummary,
  isPickDraft,
  formatDraftScheduleLabel,
  formatDraftWait,
  utcIsoToWall,
} from "./draftEntryStatus";
import { fmtSal } from "./rosterFormat";
import { secondsUntil } from "./draftRoomHelpers";
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

  const canStartLive = Boolean(leagueId && inDraftSetup && !roomLoading && isCommissioner);
  const waitingForCommish = Boolean(leagueId && inDraftSetup && !roomLoading && !isCommissioner);
  const liveEmphasis = canStartLive || waitingForCommish;
  const leagueName = hubContext?.league_name || league?.name || "your league";
  const tzDefault = league?.draft_timezone || hubContext?.draft_timezone || browserTimeZone();
  const [draftTz, setDraftTz] = useState(tzDefault);
  const [draftWall, setDraftWall] = useState(() => utcIsoToWall(league?.draft_starts_at, tzDefault));
  const [scheduleBusy, setScheduleBusy] = useState(false);

  useEffect(() => {
    const nextTz = league?.draft_timezone || hubContext?.draft_timezone || browserTimeZone();
    setDraftTz(nextTz);
    setDraftWall(utcIsoToWall(league?.draft_starts_at || hubContext?.draft_starts_at, nextTz));
  }, [league?.draft_starts_at, league?.draft_timezone, hubContext?.draft_starts_at, hubContext?.draft_timezone]);

  const startsAt = league?.draft_starts_at || hubContext?.draft_starts_at;
  const waitSecs = startsAt ? secondsUntil(startsAt) : null;
  const scheduledLabel = startsAt ? formatDraftScheduleLabel(startsAt, draftTz) : "";
  const tzOptions = DRAFT_TZ_OPTIONS.includes(draftTz) ? DRAFT_TZ_OPTIONS : [draftTz, ...DRAFT_TZ_OPTIONS];

  const saveSchedule = async (clear = false) => {
    if (!onSaveSchedule) return;
    setScheduleBusy(true);
    try {
      await onSaveSchedule(clear ? { clear: true } : { wall: draftWall, timezone: draftTz });
    } finally {
      setScheduleBusy(false);
    }
  };

  return (
    <div className="hub-draft-entry hub-experience-stack">
      <HubExperienceHero
        eyebrow="Draft"
        heading={testMode ? "Practice the night before it counts." : "Run draft night like a real league."}
        support={
          usingHubLeague || leagueId
            ? `Set the clock, confirm the format, then start the live ${pickDraft ? "pick" : "auction"} for ${leagueName}. Mock drafts stay in Tools and never touch contracts.`
            : "Create or join a league to go live. Mock drafts in Tools let you practice the board without changing keepers or contracts."
        }
        chip={phase.label}
        chipTone={phase.id === "live_draft" || canStartLive ? "active" : "readonly"}
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
              {
                id: "night",
                label: "Draft night",
                value: scheduledLabel
                  ? (waitSecs != null && waitSecs > 0
                    ? `${scheduledLabel} · ${formatDraftWait(waitSecs)}`
                    : scheduledLabel)
                  : "Not scheduled",
              },
            ]}
            note={participants.detail}
            action={
              canStartLive ? (
                <button
                  type="button"
                  className="btn-primary hub-experience-summary-action"
                  disabled={busy}
                  onClick={onStartLiveDraft}
                >
                  {busy
                    ? "Starting…"
                    : startsAt && waitSecs > 0
                      ? "Start now"
                      : "Start live draft"}
                </button>
              ) : waitingForCommish ? (
                <p className="hub-experience-summary-note">Waiting for the commissioner to start.</p>
              ) : null
            }
          />
        )}
      >
        <article
          className={`hub-experience-section hub-draft-entry-card hub-draft-entry-card--live${liveEmphasis ? " is-emphasized" : ""}`}
        >
          <header className="hub-draft-entry-card-head">
            <h3>Start live draft</h3>
            <p className="chart-note">
              {usingHubLeague || leagueId
                ? `Begin the real ${pickDraft ? "pick draft" : "auction"} for ${leagueName}. Keepers and contracts apply.`
                : "Create or join a league first — live draft is for your real room."}
            </p>
          </header>
          <div className="hub-draft-entry-card-actions">
            {canStartLive ? (
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={onStartLiveDraft}
              >
                {busy
                  ? "Starting…"
                  : startsAt && waitSecs > 0
                    ? "Start now"
                    : "Start live draft"}
              </button>
            ) : waitingForCommish ? (
              <span className="chart-note hub-draft-idle-wait">Waiting for commissioner to start</span>
            ) : leagueId && roomLoading ? (
              <span className="chart-note">Loading room…</span>
            ) : leagueId && !inDraftSetup ? (
              <span className="chart-note">Live draft unavailable in this room state</span>
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
          {canStartLive && !testMode && emptySeats > 0 && (
            <p className="chart-note hub-draft-empty-seats">
              {emptySeats} empty seat{emptySeats === 1 ? "" : "s"}
              {claimedHumans ? ` (${claimedHumans} claimed)` : ""}. Starting requires a confirm.
            </p>
          )}
          {canStartLive && onSaveSchedule && (
            <div className="hub-draft-schedule">
              <label>
                Date & time
                <input
                  type="datetime-local"
                  value={draftWall}
                  onChange={(e) => setDraftWall(e.target.value)}
                  disabled={scheduleBusy || busy}
                />
              </label>
              <label>
                Timezone
                <select
                  value={draftTz}
                  onChange={(e) => setDraftTz(e.target.value)}
                  disabled={scheduleBusy || busy}
                >
                  {tzOptions.map((tz) => (
                    <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </label>
              <div className="hub-draft-schedule-actions">
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={scheduleBusy || busy || !draftWall}
                  onClick={() => saveSchedule(false)}
                >
                  {scheduleBusy ? "Saving…" : "Save draft time"}
                </button>
                {startsAt && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={scheduleBusy || busy}
                    onClick={() => saveSchedule(true)}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}
        </article>

        <article className={`hub-experience-section hub-draft-entry-card hub-draft-entry-card--practice${!liveEmphasis ? " is-emphasized" : ""}`}>
          <header className="hub-draft-entry-card-head">
            <h3>Mock draft</h3>
            <p className="chart-note">
              Practice vs bots in Tools. Does not change keepers, contracts, or this league.
            </p>
          </header>
          <div className="hub-draft-entry-card-actions">
            <button
              type="button"
              className={liveEmphasis ? "btn-ghost" : "btn-primary"}
              onClick={() => navigate("/tools/mock-draft")}
            >
              Open mock draft
            </button>
          </div>
        </article>

        {usingHubLeague && isCommissioner && expirePreview && (
          <p className="chart-note hub-draft-expire-preview">
            Keepers: {expirePreview.retained_count} retained · {expirePreview.expire_count} expire before draft
            (nominatable). Real league unchanged in a keeper sandbox.
          </p>
        )}
        {testMode && mockModeLabel === "Keeper sandbox" && inDraftSetup && (
          <p className="chart-note hub-draft-expire-preview">
            Sandbox copy of keepers — inspect Commissioner/Roster expire badges, then Start live draft.
            Delete sandbox when finished.
            {rules?.relax_salary_roster_limits
              ? " Salary cap and position limits are off."
              : ""}
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
                  title="Copy keepers into a practice room to test expire / year tick"
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
                <span className="chart-note">
                  Use when keeper salaries aren’t updated yet. Practice room only — live draft still enforces cap and roster limits.
                </span>
              </div>
            ) : (
              <p className="chart-note">
                Mock drafts and full simulations live in{" "}
                <button type="button" className="btn-link" onClick={() => navigate("/tools/mock-draft")}>
                  Tools → Mock draft
                </button>
                .
              </p>
            )}
            {testMode && isCommissioner && inDraftSetup && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={busy}
                onClick={() => onDeleteSandbox?.()}
              >
                Delete sandbox
              </button>
            )}
            {leagueId && inDraftSetup && !roomLoading && isCommissioner && onCommissionerUpdated && (
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
      </HubExperienceLayout>
    </div>
  );
}
