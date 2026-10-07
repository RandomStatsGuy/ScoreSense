/** Copy for Account → Admin. Goal + consequence. Staff-only. */

export const ADMIN_COPY = Object.freeze({
  unlinkSuccess: "Team unlinked from account",
  unlinkFailed: "Unlink failed",
  verification: Object.freeze({
    column: "Verified",
    yes: "Verified",
    no: "Not verified",
    verify: "Mark verified",
    unverify: "Remove verification",
    unavailable: "—",
    failed: "Could not change verification",
  }),
  tempPassword: Object.freeze({
    column: "Password",
    placeholder: "Temporary password",
    action: "Set temp password",
    hint: "They must choose their own at next sign-in.",
    tooShort: "Use at least 8 characters.",
    failed: "Could not set the password",
  }),
  linkExisting: Object.freeze({
    title: "Link existing account",
    hint: "Choose an account, league, and open team to restore access. Rosters and contracts stay with the team. If the team is linked to the wrong account, unlink it in the league details first.",
    accountPlaceholder: "Choose account…",
    leaguePlaceholder: "Choose league…",
    saving: "Linking…",
    assignmentTitle: "Assign accounts to teams",
    emailPlaceholder: "account email",
    teamPlaceholder: "Select team…",
    action: "Link account",
    needEmail: "Choose an account or enter its email.",
    needTeam: "Pick an open franchise.",
    emptySeats: "Every franchise already has an account.",
    failed: "Link failed",
  }),
});

export function adminLinkSuccess({ email, team } = {}) {
  const who = String(email || "").trim() || "that account";
  const franchise = String(team || "").trim() || "the team";
  return `Linked ${who} to ${franchise}. They will see that team in Fantasy.`;
}

export function adminLinkAccountRef(value) {
  const raw = String(value || "").trim();
  if (!raw) return {};
  if (raw.startsWith("ss:") || raw.startsWith("bot:")) {
    return { user_sub: raw };
  }
  return { email: raw };
}

export function openAdminFranchises(teams) {
  return (teams || []).filter((t) => t && !t.user_sub && !t.is_bot);
}

export function adminVerifySuccess({ email, verified } = {}) {
  const who = String(email || "").trim() || "that account";
  return verified
    ? `${who} is verified. They can open Fantasy now.`
    : `${who} is no longer verified. Fantasy stays closed to them until they verify again.`;
}

export function adminTempPasswordSuccess({ email, notified } = {}) {
  const who = String(email || "").trim() || "that account";
  const note = notified
    ? "They were emailed that an admin reset it."
    : "No email went out — pass it on yourself.";
  return `Temporary password set for ${who}. Signed out everywhere; they must choose a new one at next sign-in. ${note}`;
}

export const ADMIN_TAB_ITEMS = Object.freeze([
  { id: "overview", label: "Overview" },
  { id: "server", label: "Server" },
  { id: "jobs", label: "Jobs" },
  { id: "sessions", label: "Sessions" },
  { id: "settings", label: "Settings" },
  { id: "activity", label: "Activity" },
  { id: "users", label: "Users" },
  { id: "leagues", label: "Leagues" },
]);

const PACIFIC = "America/Los_Angeles";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const NUMBER_WORDS = ["Nothing", "One thing", "Two things", "Three things", "Four things", "Five things"];

