import React, { useEffect, useMemo, useState } from "react";
import { DfsField, DfsFile } from "./DfsWorkspace";
import { DFS_RESULTS_COPY } from "./dfsToolPresentation";
import { readResultsFile } from "./dfsResultsFile.js";
import { draftKingsUsername, dollars, inspectResultsCsv } from "./dfsResults.js";
import { contestSummary, parseMoneyCents, parsePrizeStructure } from "./dfsContest.js";
import { contestEntryRows, contestSnapshot, localDateString } from "./dfsContestSave.js";
import { OwnershipScatter, WinnersBoard } from "./DfsContestCharts";
import { jsonRequest } from "./useDfsBuilder";

const C = DFS_RESULTS_COPY.contestReport;

/** Entry rows out of the left-hand table, using the mapping the inspector built. */
function entriesFromFile(file) {
  const at = (row, field) => {
    const i = Number(file.mapping[field]);
    return i >= 0 ? String(row[i] ?? "").trim() : "";
  };
  return file.rows.map((row) => ({
    entry_id: at(row, "entry_id"),
    entry_name: at(row, "entry_name"),
    rank: at(row, "rank"),
    points: at(row, "points"),
    lineup: at(row, "lineup_text"),
  }));
}

function pct(value) {
  return value == null || Number.isNaN(value) ? "—" : `${value.toFixed(1)}%`;
}

