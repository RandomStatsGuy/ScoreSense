/** Copy and calendar helpers for the shared draft-night availability grid. */

export const AVAILABILITY_HOURS = [12, 14, 16, 18, 19, 20, 21, 22];

export function availabilityHeading() {
  return "When can you draft?";
}

export function availabilitySupport({ state = "open", locked = false } = {}) {
  if (locked) {
    return "Draft night is locked. Mark other times only if it has to move.";
  }
  if (state === "upcoming") {
    return "The shared calendar opens 31 days before the first NFL game. One place to mark nights that work.";
  }
  if (state === "closed") {
    return "The calendar closed the day before kickoff. Draft night is the commissioner's call from here.";
  }
  return "Mark the evenings that work. Everyone sees the same calendar, so the room can pick a night that actually fills.";
}

export function availabilityChip({ state = "open", submitted = 0, teamCount = 0, locked = false } = {}) {
  if (locked) return "Night locked";
  if (state === "upcoming") return "Opens soon";
  if (state === "closed") return "Closed";
  if (teamCount > 0 && submitted >= teamCount) return "Everyone marked";
  if (submitted > 0) return `${submitted} marked`;
  return "Open";
}

export function availabilityStateNote(window = {}) {
  const opens = formatCalendarDay(window.opens_on);
  const closes = formatCalendarDay(window.closes_on);
  const kick = formatCalendarDay(window.first_game_date);
  if (window.state === "upcoming") {
    return opens ? `Opens ${opens} — 31 days before ${kick || "kickoff"}.` : "Opens 31 days before the first NFL game.";
  }
  if (window.state === "closed") {
    return closes
      ? `Closed ${closes}, the day before ${kick || "the first NFL game"}.`
      : "Closed the day before the first NFL game.";
  }
  return closes
    ? `Open through ${closes}, the day before ${kick || "kickoff"}.`
    : "Open until the day before the first NFL game.";
}

export function availabilitySaveLabel({ dirty = false, saving = false } = {}) {
  if (saving) return "Saving…";
  return dirty ? "Save times" : "Times saved";
}

export function availabilityBestHeading() {
  return "Nights that already overlap";
}

export function availabilityEmptyBest() {
  return "No overlapping nights yet. Mark yours so the room has a starting point.";
}

export function availabilityHoursHint({ canEdit = false } = {}) {
  return canEdit
    ? "Tap the hours you can sit. Save when the night looks right."
    : "Hours other managers marked for this day.";
}

export function availabilityHoursGone() {
  return "Tonight's hours have passed. Pick another night.";
}

export function availabilityLockLabel({ locked = false, locking = false } = {}) {
  if (locking) return "Locking…";
  if (locked) return "Locked in";
  return "Lock this night";
}

export function availabilityLockHint() {
  return "Lock the night that already has the room.";
}

export function availabilityLoading() {
  return "Loading the calendar…";
}

export function formatHourLabel(hour) {
  const value = Number(hour);
  if (!Number.isFinite(value)) return "";
  const period = value >= 12 ? "p.m." : "a.m.";
  const twelve = value % 12 === 0 ? 12 : value % 12;
  return `${twelve} ${period}`;
}

export function formatCalendarDay(isoDate) {
  if (!isoDate) return "";
  const parts = String(isoDate).slice(0, 10).split("-");
  if (parts.length !== 3) return "";
  const [year, month, day] = parts.map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function weekdayLetter(isoDate) {
  const label = formatCalendarDay(isoDate);
  return label ? label.slice(0, 2) : "";
}

export function monthHeading(isoDate) {
  if (!isoDate) return "";
  const [year, month] = String(isoDate).slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, 1));
  return dt.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function groupDatesByMonth(dates = []) {
  const groups = [];
  dates.forEach((iso) => {
    const key = String(iso).slice(0, 7);
    let group = groups.find((entry) => entry.id === key);
    if (!group) {
      group = { id: key, label: monthHeading(iso), dates: [] };
      groups.push(group);
    }
    group.dates.push(iso);
  });
  return groups;
}

export function slotKey(date, hour) {
  return `${date}|${hour}`;
}

export function slotsEqual(a = [], b = []) {
  const left = new Set((a || []).map((s) => slotKey(s.date, s.hour)));
  const right = new Set((b || []).map((s) => slotKey(s.date, s.hour)));
  if (left.size !== right.size) return false;
  for (const key of left) {
    if (!right.has(key)) return false;
  }
  return true;
}

export function dayHeat(heat = [], date) {
  return (heat || []).filter((slot) => slot.date === date);
}

export function dayMaxCount(heat = [], date) {
  return dayHeat(heat, date).reduce((max, slot) => Math.max(max, Number(slot.count) || 0), 0);
}

export function heatTone(count, maxCount = 0) {
  const n = Number(count) || 0;
  if (n <= 0) return "empty";
  if (!maxCount || n >= maxCount) return "best";
  if (n >= Math.ceil(maxCount / 2)) return "strong";
  return "some";
}

export function bestSlotLines(best = [], limit = 4) {
  return (best || []).slice(0, limit).map((slot) => ({
    id: slotKey(slot.date, slot.hour),
    date: slot.date,
    hour: slot.hour,
    count: Number(slot.count) || 0,
    label: `${formatCalendarDay(slot.date)} · ${formatHourLabel(slot.hour)}`,
    people: (slot.people || []).map((p) => p.name).filter(Boolean),
  }));
}

export function peopleLine(people = []) {
  const names = people.filter(Boolean);
  if (!names.length) return "No one yet";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]}, and ${names.length - 2} more`;
}

export const DATE_STRIP_LIMIT = 14;

export function preferDateStrip(dates = []) {
  return Array.isArray(dates) && dates.length > 0 && dates.length <= DATE_STRIP_LIMIT;
}

export function isSlotCurrentOrFuture(date, hour, today, currentHour) {
  const day = String(date || "");
  const nowDay = String(today || "");
  if (!day) return false;
  if (!nowDay) return true;
  if (day > nowDay) return true;
  if (day < nowDay) return false;
  if (currentHour == null || currentHour === "") return true;
  return Number(hour) >= Number(currentHour);
}

export function visibleHoursForDate(date, hours = [], today, currentHour) {
  return (hours || []).filter((hour) => isSlotCurrentOrFuture(date, hour, today, currentHour));
}

export function firstSelectableDate(dates = [], hours = [], today, currentHour) {
  for (const iso of dates || []) {
    if (visibleHoursForDate(iso, hours, today, currentHour).length) return iso;
  }
  return "";
}

export function calendarTodayIso(now = new Date(), timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  return year && month && day ? `${year}-${month}-${day}` : "";
}

export function slotToWall(date, hour) {
  const day = String(date || "").slice(0, 10);
  const clock = Number(hour);
  if (!day || !Number.isFinite(clock)) return "";
  return `${day}T${String(clock).padStart(2, "0")}:00`;
}

export function wallToSlot(wall) {
  const raw = String(wall || "");
  const [date, time = ""] = raw.split("T");
  const hour = Number(String(time).slice(0, 2));
  if (!date || !Number.isFinite(hour)) return null;
  return { date, hour };
}

export function isSameSlot(left, right) {
  if (!left || !right) return false;
  return String(left.date) === String(right.date) && Number(left.hour) === Number(right.hour);
}
