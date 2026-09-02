import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import Button from "../ui/Button";
import {
  availabilityChip,
  availabilityHeading,
  availabilitySaveLabel,
  availabilityStateNote,
  availabilitySupport,
  bestSlotLines,
  dayHeat,
  dayMaxCount,
  formatCalendarDay,
  formatHourLabel,
  groupDatesByMonth,
  heatTone,
  peopleLine,
  slotKey,
  slotsEqual,
  weekdayLetter,
} from "./draftAvailabilityPresentation";

function monthGrid(dates) {
  if (!dates.length) return [];
  const first = dates[0];
  const [year, month, day] = first.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day));
  const pad = start.getUTCDay();
  const cells = [];
  for (let i = 0; i < pad; i += 1) cells.push(null);
  dates.forEach((iso) => cells.push(iso));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function DraftAvailability({ leagueId, enabled = true, onSaved }) {
  const [payload, setPayload] = useState(null);
  const [mine, setMine] = useState([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!leagueId || !enabled) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/availability`);
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setPayload(data);
      setMine(data.mine || []);
      const firstOpen = (data.window?.dates || [])[0] || "";
      setSelectedDate((current) => current || firstOpen);
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [leagueId, enabled]);

  useEffect(() => {
    load();
  }, [load]);

  const availWindow = payload?.window || {};
  const heat = payload?.heat || [];
  const dirty = useMemo(() => !slotsEqual(mine, payload?.mine || []), [mine, payload]);
  const maxCount = useMemo(
    () => heat.reduce((max, slot) => Math.max(max, Number(slot.count) || 0), 0),
    [heat],
  );
  const months = useMemo(() => groupDatesByMonth(availWindow.dates || []), [availWindow.dates]);
  const selectedHours = useMemo(
    () => new Set(mine.filter((slot) => slot.date === selectedDate).map((slot) => Number(slot.hour))),
    [mine, selectedDate],
  );
  const selectedDaySlots = dayHeat(heat, selectedDate);
  const best = bestSlotLines(payload?.best || []);

  const toggleHour = (hour) => {
    if (!payload?.can_edit || !selectedDate) return;
    setMine((current) => {
      const key = slotKey(selectedDate, hour);
      const exists = current.some((slot) => slotKey(slot.date, slot.hour) === key);
      if (exists) return current.filter((slot) => slotKey(slot.date, slot.hour) !== key);
      return [...current, { date: selectedDate, hour }];
    });
  };

  const save = async () => {
    if (!leagueId || !payload?.can_edit) return;
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/availability`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slots: mine }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setPayload(data);
      setMine(data.mine || []);
      onSaved?.(data);
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (!enabled) return null;

  return (
    <article className="hub-experience-section draft-availability">
      <header className="hub-draft-entry-card-head">
        <div>
          <h3>{availabilityHeading()}</h3>
          <p className="chart-note">{availabilitySupport({ state: availWindow.state })}</p>
        </div>
        <span className={`hub-experience-chip${availWindow.state === "open" ? "" : " is-readonly"}`}>
          {availabilityChip({
            state: availWindow.state,
            submitted: payload?.submitted,
            teamCount: payload?.team_count,
          })}
        </span>
      </header>

      {loading && !payload ? <p className="chart-note">Loading the calendar…</p> : null}
      {error ? <p className="hub-alert hub-alert--danger" role="alert">{error}</p> : null}

      {payload ? (
        <>
          <p className="chart-note draft-availability-window">{availabilityStateNote(availWindow)}</p>

          {best.length > 0 ? (
            <ul className="draft-availability-best">
              {best.map((slot) => (
                <li key={slot.id}>
                  <button
                    type="button"
                    className="draft-availability-best-btn"
                    onClick={() => setSelectedDate(slot.date)}
                  >
                    <strong>{slot.label}</strong>
                    <span>{slot.count} free · {peopleLine(slot.people)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="chart-note">No overlapping nights yet. Mark yours so the room has a starting point.</p>
          )}

          {months.map((month) => (
            <section key={month.id} className="draft-availability-month">
              <h4>{month.label}</h4>
              <div className="draft-availability-dow" aria-hidden="true">
                {["S", "M", "T", "W", "T", "F", "S"].map((letter, idx) => (
                  <span key={`${letter}-${idx}`}>{letter}</span>
                ))}
              </div>
              <div className="draft-availability-grid" role="grid" aria-label={month.label}>
                {monthGrid(month.dates).map((iso, idx) => {
                  if (!iso) {
                    return <span key={`pad-${month.id}-${idx}`} className="draft-availability-day is-pad" />;
                  }
                  const count = dayMaxCount(heat, iso);
                  const mineDay = mine.some((slot) => slot.date === iso);
                  const selected = iso === selectedDate;
                  return (
                    <button
                      key={iso}
                      type="button"
                      role="gridcell"
                      aria-pressed={selected}
                      className={`draft-availability-day is-${heatTone(count, maxCount)}${selected ? " is-selected" : ""}${mineDay ? " is-mine" : ""}`}
                      onClick={() => setSelectedDate(iso)}
                    >
                      <span className="draft-availability-day-dow">{weekdayLetter(iso)}</span>
                      <span className="draft-availability-day-num">{Number(iso.slice(8, 10))}</span>
                      <span className="draft-availability-day-heat">{count > 0 ? count : "—"}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}

          {selectedDate ? (
            <div className="draft-availability-hours">
              <h4>{formatCalendarDay(selectedDate)}</h4>
              <p className="chart-note">
                {payload.can_edit
                  ? "Tap the hours you can sit. Save when the night looks right."
                  : "Hours other managers marked for this day."}
              </p>
              <div className="draft-availability-hour-row">
                {(availWindow.hours || []).map((hour) => {
                  const slot = selectedDaySlots.find((item) => Number(item.hour) === Number(hour));
                  const mineHour = selectedHours.has(Number(hour));
                  return (
                    <button
                      key={hour}
                      type="button"
                      className={`draft-availability-hour${mineHour ? " is-mine" : ""}${(slot?.count || 0) > 0 ? " has-people" : ""}`}
                      disabled={!payload.can_edit}
                      aria-pressed={mineHour}
                      onClick={() => toggleHour(hour)}
                    >
                      <strong>{formatHourLabel(hour)}</strong>
                      <span>{slot?.count ? `${slot.count} free` : "Open"}</span>
                    </button>
                  );
                })}
              </div>
              {selectedDaySlots.some((slot) => slot.count > 0) ? (
                <ul className="draft-availability-people">
                  {selectedDaySlots.filter((slot) => slot.count > 0).map((slot) => (
                    <li key={slotKey(slot.date, slot.hour)}>
                      <strong>{formatHourLabel(slot.hour)}</strong>
                      {" · "}
                      {peopleLine((slot.people || []).map((p) => p.name))}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {payload.can_edit ? (
            <div className="draft-availability-save">
              <Button disabled={saving || !dirty} onClick={save}>
                {availabilitySaveLabel({ dirty, saving })}
              </Button>
              {!dirty ? <p className="chart-note">Your times are on the shared calendar.</p> : (
                <p className="chart-note">Unsaved changes stay on this device until you save.</p>
              )}
            </div>
          ) : null}
        </>
      ) : null}
    </article>
  );
}
