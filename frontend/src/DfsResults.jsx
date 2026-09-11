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
} from "./dfsResults.js";
import { jsonRequest } from "./useDfsBuilder";
import { importResultsBatches } from "./dfsResultsImport.js";

export default function DfsResults() {
  const worker = useRef(null);
  const previewVersion = useRef(0);
  const [progress, setProgress] = useState("");
  const [entryPage, setEntryPage] = useState(0);
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
          onFile={(f) => {
            setKind("history");
            importFile(f);
          }}
          disabled={busy}
        />
        <DfsFile
          label={C.scores}
          onFile={(f) => {
            setKind("results");
            importFile(f);
          }}
          disabled={busy}
        />
        <small>
          {entries.length} {C.count.toLowerCase()}
        </small>
      </div>
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
          <p className="dfw-note">{C.payoutHelp}</p>
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
                value={contestId}
                onChange={(e) => {
                  setContestId(e.target.value);
                  clearPreview();
                }}
              />
            </DfsField>
          </div>
          <details open>
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
                  options: { site, kind, contestId, settled },
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
              <p className="dfw-note">
                {preview.length} {C.count.toLowerCase()} · {C.fees}:{" "}
                {dollars(previewTotals.fees)} · {C.payouts}:{" "}
                {dollars(previewTotals.payouts)}
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
                        <td>{e.entry_id}</td>
                        <td>{e.contest_name || e.contest_id}</td>
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
      <div className="dfw-metrics">
        {[
          [C.fees, dollars(totals.fees)],
          [C.payouts, dollars(totals.payouts)],
          [C.net, dollars(totals.net)],
          [C.roi, totals.roi == null ? "—" : `${totals.roi.toFixed(1)}%`],
        ].map(([label, value], i) => (
          <div className="dfw-panel" key={label}>
            <small>{label}</small>
            {busy ? (
              <div className="dfw-skeleton" />
            ) : (
              <strong
                className={
                  i > 1
                    ? totals.net >= 0
                      ? "dfw-positive"
                      : "dfw-negative"
                    : ""
                }
              >
                {value}
              </strong>
            )}
          </div>
        ))}
      </div>
      {!entries.length && !busy && <p className="dfw-note">{C.empty}</p>}
      {!!totals.missing && <p className="dfw-error">{C.partial}</p>}
      <div className="dfw-results-grid">
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
          <p className="dfw-note">{C.sample}</p>
        </section>
        <aside className="dfw-panel">
          <h2>{C.coverage}</h2>
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
        </aside>
      </div>
      <section className="dfw-panel">
        <div className="dfw-panel-head">
          <h2>{C.groups}</h2>
          <HubFilterMenu
            label={C.group}
            value={group}
            options={[
              { id: "captain", label: C.captain },
              { id: "contest", label: C.contest },
              { id: "salary", label: C.salary },
              { id: "stack", label: C.stack },
            ]}
            onChange={setGroup}
          />
        </div>
        <div className="dfw-table-scroll">
          <table className="dfw-table">
            <thead>
              <tr>
                <th>{C.group}</th>
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
                  <td>{r.label}</td>
                  <td className="num">{r.count}</td>
                  <td className="num">{dollars(r.fees)}</td>
                  <td className="num">{dollars(r.payouts)}</td>
                  <td className="num">{dollars(r.net)}</td>
                  <td className="num">
                    {r.roi == null ? "—" : `${r.roi.toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="dfw-note">{C.descriptive}</p>
      </section>
      <div className="dfw-results-grid">
        <section className="dfw-panel">
          <h2>{C.review}</h2>
          <div className="dfw-entry-list">
            {entries.slice(entryPage * 50, (entryPage + 1) * 50).map((e) => (
              <button
                key={`${e.site}|${e.contest_id}|${e.entry_id}`}
                aria-pressed={entry === e}
                onClick={() => selectEntry(e)}
              >
                <span>
                  {e.contest_name || e.contest_id}
                  <small>
                    {e.entry_id} · {e.date || "—"}
                  </small>
                </span>
                <span>{dollars(e.payout_cents)}</span>
              </button>
            ))}
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
                      data.builds.find((b) => b.id === buildId)?.lineups || []
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
        </section>
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
    </>
  );
}
