import React, { useEffect, useState } from "react";
import Button from "../ui/Button";
import {
  formatDraftScheduleLabel,
  formatDraftWait,
  joinWallDateTime,
  splitWallDateTime,
} from "./draftEntryStatus";
import {
  draftNightChangeSummary,
  draftNightEmpty,
  draftNightHeading,
  draftNightLockAction,
  draftNightLockedChip,
  draftNightSupport,
  draftNightUnlockAction,
} from "./leagueAccessCopy";

export default function DraftNightSchedule({
  variant = "featured",
  startsAt = null,
  timezone = "",
  wall = "",
  onWallChange,
  onTimezoneChange,
  tzOptions = [],
  canEdit = false,
  busy = false,
  waitSecs = null,
  minDate = "",
  onSave,
  onClear,
}) {
  const { date, time } = splitWallDateTime(wall);
  const scheduledLabel = startsAt ? formatDraftScheduleLabel(startsAt, timezone) : "";
  const waitLabel = waitSecs != null && waitSecs > 0 ? formatDraftWait(waitSecs) : "";
  const locked = Boolean(startsAt);
  const [formOpen, setFormOpen] = useState(!locked);

  useEffect(() => {
    setFormOpen(!locked);
  }, [locked]);

  return (
    <article
      className={`hub-experience-section draft-lobby-schedule draft-night-schedule draft-night-schedule--${variant}${locked ? " is-set is-locked" : ""}`}
    >
      <header className="hub-draft-entry-card-head">
        <div>
          <h3>{draftNightHeading()}</h3>
          <p className="chart-note">{draftNightSupport({ scheduled: locked, compact: variant === "compact" })}</p>
        </div>
        {locked ? (
          <span className="hub-experience-chip">{draftNightLockedChip()}</span>
        ) : null}
      </header>

      <div className="draft-night-when" aria-live="polite">
        {scheduledLabel ? (
          <>
            <p className="draft-night-when-time">{scheduledLabel}</p>
            {waitLabel ? <p className="draft-night-when-wait">{waitLabel}</p> : null}
          </>
        ) : (
          <p className="draft-night-when-empty">{draftNightEmpty()}</p>
        )}
      </div>

      {canEdit ? (
        locked && !formOpen ? (
          <div className="hub-draft-schedule-actions">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setFormOpen(true)}>
              {draftNightChangeSummary()}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onClear?.()}>
              {draftNightUnlockAction()}
            </Button>
          </div>
        ) : (
          <div className="hub-draft-schedule">
            <div className="hub-draft-schedule-fields">
              <label>
                Date
                <input
                  type="date"
                  value={date}
                  min={minDate || undefined}
                  onChange={(e) => onWallChange?.(joinWallDateTime(e.target.value, time || "19:00"))}
                  disabled={busy}
                />
              </label>
              <label>
                Time
                <input
                  type="time"
                  value={time}
                  onChange={(e) => onWallChange?.(joinWallDateTime(date, e.target.value))}
                  disabled={busy}
                />
              </label>
              <label className="hub-draft-schedule-tz">
                Timezone
                <select
                  value={timezone}
                  onChange={(e) => onTimezoneChange?.(e.target.value)}
                  disabled={busy}
                >
                  {tzOptions.map((tz) => (
                    <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="hub-draft-schedule-actions">
              <Button
                disabled={busy || !date || !time}
                onClick={() => onSave?.()}
              >
                {draftNightLockAction({ scheduled: locked, busy })}
              </Button>
              {locked ? (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => onClear?.()}>
                  {draftNightUnlockAction()}
                </Button>
              ) : null}
            </div>
          </div>
        )
      ) : null}
    </article>
  );
}