function Stat({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * Read one DraftKings contest-standings export and describe it: how the field
 * scored, what it owned against what it produced, what the top of the
 * leaderboard rostered, and where the viewer's own entries landed.
 *
 * Saving does two separate things, because they are read back in two places:
 * the payouts go onto the account's entries, which is what the money cards on
 * Results add up, and the breakdown itself is kept so it reopens without the
 * CSV. Neither happens until asked.
 */
export default function DfsContestReport({ importedFile = null, onSaveEntries = null, knownContest = null }) {
  const [file, setFile] = useState(null);
  const [opened, setOpened] = useState(null);

  // The page above may already have a standings file open. Adopt it so the
  // same file is never imported twice, and keep it after that import clears.
  useEffect(() => {
    if (importedFile?.isStandings) {
      setFile(importedFile);
      setOpened(null);
    }
  }, [importedFile]);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [prizeText, setPrizeText] = useState("");
  const [feeText, setFeeText] = useState("");
  const [dateText, setDateText] = useState("");
  const [view, setView] = useState("mine");
  const [saved, setSaved] = useState([]);

  // Saved contests are a convenience, not a dependency: the panel reads a file
  // and reports whether or not anyone is signed in, so a failure here is quiet.
  useEffect(() => {
    const abort = new AbortController();
    jsonRequest("/api/lineup/contests", { signal: abort.signal })
      .then((data) => setSaved(data.contests || []))
      .catch(() => {});
    return () => abort.abort();
  }, []);

  const pick = async (picked) => {
    if (!picked) return;
    setError("");
    setNote("");
    try {
      const { text, filename } = await readResultsFile(picked);
      const inspected = inspectResultsCsv(text, { filename });
      if (!inspected.isStandings) throw new Error(C.notStandings);
      setOpened(null);
      setFile({ ...inspected, name: picked.name });
    } catch (err) {
      setFile(null);
      setError(err.message || "Could not read that file.");
    }
  };

  const tiers = useMemo(() => parsePrizeStructure(prizeText), [prizeText]);
  const feeCents = parseMoneyCents(feeText);

  const computed = useMemo(() => {
    if (!file) return null;
    const entries = entriesFromFile(file);
    const wanted = draftKingsUsername(username);
    const mine = wanted
      ? entries
          .filter((e) => draftKingsUsername(e.entry_name) === wanted)
          .map((e) => e.entry_id)
      : [];
    return contestSummary({ entries, players: file.players, mine, tiers });
  }, [file, username, tiers]);

  const summary = file ? computed : opened?.summary || null;
  const contestId = file ? file.contestId : opened?.contest_id || "";
  const site = opened?.site || "draftkings";
  // What the ledger already knows about this contest, if it was imported before.
  const known = (contestId && knownContest ? knownContest(site, contestId) : null) || {};
  const contestName = opened?.contest_name || known.contest_name || file?.name || "";

  // A date already on record wins over today's, so re-saving a contest from
  // last week never restamps those entries with the date it was reviewed.
  useEffect(() => {
    if (!file || !contestId) return;
    setDateText(known.date || localDateString());
    // The contest the file describes is what this follows; `known` is derived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, contestId, known.date]);

  // Totals over the viewer's own entries, so the money reads without arithmetic.
  const myTotals = useMemo(() => {
    const rows = summary?.mine || [];
    if (!rows.length) return null;
    const paid = rows.filter((r) => r.payout_cents != null);
    return {
      count: rows.length,
      cents: paid.length ? paid.reduce((sum, r) => sum + r.payout_cents, 0) : null,
      best: Math.min(...rows.map((r) => r.rank)),
    };
  }, [summary]);

  const save = async () => {
    if (!summary || !contestId) return;
    setBusy(true);
    setError("");
    setNote("");
    try {
      const rows = contestEntryRows({
        mine: summary.mine,
        site,
        contestId,
        contestName,
        feeCents,
        date: dateText,
      });
      if (rows.length && onSaveEntries && !(await onSaveEntries(rows))) return;
      const body = contestSnapshot({
        summary, site, contestId, contestName, feeCents, date: dateText, tiers,
      });
      const next = await jsonRequest("/api/lineup/contests", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setSaved(next.contests || []);
      setNote(C.savedTo(rows.length));
    } catch (err) {
      setError(err.message || C.saveNeedsAccount);
    } finally {
      setBusy(false);
    }
  };

  const reopen = async (row) => {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const found = await jsonRequest(
        `/api/lineup/contests?site=${encodeURIComponent(row.site)}&contest_id=${encodeURIComponent(row.contest_id)}`,
      );
      setFile(null);
      setOpened(found);
      setPrizeText("");
      setFeeText("");
      setDateText("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const forget = async (row) => {
    if (!window.confirm(C.forgetConfirm)) return;
    try {
      const next = await jsonRequest("/api/lineup/contests/remove", {
        method: "POST",
        body: JSON.stringify({ site: row.site, contest_id: row.contest_id }),
      });
      setSaved(next.contests || []);
      if (opened?.contest_id === row.contest_id && opened?.site === row.site) setOpened(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const clear = () => {
    setFile(null);
    setOpened(null);
    setNote("");
  };

  return (
    <section className="dfw-panel">
      <div className="dfw-panel-head">
        <h2>{C.title}</h2>
        {(file || opened) && <button onClick={clear}>{opened ? C.backToImport : C.clear}</button>}
      </div>
      <p className="dfw-note">{C.help}</p>
      {!file && !opened && <DfsFile label={C.pick} accept=".csv,.zip,text/csv" onFile={pick} />}
      {error && <p className="dfw-note dfw-error" role="alert">{error}</p>}
      {note && <p className="dfw-note" role="status">{note}</p>}

      {saved.length > 0 && (
        <div className="dfs-saved-contests">
          <h3>{C.savedList}</h3>
          <p className="dfw-note">{C.savedListHelp}</p>
          <ul>
            {saved.map((row) => (
              <li key={`${row.site}|${row.contest_id}`}>
                <span>
                  {row.contest_name || row.contest_id}
                  <small>
                    {row.contest_date ? `${row.contest_date} · ` : ""}
                    {(row.entries ?? 0).toLocaleString()} {C.entries.toLowerCase()}
                    {row.my_entries ? ` · ${row.my_entries} ${DFS_RESULTS_COPY.entry.toLowerCase()}` : ""}
                    {row.my_payout_cents == null ? "" : ` · ${dollars(row.my_payout_cents)}`}
                  </small>
                </span>
                <span className="dfs-saved-actions">
                  <button disabled={busy} onClick={() => reopen(row)}>{C.open}</button>
                  <button disabled={busy} onClick={() => forget(row)}>{C.forget}</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary && (
        <>
          <p className="dfw-note">
            {contestName} · {summary.field.entries.toLocaleString()} {C.entries.toLowerCase()}
          </p>

          {file ? (
            <>
              <div className="dfw-import-grid">
                <DfsField label={C.username}>
                  <input
                    value={username}
                    placeholder={C.usernamePlaceholder}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </DfsField>
                <DfsField label={C.fee}>
                  <input
                    value={feeText}
                    placeholder={C.feePlaceholder}
                    inputMode="decimal"
                    onChange={(e) => setFeeText(e.target.value)}
                  />
                </DfsField>
                <DfsField label={C.date}>
                  <input
                    type="date"
                    value={dateText}
                    onChange={(e) => setDateText(e.target.value)}
                  />
                </DfsField>
                <DfsField label={C.prizes}>
                  <textarea
                    className="dfs-prize-input"
                    rows={4}
                    value={prizeText}
                    placeholder={C.prizesPlaceholder}
                    onChange={(e) => setPrizeText(e.target.value)}
                  />
                </DfsField>
              </div>
              <p className="dfw-note">{C.usernameHelp}</p>
              <p className="dfw-note">{C.feeHelp}</p>
              <p className="dfw-note">{C.dateHelp}</p>
              <p className="dfw-note">{C.prizesHelp}</p>
            </>
          ) : (
            <p className="dfw-note">{C.frozen}</p>
          )}

          <dl className="dfs-contest-stats">
            <Stat label={C.entries} value={summary.field.entries.toLocaleString()} />
            <Stat label={C.unique} value={summary.field.unique_lineups.toLocaleString()} />
            <Stat
              label={C.duplication}
              value={
                summary.field.entries
                  ? pct(
                      ((summary.field.entries - summary.field.unique_lineups) /
                        summary.field.entries) *
                        100,
                    )
                  : "—"
              }
            />
            <Stat
              label={C.scoreRange}
              value={`${summary.field.score_min} – ${summary.field.score_max}`}
            />
            <Stat label={C.scoreMedian} value={summary.field.score_median} />
            <Stat
              label={C.paid}
              value={
                summary.field.paid_entries == null
                  ? "—"
                  : summary.field.paid_entries.toLocaleString()
              }
            />
            {myTotals && (
              <>
                <Stat label={C.yourEntries} value={myTotals.count.toLocaleString()} />
                <Stat
                  label={C.yourPayout}
                  value={myTotals.cents == null ? "—" : dollars(myTotals.cents)}
                />
                <Stat label={C.bestFinish} value={myTotals.best.toLocaleString()} />
              </>
            )}
          </dl>
          {file && !tiers.length && <p className="dfw-note">{C.noPrizes}</p>}

          {file && (
            <div className="dfs-contest-save">
              <button className="btn-primary" disabled={busy || !contestId} onClick={save}>
                {busy ? C.saving : C.save}
              </button>
              <p className="dfw-note">
                {contestId ? C.saveHelp(summary.mine.length) : C.saveNeedsId}
              </p>
            </div>
          )}

          <OwnershipScatter ownership={summary.ownership} />
          <WinnersBoard ownership={summary.ownership} winners={summary.winners} />

          <h3>{C.tablesTitle}</h3>
          <p className="dfw-note">{C.tablesHelp}</p>
          <div role="group" className="dfs-contest-views">
            <button aria-pressed={view === "mine"} onClick={() => setView("mine")}>{C.viewMine}</button>
            <button aria-pressed={view === "field"} onClick={() => setView("field")}>{C.viewField}</button>
          </div>

          {view === "mine" && (
            summary.mine.length === 0 ? (
              <p className="dfw-note">{C.noneMine}</p>
            ) : (
              <table className="data-table hub-table">
                <thead>
                  <tr>
                    <th>{DFS_RESULTS_COPY.entry}</th>
                    <th className="num">{C.rank}</th>
                    <th className="num">{C.points}</th>
                    <th className="num">{C.payout}</th>
                    <th className="num">{C.percentile}</th>
                    <th className="num">{C.duplicates}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.mine.map((row) => (
                    <tr key={row.entry_id}>
                      <td>{row.entry_name || row.entry_id}</td>
                      <td className="num">{row.rank}</td>
                      <td className="num">{row.points}</td>
                      <td className="num">
                        {row.payout_cents == null ? "—" : dollars(row.payout_cents)}
                      </td>
                      <td className="num">{pct(row.percentile)}</td>
                      <td className="num">{row.duplicates}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {view === "field" && (
            <>
              <table className="data-table hub-table">
                <thead>
                  <tr>
                    <th>{C.player}</th>
                    <th>{C.slot}</th>
                    <th className="num">{C.fieldOwn}</th>
                    <th className="num">{C.winnersOwn}</th>
                    <th className="num">{C.mineOwn}</th>
                    <th className="num">{C.leverage}</th>
                    <th className="num">{C.fpts}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...summary.ownership]
                    .sort((a, b) => (b.drafted_pct ?? 0) - (a.drafted_pct ?? 0))
                    .map((row) => (
                      <tr key={`${row.player}-${row.roster_position}`}>
                        <td>{row.player}</td>
                        <td>{row.roster_position}</td>
                        <td className="num">{pct(row.drafted_pct)}</td>
                        <td className="num">{pct(row.winners_pct)}</td>
                        <td className="num">{pct(row.mine_pct)}</td>
                        <td className={`num${row.leverage > 0 ? " positive" : ""}`}>
                          {row.leverage == null ? "—" : `${row.leverage > 0 ? "+" : ""}${row.leverage.toFixed(1)}`}
                        </td>
                        <td className="num">{row.fpts ?? "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <p className="dfw-note">{C.leverageNote}</p>
            </>
          )}
        </>
      )}
    </section>
  );
}
