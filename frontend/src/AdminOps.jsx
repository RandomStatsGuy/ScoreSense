import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "./auth";
import { parseApiError } from "./format";
import { HubFilterMenu } from "./DraftHub/HubUILayout";
import {
  ADMIN_ENV_LABELS,
  ADMIN_OPS_COPY,
  ADMIN_SCHEDULE_TIMES,
  ADMIN_SETTING_COPY,
  ADMIN_WEEKDAYS,
  adminAgo,
  adminAttentionCopy,
  adminAttentionSummary,
  adminBytes,
  adminCacheLabel,
  adminCacheStatus,
  adminDuration,
  adminEnvValue,
  adminMinuteOptions,
  adminOverviewHeading,
  adminRetryOptions,
  adminRunOutcome,
  adminScheduleLabel,
  adminSignInMethod,
  adminUptime,
  adminWhen,
} from "./adminPresentation";

const C = ADMIN_OPS_COPY;

function useAdminFetch(path, refreshKey, { pollMs = 0 } = {}) {
  const [state, setState] = useState({ data: null, error: "", loading: true });
  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const res = await apiFetch(path);
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setState({ data, error: "", loading: false });
    } catch (err) {
      setState((prev) => ({ ...prev, error: err.message || C.loadFailed, loading: false }));
    }
  }, [path]);
  useEffect(() => {
    load();
  }, [load, refreshKey]);
  useEffect(() => {
    if (!pollMs) return undefined;
    const timer = window.setInterval(load, pollMs);
    return () => window.clearInterval(timer);
  }, [load, pollMs]);
  return { ...state, reload: load };
}

async function postJson(path, body, method = "POST") {
  const res = await apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await parseApiError(res));
  return res.json();
}

function Dot({ tone }) {
  return <span className={`admin-dot${tone ? ` is-${tone}` : ""}`} aria-hidden="true" />;
}

function PaneTitle({ title, support, children }) {
  return (
    <div className="admin-pane-title">
      <div className="admin-pane-title-text">
        <h2>{title}</h2>
        {support ? <p>{support}</p> : null}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, tone, value, detail }) {
  return (
    <div className="admin-ops-stat">
      <span className="admin-ops-stat-label">
        {tone !== undefined ? <Dot tone={tone} /> : null}
        {label}
      </span>
      <span className="admin-ops-stat-value">{value}</span>
      {detail ? <span className="admin-ops-stat-detail">{detail}</span> : null}
    </div>
  );
}

