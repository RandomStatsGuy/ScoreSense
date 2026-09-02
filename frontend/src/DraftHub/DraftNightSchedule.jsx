import React from "react";
import Button from "../ui/Button";
import {
  formatDraftScheduleLabel,
  formatDraftWait,
  joinWallDateTime,
  splitWallDateTime,
} from "./draftEntryStatus";
import {
  draftNightEmpty,
  draftNightHeading,
  draftNightSupport,
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
  onSave,
  onClear,
}) {
  const { date, time } = splitWallDateTime(wall);
  const scheduledLabel = startsAt ? formatDraftScheduleLabel(startsAt, timezone) : "";
  const waitLabel = waitSecs != null && waitSecs > 0 ? formatDraftWait(waitSecs) : "";

  return (
    <article
      className={`hub-experience-section draft-lobby-schedule draft-night-schedule draft-night-schedule--${variant}${startsAt ? " is-set" : ""}`}
    >
      <header className="hub-draft-entry-card-head">
        <div>
          <h3>{draftNightHeading()}</h3>
          <p className="chart-note">{draftNightSupport({ scheduled: Boolean(startsAt) })}</p>
        </div>
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
        <div className="hub-draft-schedule">
          <div className="hub-draft-schedule-fields">
            <label>
              Date
              <input
                type="date"
                value={date}
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
              {busy ? "Saving…" : "Save draft time"}
            </Button>
            {startsAt ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => onClear?.()}>
                Clear
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}