export const ADMIN_OPS_COPY = Object.freeze({
  refresh: "Refresh",
  refreshing: "Refreshing…",
  updated: (time) => `Updated ${time}`,
  loadFailed: "Could not load this tab. Try Refresh.",
  overview: Object.freeze({
    calm: "Everything is running",
    calmSupport: "No failed jobs, missing caches, or server errors in the last hour.",
    attention: "Needs attention",
    comingUp: "Coming up",
    allJobs: "All jobs",
    nothingScheduled: "No jobs are scheduled. Turn one on in Jobs.",
    deploy: "Deploy",
    activity: "Recent admin activity",
    allActivity: "All",
    noActivity: "No admin actions yet.",
    api: "API",
    server: "Server",
    jobs: "Jobs",
    activeNow: "Active now",
  }),
  server: Object.freeze({
    title: "Server",
    support: "Read when you open or refresh this tab. Numbers cover the API container since it last started.",
    resources: "Resources",
    process: "Process",
    caches: "Caches",
    cachesNote: "A missing cache falls back to a live model run, which is slow.",
    slowest: "Slowest routes",
    slowestNote: "95th percentile since start",
    noSlowest: "No API traffic yet.",
    errors: "Recent server errors",
    errorsNote: "Exception type only",
    noErrors: "No server errors since start.",
    rebuild: "Rebuild",
    rebuilding: "Rebuilding…",
    rebuildStarted: "Rebuild started. The cache row updates when it finishes.",
    cpuMeasuring: "Measuring…",
    cpuWindow: "1-min average",
    processes: "Processes",
    processesNote: "Share of the whole server over the last minute",
    processCol: "Process",
    runningCol: "Running now",
    cpuCol: "Avg CPU",
    memoryCol: "Memory",
    idle: "Idle",
    otherPrograms: "Everything else on this server",
    noProcesses: "Process numbers are unavailable on this host.",
  }),
  export: Object.freeze({
    copy: "Copy for chat",
    download: "Download",
    copied: "Copied. Paste it into chat to share these numbers.",
    downloaded: "Downloaded.",
    copyFailed: "Copy did not work in this browser. Use Download instead.",
  }),
  usage: Object.freeze({
    title: "What uses the most",
    note: "Finished runs. Memory is measured for jobs in the background worker.",
    window: "Window",
    sort: "Sort by",
    job: "Job",
    runs: "Times run",
    avg: "Avg time",
    longest: "Longest",
    cpu: "CPU time",
    memory: "Peak memory",
    empty: "No finished runs in this window.",
    shared: "Shared",
  }),
  jobs: Object.freeze({
    title: "Jobs",
    support: "Times are Pacific. A job that is already running is never started twice.",
    runNow: "Run now",
    retryNow: "Retry now",
    running: "Running…",
    started: (label) => `${label} started. Its row updates when it finishes.`,
    manualOnly: "Manual only",
    automatic: "Automatic",
    never: "No runs yet",
    schedule: "Schedule",
    repeat: "Repeat",
    day: "Day",
    at: "At (PT)",
    enabled: "Runs on this schedule",
    disabled: "Off · runs only when you start it",
    saveSchedule: "Save schedule",
    scheduleSaved: (label) => `${label} schedule saved.`,
    automaticNote: "Runs on its own inside the API. You can still run it now.",
    recentRuns: "Recent runs",
    noRecentRuns: "No runs in the last 7 days.",
    nextRun: (when) => `Next run ${when}`,
    retryAt: (when) => `Automatic retry ${when}`,
    weeklyCron:
      "Turn this on only after the server's Tuesday crontab line is removed, or the refresh runs twice.",
  }),
  sessions: Object.freeze({
    title: "Sessions",
    support:
      "Last seen updates at most every 5 minutes per account. Sign out everywhere ends every session; they sign in again on their next visit.",
    last15: "Last 15 minutes",
    last24: "Last 24 hours",
    last7: "Last 7 days",
    newWeek: "New this week",
    ofAccounts: (n) => `of ${n} accounts`,
    account: "Account",
    signsIn: "Signs in with",
    leagues: "Leagues",
    lastSeen: "Last seen",
    action: "Action",
    signOut: "Sign out everywhere",
    signingOut: "Signing out…",
    confirmSignOut: (email) => `Sign ${email} out everywhere? They sign in again on their next visit.`,
    signedOut: (email) => `${email} is signed out everywhere.`,
    notSeen: "Not since tracking began",
    empty: "No accounts yet.",
    password: "Password",
    google: "Google",
    both: "Google + password",
  }),
  settings: Object.freeze({
    title: "Settings",
    support: "These apply right away, without a deploy. Each change is written to Activity.",
    site: "Site",
    save: "Save settings",
    saving: "Saving…",
    saved: (n) => (n ? `Saved ${n} ${n === 1 ? "change" : "changes"}.` : "Nothing changed."),
    environment: "Server environment",
    environmentNote: "Read-only. Change these in the server's .env file and restart. Secrets are never shown.",
    on: "On",
    off: "Off",
    set: "Set",
    notSet: "Not set",
    messagePlaceholder: "One line shown at the top of every page",
    minutes: (n) => `Every ${n} min`,
    retryOff: "Off",
    retryAfter: (n) => `Once after ${n} min`,
  }),
  activity: Object.freeze({
    title: "Activity",
    support: (days) => `Every admin action and job outcome, newest first. Kept for ${days} days.`,
    what: "What happened",
    who: "Who",
    when: "When",
    empty: "No admin actions yet.",
  }),
});