function Card({ title, note, action, children, className = "" }) {
  return (
    <section className={`admin-panel panel admin-card ${className}`}>
      {title || action ? (
        <div className="admin-card-head">
          {title ? <h3 className="admin-section-title">{title}</h3> : null}
          {note ? <span className="admin-card-note">{note}</span> : null}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function KeyValues({ rows }) {
  return (
    <dl className="admin-kv">
      {rows.filter(Boolean).map(([key, value]) => (
        <div className="admin-kv-row" key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Meter({ label, percent, value, tone }) {
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  return (
    <div className="admin-meter-row">
      <span className="admin-meter-label">{label}</span>
      <span className={`admin-meter${tone ? ` is-${tone}` : ""}`} role="img" aria-label={`${label} ${Math.round(pct)}%`}>
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="admin-meter-value">{value}</span>
    </div>
  );
}

function LoadState({ error, loading, data }) {
  if (error && !data) return <div role="alert" className="error admin-notice">{error}</div>;
  if (loading && !data) return <p className="admin-muted admin-pane-loading">Loading…</p>;
  return null;
}

function percentTone(pct, warn = 80, bad = 92) {
  if (pct == null) return "";
  if (pct >= bad) return "bad";
  if (pct >= warn) return "warn";
  return "ok";
}

// --- Overview -----------------------------------------------------------------

export function AdminOverviewPane({ refreshKey, legacy, notify, onTab }) {
  const { data, error, loading, reload } = useAdminFetch("/api/admin/ops/overview", refreshKey);
  const [busy, setBusy] = useState("");
  const now = new Date();

  if (!data) return <LoadState error={error} loading={loading} data={data} />;

  const attention = data.attention || [];
  const res = data.resources;
  const mem = res?.memory;
  const disk = res?.disk;
  const next = (data.upcoming || [])[0];
  const errorsItem = attention.find((item) => item.kind === "errors");
  let primaryUsed = false;

  const act = async (item) => {
    setBusy(item.id);
    try {
      if (item.kind === "job") {
        await postJson(`/api/admin/ops/jobs/${item.id}/run`);
        notify(C.jobs.started(item.label));
      } else if (item.kind === "cache") {
        await postJson("/api/admin/ops/caches/rebuild", {
          kind: item.cache_kind,
          season: item.season,
          week: item.week || 1,
        });
        notify(C.server.rebuildStarted);
      } else if (item.kind === "errors") {
        onTab("server");
        return;
      }
      await reload();
    } catch (err) {
      notify(err.message, true);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="admin-pane">
      <PaneTitle title={adminOverviewHeading(attention.length)} support={adminAttentionSummary(attention, now)} />
      <div className="admin-ops-stat-grid">
        <Stat
          label={C.overview.api}
          tone={errorsItem ? "warn" : "ok"}
          value={errorsItem ? `${errorsItem.count} errors` : "Healthy"}
          detail={`Up ${adminUptime(res?.process?.started_at, now)} · ${Number(data.api?.requests || 0).toLocaleString()} requests`}
        />
        <Stat
          label={C.overview.server}
          tone={percentTone(Math.max(mem?.percent || 0, disk?.percent || 0), 85, 95)}
          value={res ? `${Math.round(res.cpu_percent)}% CPU` : "—"}
          detail={res ? `Memory ${adminBytes(mem?.used)} of ${adminBytes(mem?.total)} · disk ${Math.round(disk?.percent || 0)}%` : ""}
        />
        <Stat
          label={C.overview.jobs}
          tone={data.jobs?.failed ? "bad" : data.jobs?.running ? "warn" : "ok"}
          value={data.jobs?.failed ? `${data.jobs.failed} failed` : data.jobs?.running ? `${data.jobs.running} running` : "All OK"}
          detail={next ? `Next: ${next.label} ${adminWhen(next.at, now)}` : C.overview.nothingScheduled}
        />
        <Stat
          label={C.overview.activeNow}
          tone="ok"
          value={data.sessions?.active_15m ?? 0}
          detail={`${data.sessions?.active_24h ?? 0} accounts in the last 24 hours`}
        />
      </div>

      <div className="admin-cols">
        <div className="admin-stack">
          {attention.length ? (
            <Card title={C.overview.attention}>
              <ul className="admin-list">
                {attention.map((item) => {
                  const copy = adminAttentionCopy(item, now);
                  const primary = Boolean(copy.action) && !primaryUsed && item.kind !== "errors";
                  if (primary) primaryUsed = true;
                  return (
                    <li key={`${item.kind}:${item.id}`}>
                      <Dot tone={item.kind === "errors" || item.kind === "disk" ? "warn" : "bad"} />
                      <span className="admin-list-main">
                        <span className="admin-list-what">{copy.title}</span>
                        <span className="admin-list-why">{copy.why}</span>
                      </span>
                      {copy.action ? (
                        <button
                          type="button"
                          className={`${primary ? "btn-primary" : "btn-ghost"} btn-sm`}
                          disabled={busy === item.id}
                          onClick={() => act(item)}
                        >
                          {busy === item.id ? C.jobs.running : copy.action}
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}
          <Card
            title={C.overview.comingUp}
            action={<button type="button" className="btn-ghost btn-sm" onClick={() => onTab("jobs")}>{C.overview.allJobs}</button>}
          >
            {data.upcoming?.length ? (
              <table className="data-table hub-table admin-ops-table">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th className="num">Next run</th>
                  </tr>
                </thead>
                <tbody>
                  {data.upcoming.map((row) => (
                    <tr key={row.id}>
                      <td>{row.retry ? `${row.label} · retry` : row.label}</td>
                      <td className="num">{adminWhen(row.at, now)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="admin-muted">{C.overview.nothingScheduled}</p>
            )}
          </Card>
        </div>
        <aside className="admin-stack">
          <Card title={C.overview.deploy}>
            <KeyValues
              rows={[
                ["Commit", data.deploy?.commit ? <code>{data.deploy.commit}</code> : "Not recorded"],
                data.deploy?.deployed_at ? ["Deployed", adminWhen(data.deploy.deployed_at, now)] : null,
                ["API started", adminWhen(res?.process?.started_at, now)],
              ]}
            />
          </Card>
          {legacy ? (
            <Card title="Accounts and leagues">
              <KeyValues
                rows={[
                  ["Registered accounts", legacy.native_user_count],
                  ["Live leagues", legacy.live_league_count ?? "—"],
                  ["Test leagues", legacy.test_league_count],
                  ["Mock-draft bots", legacy.bot_sub_count ?? "—"],
                ]}
              />
            </Card>
          ) : null}
          <Card
            title={C.overview.activity}
            action={<button type="button" className="btn-ghost btn-sm" onClick={() => onTab("activity")}>{C.overview.allActivity}</button>}
          >
            {data.activity?.length ? (
              <ul className="admin-list admin-list--compact">
                {data.activity.map((row) => (
                  <li key={row.id}>
                    <span className="admin-list-main">{row.summary}</span>
                    <span className="admin-list-when">{adminWhen(row.at, now)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="admin-muted">{C.overview.noActivity}</p>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}

// --- Server -------------------------------------------------------------------

export function AdminServerPane({ refreshKey, notify }) {
  const { data, error, loading, reload } = useAdminFetch("/api/admin/ops/server", refreshKey);
  const [busy, setBusy] = useState("");
  const now = new Date();
  if (!data) return <LoadState error={error} loading={loading} data={data} />;
  const res = data.resources;
  const requests = data.requests || {};

  const rebuild = async (row) => {
    setBusy(row.key);
    try {
      await postJson("/api/admin/ops/caches/rebuild", { kind: row.kind, season: row.season, week: row.week || 1 });
      notify(C.server.rebuildStarted);
      await reload();
    } catch (err) {
      notify(err.message, true);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="admin-pane">
      <PaneTitle title={C.server.title} support={C.server.support} />
      <div className="admin-two">
        <Card title={C.server.resources} note={res ? `${res.cpu_count} CPU · ${adminBytes(res.memory?.total)}` : null}>
          {res ? (
            <div>
              <Meter label="CPU" percent={res.cpu_percent} value={`${Math.round(res.cpu_percent)}%`} tone={percentTone(res.cpu_percent)} />
              <Meter
                label="Memory"
                percent={res.memory?.percent}
                value={`${adminBytes(res.memory?.used)} / ${adminBytes(res.memory?.total)}`}
                tone={percentTone(res.memory?.percent, 85, 95)}
              />
              {res.disk ? (
                <Meter
                  label="Disk"
                  percent={res.disk.percent}
                  value={`${adminBytes(res.disk.used)} / ${adminBytes(res.disk.total)}`}
                  tone={percentTone(res.disk.percent, 85, 95)}
                />
              ) : null}
              {res.load_average ? (
                <Meter
                  label="Load"
                  percent={(res.load_average[0] / Math.max(1, res.cpu_count)) * 100}
                  value={res.load_average.join(" · ")}
                  tone={percentTone((res.load_average[0] / Math.max(1, res.cpu_count)) * 100)}
                />
              ) : null}
            </div>
          ) : (
            <p className="admin-muted">Resource numbers are unavailable on this host.</p>
          )}
        </Card>
        <Card title={C.server.process}>
          <KeyValues
            rows={[
              ["Uptime", adminUptime(res?.process?.started_at, now)],
              ["Commit", data.deploy?.commit ? <span><code>{data.deploy.commit}</code>{data.deploy.branch ? ` · ${data.deploy.branch}` : ""}</span> : "Not recorded"],
              ["Python", data.runtime?.python],
              ["API memory", adminBytes(res?.process?.rss)],
              ...(data.storage || []).map((row) => [row.label, adminBytes(row.bytes)]),
            ]}
          />
        </Card>
      </div>
      <Card title={C.server.caches} note={C.server.cachesNote}>
        <div className="admin-table-wrap">
          <table className="data-table hub-table admin-ops-table">
            <thead>
              <tr>
                <th>Cache</th>
                <th className="admin-col-secondary">Built</th>
                <th>Status</th>
                <th className="actions">Action</th>
              </tr>
            </thead>
            <tbody>
              {(data.caches || []).map((row) => {
                const status = adminCacheStatus(row.status);
                return (
                  <tr key={row.key}>
                    <td>
                      {adminCacheLabel(row)}
                      <span className="admin-row-sub admin-phone-only">{adminWhen(row.built_at, now)}</span>
                    </td>
                    <td className="admin-col-secondary">{adminWhen(row.built_at, now)}</td>
                    <td>
                      <span className="admin-status"><Dot tone={status.tone} />{status.label}</span>
                    </td>
                    <td className="actions">
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={busy === row.key || row.status === "running"}
                        onClick={() => rebuild(row)}
                      >
                        {busy === row.key || row.status === "running" ? C.server.rebuilding : C.server.rebuild}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="admin-two">
        <Card title={C.server.slowest} note={C.server.slowestNote}>
          {requests.slowest?.length ? (
            <KeyValues
              rows={requests.slowest.map((row) => [
                <code key="r" className="admin-route" title={row.route}>{row.route}</code>,
                `${row.p95_ms >= 1000 ? `${(row.p95_ms / 1000).toFixed(1)} s` : `${Math.round(row.p95_ms)} ms`} · ${row.count.toLocaleString()}`,
              ])}
            />
          ) : (
            <p className="admin-muted">{C.server.noSlowest}</p>
          )}
        </Card>
        <Card title={C.server.errors} note={C.server.errorsNote}>
          {requests.recent_errors?.length ? (
            <ul className="admin-list">
              {requests.recent_errors.map((row, i) => (
                <li key={`${row.at}-${i}`}>
                  <Dot tone="bad" />
                  <span className="admin-list-main">
                    <span className="admin-list-what"><code>{row.status} {row.route}</code></span>
                    {row.error_type ? <span className="admin-list-why">{row.error_type}</span> : null}
                  </span>
                  <span className="admin-list-when">{adminWhen(row.at, now)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-muted">{C.server.noErrors}</p>
          )}
        </Card>
      </div>
    </div>
  );
}

// --- Jobs ---------------------------------------------------------------------

function ScheduleEditor({ job, onSaved, notify }) {
  const s = job.schedule || {};
  const [form, setForm] = useState({
    enabled: Boolean(s.enabled),
    repeat: s.repeat || "weekly",
    weekday: s.weekday ?? 1,
    at_time: s.at_time || "03:00",
  });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setForm({
      enabled: Boolean(s.enabled),
      repeat: s.repeat || "weekly",
      weekday: s.weekday ?? 1,
      at_time: s.at_time || "03:00",
    });
  }, [job.id, s.enabled, s.repeat, s.weekday, s.at_time]);

  const save = async () => {
    setSaving(true);
    try {
      await postJson(
        `/api/admin/ops/jobs/${job.id}/schedule`,
        { ...form, weekday: form.repeat === "weekly" ? Number(form.weekday) : null },
        "PUT",
      );
      notify(C.jobs.scheduleSaved(job.label));
      await onSaved();
    } catch (err) {
      notify(err.message, true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={C.jobs.schedule}>
      <div className="admin-field-row">
        <HubFilterMenu
          label={C.jobs.repeat}
          value={form.repeat}
          options={[
            { id: "daily", label: "Daily" },
            { id: "weekly", label: "Weekly" },
          ]}
          onChange={(repeat) => setForm((f) => ({ ...f, repeat }))}
        />
        {form.repeat === "weekly" ? (
          <HubFilterMenu
            label={C.jobs.day}
            value={String(form.weekday)}
            options={ADMIN_WEEKDAYS}
            onChange={(weekday) => setForm((f) => ({ ...f, weekday: Number(weekday) }))}
          />
        ) : null}
        <HubFilterMenu
          label={C.jobs.at}
          value={form.at_time}
          options={ADMIN_SCHEDULE_TIMES}
          onChange={(at_time) => setForm((f) => ({ ...f, at_time }))}
        />
      </div>
      <label className="admin-switch">
        <input
          type="checkbox"
          role="switch"
          checked={form.enabled}
          onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
        />
        <span>{form.enabled ? C.jobs.enabled : C.jobs.disabled}</span>
      </label>
      {job.id === "weekly_refresh" ? <p className="admin-card-note admin-caution">{C.jobs.weeklyCron}</p> : null}
      {s.next_run_at ? <p className="admin-card-note">{C.jobs.nextRun(adminWhen(s.next_run_at))}</p> : null}
      <div className="admin-actions">
        <button type="button" className="btn-ghost btn-sm" disabled={saving} onClick={save}>
          {C.jobs.saveSchedule}
        </button>
      </div>
    </Card>
  );
}

export function AdminJobsPane({ refreshKey, notify }) {
  const [poll, setPoll] = useState(0);
  const { data, error, loading, reload } = useAdminFetch("/api/admin/ops/jobs", refreshKey, { pollMs: poll });
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState("");
  const jobs = useMemo(() => data?.jobs || [], [data]);
  const anyRunning = jobs.some((job) => job.running);
  useEffect(() => setPoll(anyRunning ? 15000 : 0), [anyRunning]);
  const selected = jobs.find((job) => job.id === selectedId)
    || jobs.find((job) => job.last_run?.outcome === "failed")
    || jobs[0];
  const now = new Date();

  if (!data) return <LoadState error={error} loading={loading} data={data} />;
  const failed = jobs.filter((job) => job.last_run?.outcome === "failed").length;

  const run = async (job) => {
    setBusy(job.id);
    try {
      await postJson(`/api/admin/ops/jobs/${job.id}/run`);
      notify(C.jobs.started(job.label));
      await reload();
    } catch (err) {
      notify(err.message, true);
    } finally {
      setBusy("");
    }
  };

  const selectedFailed = selected?.last_run?.outcome === "failed";
  const detail = selected?.detail;

  return (
    <div className="admin-pane">
      <PaneTitle title={C.jobs.title} support={C.jobs.support}>
        {failed ? <span className="admin-pill is-bad">{failed} failed</span> : null}
      </PaneTitle>
      <div className="admin-cols">
        <Card>
          <div className="admin-table-wrap">
            <table className="data-table hub-table admin-ops-table admin-jobs-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th className="admin-col-secondary">Schedule</th>
                  <th className="admin-col-secondary">Last run</th>
                  <th className="actions">Run</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const outcome = job.running ? { tone: "warn", label: "Running" } : adminRunOutcome(job.last_run);
                  const when = job.last_run ? adminWhen(job.last_run.finished_at || job.last_run.started_at, now) : "";
                  const lastRun = (
                    <span className="admin-status">
                      <Dot tone={outcome.tone} />
                      {job.running || !job.last_run ? outcome.label : `${outcome.label === "OK" ? "" : `${outcome.label} `}${when}`}
                    </span>
                  );
                  return (
                    <tr
                      key={job.id}
                      className={selected?.id === job.id ? "is-selected" : ""}
                      onClick={() => setSelectedId(job.id)}
                    >
                      <td>
                        <button type="button" className="admin-row-select" onClick={() => setSelectedId(job.id)}>
                          <span className="admin-row-name">{job.label}</span>
                          <span className="admin-row-sub">{job.description}</span>
                          <span className="admin-row-sub admin-phone-only">{lastRun}</span>
                        </button>
                      </td>
                      <td className={`admin-col-secondary${job.schedule?.enabled || job.automatic ? "" : " admin-muted"}`}>{adminScheduleLabel(job)}</td>
                      <td className="admin-col-secondary">{lastRun}</td>
                      <td className="actions">
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={busy === job.id || job.running}
                          onClick={(e) => {
                            e.stopPropagation();
                            run(job);
                          }}
                        >
                          {job.running || busy === job.id ? C.jobs.running : C.jobs.runNow}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        {selected ? (
          <aside className="admin-stack">
            <Card title={selected.label}>
              <p className="admin-card-note">
                {selected.automatic ? C.jobs.automaticNote : selected.description}
              </p>
              {detail?.error ? <pre className="admin-log">{detail.error}</pre> : null}
              {detail?.stage && detail.status === "running" ? (
                <p className="admin-card-note">Stage: {String(detail.stage).replace(/_/g, " ")}</p>
              ) : null}
              {selected.schedule?.retry_due_at ? (
                <p className="admin-card-note">{C.jobs.retryAt(adminWhen(selected.schedule.retry_due_at, now))}</p>
              ) : null}
              <div className="admin-actions">
                <button
                  type="button"
                  className={`${selectedFailed ? "btn-primary" : "btn-ghost"} btn-sm`}
                  disabled={busy === selected.id || selected.running}
                  onClick={() => run(selected)}
                >
                  {selected.running || busy === selected.id ? C.jobs.running : selectedFailed ? C.jobs.retryNow : C.jobs.runNow}
                </button>
              </div>
            </Card>
            {selected.schedulable ? <ScheduleEditor job={selected} onSaved={reload} notify={notify} /> : null}
            <Card title={C.jobs.recentRuns}>
              {selected.recent_runs?.length ? (
                <ul className="admin-list admin-list--compact">
                  {selected.recent_runs.map((runRow, i) => {
                    const outcome = adminRunOutcome(runRow);
                    const reason = runRow.outcome === "failed" ? runRow.error_type || runRow.status : runRow.outcome === "skipped" ? runRow.reason || runRow.status : "";
                    return (
                      <li key={`${runRow.started_at}-${i}`}>
                        <Dot tone={outcome.tone} />
                        <span className="admin-list-main">
                          {adminWhen(runRow.started_at, now)}
                          {reason ? ` · ${String(reason).replace(/_/g, " ")}` : ""}
                        </span>
                        <span className="admin-list-when">{runRow.outcome === "running" ? outcome.label : adminDuration(runRow.seconds)}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="admin-muted">{C.jobs.noRecentRuns}</p>
              )}
            </Card>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

// --- Sessions -----------------------------------------------------------------

export function AdminSessionsPane({ refreshKey, notify }) {
  const { data, error, loading, reload } = useAdminFetch("/api/admin/ops/sessions", refreshKey);
  const [busy, setBusy] = useState("");
  const now = new Date();
  if (!data) return <LoadState error={error} loading={loading} data={data} />;
  const counts = data.counts || {};

  const signOut = async (row) => {
    if (!window.confirm(C.sessions.confirmSignOut(row.email))) return;
    setBusy(row.id);
    try {
      await postJson(`/api/admin/ops/users/${row.id}/sign-out`);
      notify(C.sessions.signedOut(row.email));
      await reload();
    } catch (err) {
      notify(err.message, true);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="admin-pane">
      <PaneTitle title={C.sessions.title} support={C.sessions.support} />
      <div className="admin-ops-stat-grid">
        <Stat label={C.sessions.last15} value={counts.active_15m ?? 0} />
        <Stat label={C.sessions.last24} value={counts.active_24h ?? 0} detail={C.sessions.ofAccounts(data.count ?? 0)} />
        <Stat label={C.sessions.last7} value={counts.active_7d ?? 0} />
        <Stat label={C.sessions.newWeek} value={counts.new_7d ?? 0} />
      </div>
      <Card>
        <div className="admin-table-wrap">
          <table className="data-table hub-table admin-ops-table">
            <thead>
              <tr>
                <th>{C.sessions.account}</th>
                <th className="admin-col-secondary">{C.sessions.signsIn}</th>
                <th className="num admin-col-secondary">{C.sessions.leagues}</th>
                <th className="num admin-col-secondary">{C.sessions.lastSeen}</th>
                <th className="actions">{C.sessions.action}</th>
              </tr>
            </thead>
            <tbody>
              {(data.accounts || []).map((row) => {
                const seen = adminAgo(row.last_seen_at, now) || <span className="admin-muted">{C.sessions.notSeen}</span>;
                return (
                  <tr key={row.id}>
                    <td>
                      <span className="admin-row-name">{row.email}</span>
                      {row.display_name ? <span className="admin-row-sub">{row.display_name}</span> : null}
                      <span className="admin-row-sub admin-phone-only">{C.sessions.lastSeen} · {seen}</span>
                    </td>
                    <td className="admin-col-secondary">{adminSignInMethod(row)}</td>
                    <td className="num admin-col-secondary">{row.leagues ?? "—"}</td>
                    <td className="num admin-col-secondary">{seen}</td>
                    <td className="actions">
                      <button type="button" className="btn-ghost btn-sm" disabled={busy === row.id} onClick={() => signOut(row)}>
                        {busy === row.id ? C.sessions.signingOut : C.sessions.signOut}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!data.accounts?.length ? (
                <tr>
                  <td colSpan={5} className="admin-muted">{C.sessions.empty}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// --- Settings -----------------------------------------------------------------

function SettingRow({ id, children }) {
  const copy = ADMIN_SETTING_COPY[id] || { what: id, why: "" };
  return (
    <div className="admin-setting">
      <span className="admin-setting-text">
        <span className="admin-setting-what" id={`admin-setting-${id}`}>{copy.what}</span>
        {copy.why ? <span className="admin-setting-why">{copy.why}</span> : null}
      </span>
      <span className="admin-setting-control">{children}</span>
    </div>
  );
}

function Toggle({ id, checked, onChange }) {
  return (
    <label className="admin-switch">
      <input
        type="checkbox"
        role="switch"
        aria-labelledby={`admin-setting-${id}`}
        checked={Boolean(checked)}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{checked ? C.settings.on : C.settings.off}</span>
    </label>
  );
}

export function AdminSettingsPane({ refreshKey, notify }) {
  const { data, error, loading, reload } = useAdminFetch("/api/admin/ops/settings", refreshKey);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data?.values) setForm({ ...data.values });
  }, [data]);
  if (!data || !form) return <LoadState error={error} loading={loading} data={data} />;
  const specs = data.specs || {};
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const dirty = Object.keys(form).some((key) => form[key] !== data.values[key]);

  const save = async () => {
    setSaving(true);
    try {
      const changed = Object.fromEntries(Object.entries(form).filter(([key, value]) => value !== data.values[key]));
      const body = await postJson("/api/admin/ops/settings", { values: changed }, "PUT");
      notify(C.settings.saved(body.changed?.length || 0));
      await reload();
    } catch (err) {
      notify(err.message, true);
    } finally {
      setSaving(false);
    }
  };

  const minuteMenu = (key) => (
    <HubFilterMenu
      label=""
      ariaLabel={ADMIN_SETTING_COPY[key]?.what}
      value={String(form[key])}
      options={adminMinuteOptions(specs[key], form[key])}
      onChange={(value) => set(key)(Number(value))}
    />
  );

  return (
    <div className="admin-pane">
      <PaneTitle title={C.settings.title} support={C.settings.support} />
      <div className="admin-cols">
        <Card title={C.settings.site}>
          <div className="admin-settings-list">
            <SettingRow id="signups_open">
              <Toggle id="signups_open" checked={form.signups_open} onChange={set("signups_open")} />
            </SettingRow>
            <SettingRow id="email_verification_required">
              <Toggle id="email_verification_required" checked={form.email_verification_required} onChange={set("email_verification_required")} />
            </SettingRow>
            <SettingRow id="maintenance_banner_on">
              <Toggle id="maintenance_banner_on" checked={form.maintenance_banner_on} onChange={set("maintenance_banner_on")} />
            </SettingRow>
            {form.maintenance_banner_on ? (
              <div className="admin-setting admin-setting--input">
                <input
                  type="text"
                  className="admin-input"
                  maxLength={specs.maintenance_message?.max_len || 200}
                  placeholder={C.settings.messagePlaceholder}
                  aria-label={ADMIN_SETTING_COPY.maintenance_message.what}
                  value={form.maintenance_message || ""}
                  onChange={(e) => set("maintenance_message")(e.target.value)}
                />
              </div>
            ) : null}
            <SettingRow id="injury_poll_reporting_minutes">{minuteMenu("injury_poll_reporting_minutes")}</SettingRow>
            <SettingRow id="injury_poll_inseason_minutes">{minuteMenu("injury_poll_inseason_minutes")}</SettingRow>
            <SettingRow id="injury_poll_offseason_minutes">{minuteMenu("injury_poll_offseason_minutes")}</SettingRow>
            <SettingRow id="job_retry_minutes">
              <HubFilterMenu
                label=""
                ariaLabel={ADMIN_SETTING_COPY.job_retry_minutes.what}
                value={String(form.job_retry_minutes)}
                options={adminRetryOptions(specs.job_retry_minutes)}
                onChange={(value) => set("job_retry_minutes")(Number(value))}
              />
            </SettingRow>
          </div>
          <div className="admin-actions">
            <button type="button" className="btn-primary btn-sm" disabled={saving || !dirty} onClick={save}>
              {saving ? C.settings.saving : C.settings.save}
            </button>
          </div>
        </Card>
        <aside className="admin-stack">
          <Card title={C.settings.environment}>
            <p className="admin-card-note">{C.settings.environmentNote}</p>
            <KeyValues
              rows={(data.environment || []).map((row) => [
                ADMIN_ENV_LABELS[row.key] || row.key,
                <span key="v" className={row.set ? "admin-tone-ok" : "admin-muted"}>{adminEnvValue(row)}</span>,
              ])}
            />
          </Card>
        </aside>
      </div>
    </div>
  );
}

// --- Activity -----------------------------------------------------------------

export function AdminActivityPane({ refreshKey }) {
  const { data, error, loading } = useAdminFetch("/api/admin/ops/activity?limit=200", refreshKey);
  const now = new Date();
  if (!data) return <LoadState error={error} loading={loading} data={data} />;
  return (
    <div className="admin-pane">
      <PaneTitle title={C.activity.title} support={C.activity.support(data.retention_days || 90)} />
      <Card>
        {!data.activity?.length ? (
          <p className="admin-muted">{C.activity.empty}</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="data-table hub-table admin-ops-table">
              <thead>
                <tr>
                  <th>{C.activity.what}</th>
                  <th>{C.activity.who}</th>
                  <th className="num">{C.activity.when}</th>
                </tr>
              </thead>
              <tbody>
                {data.activity.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <span className="admin-row-name">
                        {row.kind === "job_failed" ? <Dot tone="bad" /> : null}
                        {row.summary}
                      </span>
                      {row.detail ? <span className="admin-row-sub">{row.detail}</span> : null}
                    </td>
                    <td>{row.actor}</td>
                    <td className="num">{adminWhen(row.at, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
