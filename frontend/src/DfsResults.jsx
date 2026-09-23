import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { HubFilterMenu } from "./DraftHub/HubUILayout";
import { DFS_RESULTS_COPY as C } from "./dfsToolPresentation";
import { DfsField, DfsFile } from "./DfsWorkspace";
import {
  RESULT_FIELDS,
  resultTotals,
  resultGroups,
  linkedLineup,
  dollars,
  signedDollars,
} from "./dfsResults.js";
import { jsonRequest } from "./useDfsBuilder";
import { importResultsBatches } from "./dfsResultsImport.js";
import DfsContestReport from "./DfsContestReport";

// The grouped table names the grouping in its first column, rather than
// repeating the word on the control that set it.
const GROUP_LABELS = {
  captain: C.captain,
  contest: C.contest,
  salary: C.salary,
  stack: C.stack,
};

/** Net for one entry, or null when either side of the money is unknown. */
function entryNetCents(entry) {
  return Number.isSafeInteger(entry.fee_cents) &&
    Number.isSafeInteger(entry.payout_cents)
    ? entry.payout_cents - entry.fee_cents
    : null;
}

export default function DfsResults() {
  const worker = useRef(null);
  const breakdowns = useRef(null);
  const previewVersion = useRef(0);
  const [progress, setProgress] = useState("");
  const [entryPage, setEntryPage] = useState(0);
  const [username, setUsername] = useState("");
  useEffect(() => () => worker.current?.terminate(), []);
  const [data, setData] = useState({ entries: [], builds: [] }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true);
  const [file, setFile] = useState(null),
    [mapping, setMapping] = useState({}),
    [preview, setPreview] = useState(null);
  const [kind, setKind] = useState("history"),
    [site, setSite] = useState("draftkings"),
    [contestId, setContestId] = useState(""),
    [settled, setSettled] = useState(true);
  const [filter, setFilter] = useState("all"),
    [group, setGroup] = useState("captain"),
    [selected, setSelected] = useState(""),
    [buildId, setBuildId] = useState(""),
    [lineupIndex, setLineupIndex] = useState(0),
    [note, setNote] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    jsonRequest("/api/lineup/results", { signal: abort.signal })
      .then(setData)
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false);
      });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    if (file?.isStandings)
      breakdowns.current?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
  }, [file]);
  const entries = data.entries.filter(
    (e) => filter === "all" || e.site === filter,
  );
  useEffect(() => setEntryPage(0), [filter, data.entries]);
  const entryPages = Math.max(1, Math.ceil(entries.length / 50));
  const clearPreview = () => {
    previewVersion.current++;
    setPreview(null);
  };
  const workerRequest = (action, payload) =>
    new Promise((resolve, reject) => {
      if (!worker.current)
        worker.current = new Worker(
          new URL("./dfsResults.worker.js", import.meta.url),
          { type: "module" },
        );
      worker.current.onmessage = ({ data: message }) =>
        message.error
          ? reject(new Error(message.error))
          : resolve(message.result);
      worker.current.onerror = () => {
        worker.current?.terminate();
        worker.current = null;
        reject(new Error(C.chooseFile));
      };
      worker.current.postMessage({ action, ...payload });
    });
  const totals = useMemo(() => resultTotals(entries), [data.entries, filter]);
  const groups = useMemo(
    () => resultGroups(entries, data.builds, group),
    [data, filter, group],
  );
  const entry = entries.find(
    (e) => `${e.site}|${e.contest_id}|${e.entry_id}` === selected,
  );
  const built = entry ? linkedLineup(entry, data.builds) : [];
  const saved = entry ? data.builds.find((b) => b.id === entry.build_id) : null;
  const projected = built.length
    ? built.reduce((s, p) => s + Number(p.proj || 0), 0)
    : null;
  const selectEntry = (e) => {
    setSelected(`${e.site}|${e.contest_id}|${e.entry_id}`);
    setBuildId(e.build_id || "");
    setLineupIndex(e.lineup_index || 0);
    setNote(e.note || "");
  };
  const importFile = async (f) => {
    if (!f) return;
    setBusy(true);
    setProgress(C.reading);
    setFile(null);
    clearPreview();
    setError("");
    try {
      const parsed = await workerRequest("inspect", { file: f });
      setFile({ ...parsed, name: f.name });
      setMapping(parsed.mapping);
      setContestId(parsed.contestId || "");
      if (parsed.isStandings) {
        setKind("results");
        setSite("draftkings");
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      setProgress("");
    }
  };
  const updateEntries = async (rows) => {
    setBusy(true);
    setError("");
    try {
      await importResultsBatches(rows, jsonRequest, (saved, total) =>
        setProgress(C.importing(saved, total)),
      );
      setProgress(C.savedImport(rows.length));
      const next = await jsonRequest("/api/lineup/results");
      setData(next);
      return true;
    } catch (e) {
      setError(e.message);
      setProgress("");
      // A previous batch may have committed. Reconcile the displayed ledger.
      try {
        setData(await jsonRequest("/api/lineup/results"));
      } catch {
        /* Keep the import available for an idempotent retry. */
      }
      return false;
    } finally {
      setBusy(false);
    }
  };
  const key = (e) => ({
    site: e.site,
    entry_id: e.entry_id,
    contest_id: e.contest_id,
  });
  const remove = async () => {
    if (!window.confirm(C.removeConfirm)) return;
    try {
      setData(
        await jsonRequest("/api/lineup/results/remove", {
          method: "POST",
          body: JSON.stringify({ entries: [key(entry)] }),
        }),
      );
      setSelected("");
    } catch (e) {
      setError(e.message);
    }
  };
  const previewTotals = preview ? resultTotals(preview) : null;
  return (
    <>
      {error && (
        <div className="dfw-error" role="alert">
          {error}
        </div>
      )}
      {progress && (
        <p className="dfw-note" role="status" aria-live="polite">
          {progress}
        </p>
      )}
      {entries.length > 0 && (
        <section className="dfw-verdict dfw-panel">
          <div className="dfw-verdict-lead">
            <div>
              <small>
                {C.net}
                {totals.contests ? ` · ${C.contestCount(totals.contests)}` : ""}
              </small>
              {busy ? (
                <div className="dfw-skeleton" />
              ) : (
                <strong
                  className={totals.net >= 0 ? "dfw-positive" : "dfw-negative"}
                >
                  {signedDollars(totals.net)}
                </strong>
              )}
            </div>
            <dl className="dfw-verdict-stats">
              <div>
                <dt>{C.roi}</dt>
                <dd>
                  {totals.roi == null ? "—" : `${totals.roi.toFixed(1)}%`}
                </dd>
              </div>
              <div>
                <dt>{C.count}</dt>
                <dd>{entries.length.toLocaleString()}</dd>
              </div>
              <div>
                <dt>{C.inTheMoney}</dt>
                <dd>{totals.paid.toLocaleString()}</dd>
              </div>
              <div>
                <dt>{C.bestFinish}</dt>
                <dd>
                  {totals.best == null ? "—" : totals.best.toLocaleString()}
                </dd>
              </div>
            </dl>
          </div>
          <p className="dfw-note">
            {C.verdictScope(totals.complete, totals.first, totals.last)}{" "}
            {C.sample}
          </p>
          {!!totals.missing && <p className="dfw-error">{C.partial}</p>}
        </section>
      )}
      {!entries.length && !busy && (
        <section className="dfw-panel">
          <h2>{C.emptyTitle}</h2>
          <p className="dfw-note">{C.empty}</p>
          <div className="dfw-slate">
            <DfsFile
              label={C.history}
              accept=".csv,.zip,text/csv,application/zip,application/x-zip-compressed"
              onFile={(f) => {
                setKind("history");
                importFile(f);
              }}
              disabled={busy}
            />
            <DfsFile
              label={C.scores}
              accept=".csv,.zip,text/csv,application/zip,application/x-zip-compressed"
              onFile={(f) => {
                setKind("results");
                importFile(f);
              }}
              disabled={busy}
            />
          </div>
        </section>
      )}
      {entries.length > 0 && (
        <>
          <section className="dfw-panel">
            <div className="dfw-panel-head">
              <h2>{C.chart}</h2>
              <small>{C.cumulative}</small>
            </div>
            <div className="dfw-chart" aria-label={C.chart}>
              {totals.chart.length ? (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart
                    data={totals.chart}
                    margin={{ top: 12, right: 16, left: 0, bottom: 12 }}
                  >
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                      minTickGap={32}
                    />
                    <YAxis
                      width={56}
                      tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
                      tickFormatter={(v) => `$${v}`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--bg-subtle)",
                        borderColor: "var(--border)",
                      }}
                      formatter={(v) => dollars(Number(v) * 100)}
                    />
                    <Legend />
                    <Line
                      name={C.fees}
                      type="linear"
                      dataKey="fees"
                      stroke="var(--text-secondary)"
                      strokeDasharray="5 4"
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      name={C.payouts}
                      type="linear"
                      dataKey="payouts"
                      stroke="var(--accent-muted)"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="dfw-note">{C.noChart}</p>
              )}
            </div>
          </section>
          <section className="dfw-panel">
            <div className="dfw-panel-head">
              <h2>{C.groups}</h2>
              <div
                role="group"
                aria-label={C.group}
                className="dfw-group-pills"
              >
                {[
                  ["captain", C.captain],
                  ["contest", C.contest],
                  ["salary", C.salary],
                  ["stack", C.stack],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    aria-pressed={group === id}
                    onClick={() => setGroup(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="dfw-table-scroll">
              <table className="dfw-table dfw-card-table">
                <thead>
                  <tr>
                    <th>{GROUP_LABELS[group]}</th>
                    <th className="num">{C.count}</th>
                    <th className="num">{C.fees}</th>
                    <th className="num">{C.payouts}</th>
                    <th className="num">{C.net}</th>
                    <th className="num">{C.roi}</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((r) => (
                    <tr key={r.label}>
                      <td data-label={GROUP_LABELS[group]}>{r.label}</td>
                      <td data-label={C.count} className="num">
                        {r.count}
                      </td>
                      <td data-label={C.fees} className="num">
                        {dollars(r.fees)}
                      </td>
                      <td data-label={C.payouts} className="num">
                        {dollars(r.payouts)}
                      </td>
                      <td
                        data-label={C.net}
                        className={`num${r.net >= 0 ? " dfw-positive" : " dfw-negative"}`}
                      >
                        {signedDollars(r.net)}
                      </td>
                      <td data-label={C.roi} className="num">
                        {r.roi == null ? "—" : `${r.roi.toFixed(1)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="dfw-note">{C.descriptive}</p>
          </section>
        </>
      )}
      <div ref={breakdowns}>
        <DfsContestReport
          importedFile={file}
          onSaveEntries={updateEntries}
          knownContest={(forSite, id) =>
            data.entries.find(
              (e) => e.site === forSite && e.contest_id === id,
            ) || null
          }
        />
      </div>
      {entries.length > 0 && (
        <section className="dfw-panel">
          <h2>{C.review}</h2>
          <p className="dfw-note">{C.reviewHelp}</p>
          <div className="dfw-table-scroll">
            <table className="dfw-table dfw-card-table dfw-entry-table">
              <thead>
                <tr>
                  <th>{C.contest}</th>
                  <th>{C.date}</th>
                  <th className="num">{C.rank}</th>
                  <th className="num">{C.points}</th>
                  <th className="num">{C.fee}</th>
                  <th className="num">{C.payout}</th>
                  <th className="num">{C.entryNet}</th>
                </tr>
              </thead>
              <tbody>
                {entries
                  .slice(entryPage * 50, (entryPage + 1) * 50)
                  .map((e) => {
                    const net = entryNetCents(e);
                    const id = `${e.site}|${e.contest_id}|${e.entry_id}`;
                    return (
                      <tr
                        key={id}
                        aria-selected={selected === id}
                        tabIndex={0}
                        onClick={() => selectEntry(e)}
                        onKeyDown={(k) => {
                          if (k.key === "Enter" || k.key === " ") {
                            k.preventDefault();
                            selectEntry(e);
                          }
                        }}
                      >
                        <td data-label={C.contest}>
                          {e.contest_name || e.contest_id}
                        </td>
                        <td data-label={C.date}>{e.date || "—"}</td>
                        <td data-label={C.rank} className="num">
                          {e.rank ?? "—"}
                        </td>
                        <td data-label={C.points} className="num">
                          {e.points ?? "—"}
                        </td>
                        <td data-label={C.fee} className="num">
                          {dollars(e.fee_cents)}
                        </td>
                        <td data-label={C.payout} className="num">
                          {dollars(e.payout_cents)}
                        </td>
                        <td
                          data-label={C.entryNet}
                          className={`num${net == null ? "" : net >= 0 ? " dfw-positive" : " dfw-negative"}`}
                        >
                          {signedDollars(net)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          {entryPages > 1 && (
            <div className="dfw-panel-head">
              <button
                disabled={entryPage === 0}
                onClick={() => setEntryPage((p) => p - 1)}
              >
                {C.previous}
              </button>
              <span>{C.entryPage(entryPage + 1, entryPages)}</span>
              <button
                disabled={entryPage + 1 >= entryPages}
                onClick={() => setEntryPage((p) => p + 1)}
              >
                {C.next}
              </button>
            </div>
          )}
          <div className="dfw-results-grid">
            <div>
              {!entry && <p className="dfw-note">{C.reviewPick}</p>}
              {entry && (
                <>
                  <div className="dfw-review-row">
                    <span>{C.points}</span>
                    <strong>{entry.points ?? "—"}</strong>
                  </div>
                  <div className="dfw-review-row">
                    <span>{C.rank}</span>
                    <strong>{entry.rank ?? "—"}</strong>
                  </div>
                  <div className="dfw-review-row">
                    <span>{C.projection}</span>
                    <strong>{projected?.toFixed(1) ?? "—"}</strong>
                  </div>
                  <div className="dfw-review-row">
                    <span>{C.difference}</span>
                    <strong>
                      {projected != null && entry.points != null
                        ? (entry.points - projected).toFixed(1)
                        : "—"}
                    </strong>
                  </div>
                  <p className="dfw-note">
                    {built.length ? C.compareHelp : C.noSnapshot}
                  </p>
                  <HubFilterMenu
                    label={C.link}
                    value={buildId}
                    options={[
                      { id: "", label: C.none },
                      ...data.builds.map((b) => ({
                        id: b.id,
                        label: `${b.slate_name || b.site} · ${b.saved_at.slice(0, 16)}`,
                      })),
                    ]}
                    onChange={(v) => {
                      setBuildId(v);
                      setLineupIndex(0);
                    }}
                  />
                  {buildId && (
                    <>
                      <HubFilterMenu
                        label={C.lineup}
                        value={lineupIndex}
                        options={(
                          data.builds.find((b) => b.id === buildId)?.lineups ||
                          []
                        ).map((_, i) => ({ id: i, label: String(i + 1) }))}
                        onChange={(v) => setLineupIndex(Number(v))}
                      />
                      <button
                        onClick={() =>
                          updateEntries([
                            {
                              ...key(entry),
                              build_id: buildId,
                              lineup_index: lineupIndex,
                            },
                          ])
                        }
                      >
                        {C.saveLink}
                      </button>
                    </>
                  )}
                  <button onClick={remove}>{C.remove}</button>
                </>
              )}
            </div>
            <aside className="dfw-panel">
              <h2>{C.notes}</h2>
              {entry ? (
                <>
                  <h3>{C.before}</h3>
                  <p className="dfw-note">{saved?.note || C.noSnapshot}</p>
                  <DfsField label={C.after}>
                    <textarea
                      value={note}
                      rows="6"
                      maxLength={4000}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </DfsField>
                  <button
                    disabled={busy}
                    onClick={() => updateEntries([{ ...key(entry), note }])}
                  >
                    {C.saveNote}
                  </button>
                </>
              ) : (
                <p className="dfw-note">{C.journal}</p>
              )}
              <details>
                <summary>
                  {C.saved} · {data.builds.length}
                </summary>
                {data.builds.map((b) => (
                  <p className="dfw-note" key={b.id}>
                    {b.slate_name || b.site} · {b.lineups.length} ·{" "}
                    {b.saved_at.slice(0, 16)}
                  </p>
                ))}
              </details>
            </aside>
          </div>
        </section>
      )}
      <section className="dfw-panel dfw-utility">
        <div className="dfw-panel-head">
          <h2>{C.utility}</h2>
          <small>
            {entries.length} {C.count.toLowerCase()}
          </small>
        </div>
        <div className="dfw-slate">
          <HubFilterMenu
            label={C.site}
            value={filter}
            options={[
              { id: "all", label: C.all },
              { id: "draftkings", label: "DraftKings" },
              { id: "fanduel", label: "FanDuel" },
            ]}
            onChange={setFilter}
          />
          <DfsFile
            label={C.history}
            accept=".csv,.zip,text/csv,application/zip,application/x-zip-compressed"
            onFile={(f) => {
              setKind("history");
              importFile(f);
            }}
            disabled={busy}
          />
          <DfsFile
            label={C.scores}
            accept=".csv,.zip,text/csv,application/zip,application/x-zip-compressed"
            onFile={(f) => {
              setKind("results");
              importFile(f);
            }}
            disabled={busy}
          />
        </div>
        <div className="dfw-coverage">
          <h3>{C.coverage}</h3>
          <div className="dfw-review-row">
            <span>{C.matched}</span>
            <strong>
              {totals.complete} / {entries.length}
            </strong>
          </div>
          <div className="dfw-review-row">
            <span>{C.undated}</span>
            <strong>{totals.undated}</strong>
          </div>
          <div className="dfw-review-row">
            <span>{C.unsettled}</span>
            <strong>{totals.unsettled}</strong>
          </div>
          <div className="dfw-review-row">
            <span>{C.snapshot}</span>
            <strong>
              {
                entries.filter((e) => linkedLineup(e, data.builds).length)
                  .length
              }{" "}
              / {entries.length}
            </strong>
          </div>
        </div>
      </section>
      {file && (
        <section className="dfw-panel">
          <div className="dfw-panel-head">
            <h2>{C.importTitle}</h2>
            <button
              disabled={busy}
              onClick={() => {
                setFile(null);
                clearPreview();
                worker.current?.terminate();
                worker.current = null;
              }}
            >
              {C.cancel}
            </button>
          </div>
          <p className="dfw-note">
            {file.name} · {file.rowCount.toLocaleString()}{" "}
            {C.count.toLowerCase()}
          </p>
          <p className="dfw-note">
            {file.isStandings ? C.standingsHelp : C.payoutHelp}
          </p>
          {file.contestId && (
            <p className="dfw-note">{C.detectedContest(file.contestId)}</p>
          )}
          <div className="dfw-import-grid">
            <HubFilterMenu
              label={C.site}
              value={site}
              options={[
                { id: "draftkings", label: "DraftKings" },
                { id: "fanduel", label: "FanDuel" },
              ]}
              onChange={(v) => {
                setSite(v);
                clearPreview();
              }}
            />
            <HubFilterMenu
              label={C.kind}
              value={kind}
              options={[
                { id: "history", label: C.historyKind },
                { id: "results", label: C.resultsKind },
              ]}
              onChange={(v) => {
                setKind(v);
                clearPreview();
              }}
            />
            <DfsField label={C.contestOverride}>
              <input
                aria-label={C.contestOverride}
                value={contestId}
                onChange={(e) => {
                  setContestId(e.target.value);
                  clearPreview();
                }}
              />
            </DfsField>
            {file.isStandings && (
              <DfsField label={C.username}>
                <input
                  aria-label={C.username}
                  value={username}
                  autoComplete="off"
                  onChange={(e) => {
                    setUsername(e.target.value);
                    clearPreview();
                  }}
                />
              </DfsField>
            )}
          </div>
          <details open={!file.isStandings}>
            <summary>{C.mapping}</summary>
            <div className="dfw-import-grid">
              {RESULT_FIELDS.map(([id, label]) => (
                <HubFilterMenu
                  key={id}
                  label={label}
                  value={mapping[id]}
                  options={[
                    { id: -1, label: C.unmapped },
                    ...file.headers.map((label, i) => ({
                      id: i,
                      label: label || `Column ${i + 1}`,
                    })),
                  ]}
                  onChange={(v) => {
                    setMapping((m) => ({ ...m, [id]: Number(v) }));
                    clearPreview();
                  }}
                />
              ))}
            </div>
          </details>
          {kind === "history" && (
            <label className="dfw-check">
              <input
                type="checkbox"
                checked={settled}
                onChange={(e) => {
                  setSettled(e.target.checked);
                  clearPreview();
                }}
              />
              {C.settled}
            </label>
          )}
          <button
            disabled={busy}
            onClick={async () => {
              const version = previewVersion.current;
              setBusy(true);
              setProgress(C.validating);
              setPreview(null);
              try {
                const rows = await workerRequest("preview", {
                  mapping,
                  options: {
                    site,
                    kind,
                    contestId,
                    settled,
                    username,
                    knownEntries: data.entries.map(
                      ({ site, contest_id, entry_id }) => ({
                        site,
                        contest_id,
                        entry_id,
                      }),
                    ),
                  },
                });
                if (version === previewVersion.current) setPreview(rows);
                setError("");
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
                setProgress("");
              }
            }}
          >
            {C.preview}
          </button>
          {preview && (
            <>
              {file.isStandings && (
                <p className="dfw-note">
                  {C.selectedEntries(preview.length, file.rowCount)}
                </p>
              )}
              <p className="dfw-note">
                {preview.length} {C.count.toLowerCase()} ·{" "}
                {kind === "history" ? (
                  <>
                    {C.fees}: {dollars(previewTotals.fees)} · {C.payouts}:{" "}
                    {dollars(previewTotals.payouts)}
                  </>
                ) : (
                  C.scoresOnly
                )}
              </p>
              <div className="dfw-table-scroll">
                <table className="dfw-table">
                  <thead>
                    <tr>
                      <th>{C.entry}</th>
                      <th>{C.contest}</th>
                      <th className="num">{C.fees}</th>
                      <th className="num">{C.payouts}</th>
                      <th className="num">{C.points}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 8).map((e) => (
                      <tr key={`${e.contest_id}|${e.entry_id}`}>
                        <td>
                          {e.entry_name
                            ? `${e.entry_name} · ${e.entry_id}`
                            : `${C.entry} ${e.entry_id}`}
                        </td>
                        <td>
                          {e.contest_name || `${C.contest} ${e.contest_id}`}
                        </td>
                        <td className="num">{dollars(e.fee_cents)}</td>
                        <td className="num">{dollars(e.payout_cents)}</td>
                        <td className="num">{e.points ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                className="dfw-primary"
                disabled={busy}
                onClick={async () => {
                  if (await updateEntries(preview)) {
                    setFile(null);
                    clearPreview();
                    worker.current?.terminate();
                    worker.current = null;
                  }
                }}
              >
                {C.saveImport}
              </button>
            </>
          )}
        </section>
      )}
    </>
  );
}