export const ADMIN_SETTING_COPY = Object.freeze({
  signups_open: {
    what: "New sign-ups",
    why: "Off blocks new accounts. Anyone with a pending league invite can still create one.",
  },
  email_verification_required: {
    what: "Require email verification",
    why: "Off lets unverified accounts open Fantasy without confirming their email.",
  },
  maintenance_banner_on: {
    what: "Maintenance banner",
    why: "Shows your message in a one-line notice at the top of every page.",
  },
  maintenance_message: { what: "Banner message", why: "" },
  injury_poll_reporting_minutes: {
    what: "Injury poll on report days",
    why: "How often Sleeper injuries refresh on practice-report and game days.",
  },
  injury_poll_inseason_minutes: {
    what: "Injury poll other in-season days",
    why: "",
  },
  injury_poll_offseason_minutes: {
    what: "Injury poll in the offseason",
    why: "",
  },
  job_retry_minutes: {
    what: "Retry failed scheduled jobs",
    why: "One automatic retry after the wait. Then it stays failed until you retry.",
  },
});

export const ADMIN_ENV_LABELS = Object.freeze({
  AUTH_REQUIRED: "AUTH_REQUIRED",
  HUB_AUTH_REQUIRED: "HUB_AUTH_REQUIRED",
  ADMIN_EMAILS: "ADMIN_EMAILS",
  SMTP: "Email sending",
  GOOGLE_OAUTH: "Google sign-in",
  PATREON_OAUTH: "Patreon sign-in",
  YOUTUBE_API_KEY: "YouTube API key",
  OPENAI_API_KEY: "OpenAI API key",
  JIRA_API_TOKEN: "Jira token (bug reports)",
  JOB_DIAGNOSTICS_ENABLED: "JOB_DIAGNOSTICS_ENABLED",
  HUB_TIMING: "HUB_TIMING",
});

export function adminEnvValue(row) {
  if (!row) return "";
  if (row.key === "ADMIN_EMAILS") {
    const n = Number(row.count || 0);
    return `${n} ${n === 1 ? "address" : "addresses"}`;
  }
  if (["AUTH_REQUIRED", "HUB_AUTH_REQUIRED", "JOB_DIAGNOSTICS_ENABLED", "HUB_TIMING"].includes(row.key)) {
    return row.set ? "true" : "false";
  }
  return row.set ? ADMIN_OPS_COPY.settings.set : ADMIN_OPS_COPY.settings.notSet;
}

function toDate(value) {
  if (value == null || value === "") return null;
  const d = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pacificParts(d) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC,
    year: "numeric",
    month: "short",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).formatToParts(d);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

/** "9:38 PM" today, "Tue 3:00 AM" this week, "Sep 30" earlier. Pacific time. */
export function adminWhen(value, now = new Date()) {
  const d = toDate(value);
  if (!d) return "—";
  const p = pacificParts(d);
  const n = pacificParts(now);
  const time = `${p.hour}:${p.minute} ${p.dayPeriod}`;
  const sameDay = p.year === n.year && p.month === n.month && p.day === n.day;
  if (sameDay) return `Today ${time}`;
  const ageDays = Math.abs(now.getTime() - d.getTime()) / 86400000;
  if (ageDays < 6) return `${p.weekday} ${time}`;
  if (p.year !== n.year) return `${p.month} ${p.day}, ${p.year}`;
  return `${p.month} ${p.day}`;
}

