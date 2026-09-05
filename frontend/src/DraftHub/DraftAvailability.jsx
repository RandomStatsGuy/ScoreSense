import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import Button from "../ui/Button";
import {
  availabilityBestHeading,
  availabilityChip,
  availabilityEmptyBest,
  availabilityHeading,
  availabilityHoursGone,
  availabilityHoursHint,
  availabilityLoading,
  availabilityLockHint,
  availabilityLockHourLabel,
  availabilityLockLabel,
  availabilitySaveLabel,
  availabilityStatusChip,
  formatLockedNightDisclosure,
  availabilitySupport,
  availabilityUnsavedHint,
  bestSlotLines,
  dayHeat,
  dayMaxCount,
  firstSelectableDate,
  formatCalendarDay,
  formatHourLabel,
  groupDatesByMonth,
  heatTone,
  isSameSlot,
  peopleLine,
  preferDateStrip,
  slotKey,
  slotsEqual,
  visibleHoursForDate,
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

export default function DraftAvailability({
  leagueId,
  enabled = true,
  canLock = false,
  lockedSlot = null,
  lockBusy = false,
  lockedStartsAt = "",
  onSaved,
  onHighlight,
  onLockSlot,
  onWindowChange,
  children = null,
}) {
  const [payload, setPayload] = useState(null);
  const [mine, setMine] = useState([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [activeMonth, setActiveMonth] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [tappedHour, setTappedHour] = useState(null);
  const mobileLayout = useMobileLayout();

  useEffect(() => {
    setTappedHour(null);
  }, [selectedDate]);

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
      const windowDates = data.window?.dates || [];
      const nextDate = firstSelectableDate(
        windowDates,
        data.window?.hours || [],
        data.window?.today,
        data.window?.current_hour,
      );
      setSelectedDate((current) => (
        current && windowDates.includes(current)
          ? current
          : nextDate
      ));
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
  const visibleDates = availWindow.dates || [];
  const months = useMemo(() => groupDatesByMonth(visibleDates), [visibleDates]);
  const useStrip = preferDateStrip(visibleDates);
  const visibleMonths = useMemo(() => {
    if (useStrip || months.length <= 1) return months;
    const match = months.find((month) => month.id === activeMonth);
    return match ? [match] : months.slice(0, 1);
  }, [activeMonth, months, useStrip]);
  const selectedHours = useMemo(
    () => new Set(mine.filter((slot) => slot.date === selectedDate).map((slot) => Number(slot.hour))),
    [mine, selectedDate],
  );
  const hourChoices = useMemo(
    () => visibleHoursForDate(
      selectedDate,
      availWindow.hours || [],
      availWindow.today,
      availWindow.current_hour,
    ),
    [availWindow.current_hour, availWindow.hours, availWindow.today, selectedDate],
  );
  const selectedDaySlots = dayHeat(heat, selectedDate);
  const best = bestSlotLines(payload?.best || [], 2);
  const bestLabel = best[0]?.label || "";
  const locked = Boolean(lockedSlot?.date);

  useEffect(() => {
    onWindowChange?.(availWindow.state || "open");
  }, [availWindow.state, onWindowChange]);

  useEffect(() => {
    if (!months.length) return;
    setActiveMonth((current) => (
      months.some((month) => month.id === current) ? current : months[0].id
    ));
  }, [months]);

  useEffect(() => {
    if (!visibleDates.length) return;
    const stillOpen = selectedDate
      && visibleDates.includes(selectedDate)
      && visibleHoursForDate(
        selectedDate,
        availWindow.hours || [],
        availWindow.today,
        availWindow.current_hour,
      ).length > 0;
    if (stillOpen) return;
    const next = firstSelectableDate(
      visibleDates,
      availWindow.hours || [],
      availWindow.today,
      availWindow.current_hour,
    );
    if (next && next !== selectedDate) setSelectedDate(next);
  }, [availWindow.current_hour, availWindow.hours, availWindow.today, selectedDate, visibleDates]);

  useEffect(() => {
    onHighlight?.(bestLabel);
  }, [bestLabel, onHighlight]);

  useEffect(() => {
    const dates = payload?.window?.dates || [];
    if (lockedSlot?.date && dates.includes(lockedSlot.date)) {
      setSelectedDate(lockedSlot.date);
    }
  }, [lockedSlot?.date, payload?.window?.dates]);

  const toggleHour = (hour) => {
    if (!payload?.can_edit || !selectedDate) return;
    setTappedHour(Number(hour));
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

  const offerTappedLock = Boolean(
    canLock && best.length === 0 && tappedHour != null && selectedDate,
  );
  const hideLockPills = mobileLayout && locked;

  const renderDayButton = (iso, { strip = false } = {}) => {
    const count = dayMaxCount(heat, iso);
    const mineDay = mine.some((slot) => slot.date === iso);
    const selected = iso === selectedDate;
    const dayLocked = lockedSlot?.date === iso;
    return (
      <button
        key={iso}
        type="button"
        role={strip ? undefined : "gridcell"}
        aria-pressed={selected}
        className={`${strip ? "draft-availability-strip-day" : "draft-availability-day"} is-${heatTone(count, maxCount)}${selected ? " is-selected" : ""}${mineDay ? " is-mine" : ""}${dayLocked ? " is-locked" : ""}`}
        onClick={() => setSelectedDate(iso)}
      >
        <span className="draft-availability-day-dow">{weekdayLetter(iso)}</span>
        <span className="draft-availability-day-num">{Number(iso.slice(8, 10))}</span>
        {count > 0 ? <span className="draft-availability-day-heat">{count}</span> : null}
      </button>
    );
  };

  const calendarBoard = (
    <>
      <div className="draft-availability-calendar">
        {useStrip ? (
          <div className="draft-availability-strip" role="listbox" aria-label="Upcoming nights">
            {visibleDates.map((iso) => renderDayButton(iso, { strip: true }))}
          </div>
        ) : (
          <>
            {months.length > 1 ? (
              <div className="draft-availability-month-nav" role="tablist" aria-label="Calendar month">
                {months.map((month) => (
                  <button
                    key={month.id}
                    type="button"
                    role="tab"
                    aria-selected={month.id === (activeMonth || months[0].id)}
                    className={`draft-availability-month-tab${month.id === (activeMonth || months[0].id) ? " is-active" : ""}`}
                    onClick={() => setActiveMonth(month.id)}
                  >
                    {month.label}
                  </button>
                ))}
              </div>
            ) : null}

            {visibleMonths.map((month) => (
              <section key={month.id} className="draft-availability-month">
                {months.length > 1 ? null : <h4>{month.label}</h4>}
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
                    return renderDayButton(iso);
                  })}
                </div>
              </section>
            ))}
          </>
        )}
      </div>

      <div className="draft-availability-times">
        {selectedDate ? (
          <div className="draft-availability-hours">
            <h4>{formatCalendarDay(selectedDate)}</h4>
            {hourChoices.length ? (
              <>
                <p className="chart-note">{availabilityHoursHint({ canEdit: payload?.can_edit })}</p>
                <div className="draft-availability-hour-row">
                  {hourChoices.map((hour) => {
                    const slot = selectedDaySlots.find((item) => Number(item.hour) === Number(hour));
                    const mineHour = selectedHours.has(Number(hour));
                    const hourLocked = isSameSlot(lockedSlot, { date: selectedDate, hour });
                    return (
                      <button
                        key={hour}
                        type="button"
                        className={`draft-availability-hour${mineHour ? " is-mine" : ""}${(slot?.count || 0) > 0 ? " has-people" : ""}${hourLocked ? " is-locked" : ""}`}
                        disabled={!payload?.can_edit}
                        aria-pressed={mineHour}
                        onClick={() => toggleHour(hour)}
                      >
                        <strong>{formatHourLabel(hour)}</strong>
                        {slot?.count ? <span>{slot.count} free</span> : null}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="chart-note">{availabilityHoursGone()}</p>
            )}
          </div>
        ) : null}

        {best.length > 0 ? (
          <section className="draft-availability-best-wrap" aria-labelledby="draft-availability-best-heading">
            <h4 id="draft-availability-best-heading">{availabilityBestHeading()}</h4>
            {canLock ? <p className="chart-note">{availabilityLockHint()}</p> : null}
            <ul className="draft-availability-best">
              {best.map((slot, idx) => {
                const slotLocked = isSameSlot(lockedSlot, slot);
                return (
                  <li key={slot.id} className={`draft-availability-best-item${slotLocked ? " is-locked" : ""}`}>
                    <button
                      type="button"
                      className={`draft-availability-best-btn${idx === 0 ? " is-top" : ""}${slotLocked ? " is-locked" : ""}`}
                      onClick={() => setSelectedDate(slot.date)}
                    >
                      <strong>{slot.label}</strong>
                      <span>{slot.count} free · {peopleLine(slot.people)}</span>
                    </button>
                    {canLock && !hideLockPills ? (
                      <Button
                        size="sm"
                        variant={slotLocked ? "ghost" : "primary"}
                        disabled={lockBusy || slotLocked}
                        onClick={() => onLockSlot?.(slot)}
                      >
                        {availabilityLockLabel({ locked: slotLocked, locking: lockBusy && !slotLocked })}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : (
          <p className="chart-note">{availabilityEmptyBest({ state: availWindow.state })}</p>
        )}
      </div>
    </>
  );

  const lockTappedHour = offerTappedLock ? (
    <Button
      size="sm"
      variant="ghost"
      disabled={lockBusy}
      onClick={() => onLockSlot?.({ date: selectedDate, hour: tappedHour })}
    >
      {availabilityLockHourLabel({ date: selectedDate, hour: tappedHour })}
    </Button>
  ) : null;

  return (
    <article className={`hub-experience-section draft-availability is-featured${locked ? " is-locked" : ""}`}>
      <header className="hub-draft-entry-card-head">
        <div>
          <h3>{availabilityHeading()}</h3>
          <p className="chart-note">{availabilitySupport({ state: availWindow.state, locked })}</p>
        </div>
        <span className={`hub-experience-chip${availWindow.state === "open" || locked ? "" : " is-readonly"}`}>
          {availabilityChip({
            state: availWindow.state,
            submitted: payload?.submitted,
            teamCount: payload?.team_count,
            locked,
          })}
        </span>
      </header>

      {loading && !payload ? <p className="chart-note">{availabilityLoading()}</p> : null}
      {error ? <p className="hub-alert hub-alert--danger" role="alert">{error}</p> : null}

      {payload ? (
        <>
          {locked ? (
            <details className="draft-availability-locked-line">
              <summary>{formatLockedNightDisclosure(lockedStartsAt)}</summary>
              <div className="draft-availability-board is-disclosed">
                {calendarBoard}
              </div>
            </details>
          ) : (
            <div className="draft-availability-board">
              {calendarBoard}
            </div>
          )}

          {payload.can_edit || offerTappedLock ? (
            <div className="draft-availability-save">
              {payload.can_edit && dirty ? (
                <Button disabled={saving} onClick={save}>
                  {availabilitySaveLabel({ dirty, saving })}
                </Button>
              ) : mobileLayout ? (
                <p className="draft-availability-status-chip">{availabilityStatusChip({ locked, dirty })}</p>
              ) : payload.can_edit ? (
                dirty ? (
                  <Button disabled={saving} onClick={save}>
                    {availabilitySaveLabel({ dirty, saving })}
                  </Button>
                ) : (
                  <p className="draft-availability-status-chip is-saved">
                    {availabilityStatusChip({ locked, dirty })}
                  </p>
                )
              ) : null}
              {lockTappedHour}
              {dirty ? <p className="chart-note">{availabilityUnsavedHint()}</p> : null}
            </div>
          ) : null}
        </>
      ) : null}
      {children}
    </article>
  );
}
