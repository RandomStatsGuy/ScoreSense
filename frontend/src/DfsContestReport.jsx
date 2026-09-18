import React, { useMemo, useState } from "react";
import { DfsField, DfsFile } from "./DfsWorkspace";
import { DFS_RESULTS_COPY } from "./dfsToolPresentation";
import { readResultsFile } from "./dfsResultsFile.js";
import { draftKingsUsername, dollars, inspectResultsCsv } from "./dfsResults.js";
import { contestSummary, parsePrizeStructure } from "./dfsContest.js";

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

/**
 * Read one DraftKings contest-standings export and describe it, either as a
 * review of the viewer's own entries or as a post-mortem of the whole field.
 * Nothing here is saved — it reads the file and reports.
 */
export default function DfsContestReport() {
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [prizeText, setPrizeText] = useState("");
  const [view, setView] = useState("mine");

  const pick = async (picked) => {
    if (!picked) return;
    setError("");
    try {
      const { text, filename } = await readResultsFile(picked);
      const inspected = inspectResultsCsv(text, { filename });
      if (!inspected.isStandings) throw new Error(C.notStandings);
      setFile({ ...inspected, name: picked.name });
    } catch (err) {
      setFile(null);
      setError(err.message || "Could not read that file.");
    }
  };

  const summary = useMemo(() => {
    if (!file) return null;
    const entries = entriesFromFile(file);
    const wanted = draftKingsUsername(username);
    const mine = wanted
      ? entries
          .filter((e) => draftKingsUsername(e.entry_name) === wanted)
          .map((e) => e.entry_id)
      : [];
    return contestSummary({
      entries,
      players: file.players,
      mine,
      tiers: parsePrizeStructure(prizeText),
    });
  }, [file, username, prizeText]);

  const hasPrizes = parsePrizeStructure(prizeText).length > 0;

  return (
    <section className="dfw-panel">
      <div className="dfw-panel-head">
        <h2>{C.title}</h2>
        {file && <button onClick={() => setFile(null)}>{C.clear}</button>}
      </div>
      <p className="dfw-note">{C.help}</p>
      {!file && <DfsFile label={C.pick} accept=".csv,.zip,text/csv" onFile={pick} />}
      {error && <p className="dfw-note dfw-error" role="alert">{error}</p>}

      {file && summary && (
        <>
          <p className="dfw-note">
            {file.name} · {summary.field.entries.toLocaleString()} {C.entries.toLowerCase()}
          </p>
          <div className="dfw-import-grid">
            <DfsField label={C.username}>
              <input
                value={username}
                placeholder={C.usernamePlaceholder}
                onChange={(e) => setUsername(e.target.value)}
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
          <p className="dfw-note">{C.prizesHelp}</p>

          <dl className="dfs-contest-stats">
            <div><dt>{C.entries}</dt><dd>{summary.field.entries.toLocaleString()}</dd></div>
            <div><dt>{C.unique}</dt><dd>{summary.field.unique_lineups.toLocaleString()}</dd></div>
            <div>
              <dt>{C.scoreRange}</dt>
              <dd>{summary.field.score_min} – {summary.field.score_max}</dd>
            </div>
            <div><dt>{C.scoreMedian}</dt><dd>{summary.field.score_median}</dd></div>
            <div>
              <dt>{C.paid}</dt>
              <dd>{summary.field.paid_entries == null ? C.noPrizes : summary.field.paid_entries.toLocaleString()}</dd>
            </div>
          </dl>

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
          {!hasPrizes && <p className="dfw-note">{C.noPrizes}</p>}
        </>
      )}
    </section>
  );
}