export function adminClock(value) {
  const d = toDate(value);
  if (!d) return "—";
  const p = pacificParts(d);
  return `${p.hour}:${p.minute} ${p.dayPeriod}`;
}

/** "now", "4 min", "3 h", "8 days" — for last-seen columns. */
export function adminAgo(value, now = new Date()) {
  const d = toDate(value);
  if (!d) return null;
  const s = Math.max(0, (now.getTime() - d.getTime()) / 1000);
  if (s < 90) return "now";
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} days`;
}

export function adminDuration(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return "";
  const s = Math.round(Number(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function adminUptime(startedAt, now = new Date()) {
  const d = toDate(startedAt);
  if (!d) return "—";
  const mins = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 60000));
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

export function adminBytes(bytes) {
  if (bytes == null || !Number.isFinite(Number(bytes))) return "—";
  const n = Number(bytes);
  if (n < 1024 ** 2) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

const PROCESS_ROLE_LABELS = Object.freeze({
  api: "ScoreSense API",
  cpu_worker: "Background worker",
});

export function adminProcessLabel(row) {
  return PROCESS_ROLE_LABELS[row?.role] || `Helper (${row?.name || "process"})`;
}

export function adminPercent(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  return n > 0 && n < 1 ? "<1%" : `${Math.round(n)}%`;
}

export function adminSeconds(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return "—";
  return Number(seconds) > 0 && Number(seconds) < 1 ? "<1s" : adminDuration(seconds);
}

export const ADMIN_USAGE_WINDOWS = Object.freeze([
  { id: "1", label: "Last 24 hours" },
  { id: "7", label: "Last 7 days" },
]);

export const ADMIN_USAGE_SORTS = Object.freeze([
  { id: "cpu_s", label: "CPU time" },
  { id: "peak_rss", label: "Peak memory" },
  { id: "total_s", label: "Total time" },
  { id: "runs", label: "Runs" },
]);

export function sortAdminUsage(rows, key = "cpu_s") {
  return [...(rows || [])].sort((a, b) => (Number(b?.[key]) || 0) - (Number(a?.[key]) || 0));
}

export function adminExportFilename(section, at = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `scoresense-${section}-${stamp}.json`;
}

export function adminClockLabel(atTime) {
  const [h, m] = String(atTime || "03:00").split(":").map(Number);
  const hour = Number.isFinite(h) ? h : 3;
  const minute = Number.isFinite(m) ? m : 0;
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

export const ADMIN_WEEKDAYS = Object.freeze(DAYS.map((label, id) => ({ id: String(id), label })));

export const ADMIN_SCHEDULE_TIMES = Object.freeze(
  Array.from({ length: 48 }, (_, i) => {
    const value = `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`;
    return { id: value, label: adminClockLabel(value) };
  }),
);

/** Schedule column text for one job row. */
export function adminScheduleLabel(job) {
  if (!job) return "";
  if (job.automatic) {
    if (job.id === "injury_poll" && job.detail?.cadence_seconds) {
      return `Every ${Math.round(job.detail.cadence_seconds / 60)} min now`;
    }
    return ADMIN_OPS_COPY.jobs.automatic;
  }
  const s = job.schedule;
  if (!s || !s.enabled) return ADMIN_OPS_COPY.jobs.manualOnly;
  const clock = adminClockLabel(s.at_time);
  if (s.repeat === "weekly") return `${DAYS[Number(s.weekday) || 0]} ${clock}`;
  return `Daily ${clock}`;
}

export function adminRunOutcome(run) {
  const outcome = run?.outcome;
  if (outcome === "failed") return { tone: "bad", label: "Failed" };
  if (outcome === "running") return { tone: "warn", label: "Running" };
  if (outcome === "skipped") return { tone: "", label: "Skipped" };
  if (outcome === "ok") return { tone: "ok", label: "OK" };
  return { tone: "", label: ADMIN_OPS_COPY.jobs.never };
}

export function adminOverviewHeading(count) {
  if (!count) return ADMIN_OPS_COPY.overview.calm;
  const lead = NUMBER_WORDS[count] || `${count} things`;
  return `${count === 1 ? "One thing needs" : `${lead} need`} you`;
}

const CACHE_KIND = { draft: "Draft pool", weekly: "Weekly board", ros: "Rest of season" };

export function adminCacheLabel(row) {
  if (!row) return "";
  const base = `${CACHE_KIND[row.kind] || row.kind} ${row.season}`;
  return row.week ? `${base} · Week ${row.week}` : base;
}

export function adminCacheStatus(status) {
  return (
    {
      ok: { tone: "ok", label: "Fresh" },
      due: { tone: "warn", label: "Due for refresh" },
      running: { tone: "warn", label: "Rebuilding" },
      error: { tone: "bad", label: "Last build failed" },
      missing: { tone: "bad", label: "Missing" },
    }[status] || { tone: "", label: status || "—" }
  );
}

/** Title, explanation, and fix for one Needs attention row. */
export function adminAttentionCopy(item, now = new Date()) {
  if (!item) return null;
  if (item.kind === "job") {
    const retry = item.retry_due_at ? ` Automatic retry ${adminWhen(item.retry_due_at, now)}.` : "";
    const reason = item.reason ? ` ${String(item.reason).replace(/\.$/, "")}.` : "";
    return {
      title: `${item.label} failed`,
      why: `Last run ${adminWhen(item.at, now)}.${reason}${retry}`,
      action: "Retry",
    };
  }
  if (item.kind === "cache") {
    const label = adminCacheLabel({ kind: item.cache_kind, season: item.season, week: item.week });
    return {
      title: item.status === "missing" ? `${label} is missing` : `${label} failed to build`,
      why: "Pages that need it run the model live, which is slow, until it rebuilds.",
      action: "Rebuild",
    };
  }
  if (item.kind === "disk") {
    return {
      title: `Disk is ${Math.round(item.percent)}% full`,
      why: "Clear old artifacts or logs on the server before builds start failing.",
      action: null,
    };
  }
  if (item.kind === "errors") {
    const n = Number(item.count || 0);
    return {
      title: `${n} server ${n === 1 ? "error" : "errors"} in the last hour`,
      why: "See Recent server errors on the Server tab for the routes.",
      action: "Open Server",
    };
  }
  return null;
}

export function adminAttentionSummary(items, now = new Date()) {
  const titles = (items || []).map((item) => adminAttentionCopy(item, now)?.title).filter(Boolean);
  if (!titles.length) return ADMIN_OPS_COPY.overview.calmSupport;
  const [first, ...rest] = titles;
  const lead = first.charAt(0).toUpperCase() + first.slice(1);
  if (!rest.length) return `${lead}.`;
  if (rest.length === 1) return `${lead}, and ${rest[0].charAt(0).toLowerCase()}${rest[0].slice(1)}.`;
  return `${lead}, plus ${rest.length} more.`;
}

const MINUTE_STEPS = [2, 5, 8, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 720, 1440];

/** Preset minute options within a setting's bounds, always including the saved value. */
export function adminMinuteOptions(spec, current) {
  const min = Number(spec?.min ?? 1);
  const max = Number(spec?.max ?? 1440);
  const values = new Set(MINUTE_STEPS.filter((n) => n >= min && n <= max));
  if (Number.isFinite(Number(current))) values.add(Number(current));
  return [...values].sort((a, b) => a - b).map((n) => ({
    id: String(n),
    label: n >= 60 && n % 60 === 0 ? `Every ${n / 60 === 1 ? "hour" : `${n / 60} hours`}` : ADMIN_OPS_COPY.settings.minutes(n),
  }));
}

export function adminRetryOptions(spec) {
  return (spec?.choices || [0, 5, 15, 30, 60]).map((n) => ({
    id: String(n),
    label: n ? ADMIN_OPS_COPY.settings.retryAfter(n) : ADMIN_OPS_COPY.settings.retryOff,
  }));
}

export function adminSignInMethod(row) {
  if (row?.google && row?.password) return ADMIN_OPS_COPY.sessions.both;
  if (row?.google) return ADMIN_OPS_COPY.sessions.google;
  return ADMIN_OPS_COPY.sessions.password;
}
