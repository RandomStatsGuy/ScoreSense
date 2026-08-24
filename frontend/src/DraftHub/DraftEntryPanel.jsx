import React, { useEffect, useState } from "react";
import DraftCommissionerSettings from "./DraftCommissionerSettings";
import {
  DRAFT_TZ_OPTIONS,
  browserTimeZone,
  draftEntryPhase,
  draftFormatLabel,
  draftParticipantSummary,
  formatDraftScheduleLabel,
  formatDraftWait,
  utcIsoToWall,
} from "./draftEntryStatus";
import { fmtSal } from "./rosterFormat";
import { secondsUntil } from "./draftRoomHelpers";

/**
 * Draft room idle entry: status card + distinct Practice vs Live CTAs (SCORE-17).
 */
export default function DraftEntryPanel({
  busy = false,
  showPoolLoading = false,
  poolBlocked = false,
  botCount,
  onBotCountChange,
  onPracticeDraft,
  onSimulateFullDraft,
  onStartLiveDraft,
  onSaveSchedule,
  onStartLeagueMirror,
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
  const ctaDisabled = busy || poolBlocked;
  const [relaxSandboxLimits, setRelaxSandboxLimits] = useState(false);

  const formatLabel = draftFormatLabel(rules || league?.rules);
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
    botCount,
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
    <div className="hub-draft-entry">
      <section className="hub-draft-status-card" aria-label="Draft status">
        <div className="hub-draft-status-card-head">
          <h3 className="hub-draft-status-card-title">Draft status</h3>
          <span className={`hub-home-phase-badge hub-home-phase-badge--${phase.id === "practice" ? "live_draft" : (phase.id === "solo" ? "offseason" : phase.id)}`}>
            {phase.label}
          </span>
        </div>
        <dl className="hub-draft-status-grid">
          <div className="hub-draft-status-item">
            <dt>Format</dt>
            <dd>{formatLabel}</dd>
          </div>
          <div className="hub-draft-status-item">
            <dt>Budget</dt>
            <dd>{fmtSal(budget)}</dd>
          </div>
          <div className="hub-draft-status-item">
            <dt>Participants</dt>
            <dd>
              {participants.label}
              <span className="hub-draft-status-detail chart-note">{participants.detail}</span>
            </dd>
          </div>
          <div className="hub-draft-status-item">
            <dt>Phase</dt>
            <dd>{phase.label}</dd>
          </div>
          <div className="hub-draft-status-item">
            <dt>Draft night</dt>
            <dd>
              {scheduledLabel || "Not scheduled"}
              {waitSecs != null && waitSecs > 0 && (
                <span className="hub-draft-status-detail chart-note">
                  {formatDraftWait(waitSecs)}
                </span>
              )}
            </dd>
          </div>
        </dl>
      </section>

      <div className="hub-draft-entry-split">
        <article
          className={`hub-draft-entry-card hub-draft-entry-card--live${liveEmphasis ? " is-emphasized" : ""}`}
        >
          <header className="hub-draft-entry-card-head">
            <h3>Start live draft</h3>
            <p className="chart-note">
              {usingHubLeague || leagueId
                ? `Begin the real auction for ${leagueName}. Keepers and contracts apply.`
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

        <article className={`hub-draft-entry-card hub-draft-entry-card--practice${!liveEmphasis ? " is-emphasized" : ""}`}>
          <header className="hub-draft-entry-card-head">
            <h3>Practice draft</h3>
            <p className="chart-note">
              Mock with bots. Does not change keepers, contracts, or your real league.
            </p>
          </header>
          <div className="hub-draft-entry-card-actions hub-draft-idle-mock">
            <button
              type="button"
              className={liveEmphasis ? "btn-ghost" : "btn-primary"}
              disabled={ctaDisabled}
              onClick={() => onPracticeDraft?.()}
            >
              {busy ? "Starting…" : "Practice draft"}
            </button>
            <label className="hub-draft-idle-bots">
              Bots
              <input
                type="number"
                min={1}
                max={11}
                value={botCount}
                onChange={(e) => onBotCountChange?.(e.target.value)}
              />
            </label>
          </div>
          {showPoolLoading && (
            <p className="chart-note hub-draft-entry-pool-note">Loading player pool…</p>
          )}
        </article>
      </div>

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

      <details className="hub-draft-more">
        <summary>More options</summary>
        <div className="hub-draft-more-body">
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={ctaDisabled}
            onClick={() => onSimulateFullDraft?.()}
            title="Dev: run a full practice draft instantly, then open the post-draft report"
          >
            {busy ? "Simulating…" : "Simulate full draft"}
          </button>
          {usingHubLeague ? (
            <>
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={busy}
                onClick={() => onStartLeagueMirror?.()}
              >
                Practice with {hubContext?.league_name || "your league"} managers
              </button>
              {isCommissioner && (
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
              )}
            </>
          ) : (
            <p className="chart-note">
              Join a league in{" "}
              <button type="button" className="btn-link" onClick={() => onNavigate?.("setup")}>
                Setup
              </button>{" "}
              to practice with your managers.
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
    </div>
  );
}
