import React, { useEffect, useRef, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import { SHEET_IMPORT_COPY } from "./leagueAccessCopy";

export default function LeagueSheetImport({ season, leagueId, onImported, embedded = false, commissionerMode = false }) {
  const fileRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [managerTeam, setManagerTeam] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => { setSelectedFile(null); setResult(null); setError(""); if (fileRef.current) fileRef.current.value = ""; }, [leagueId, season]);

  const importSheet = async (file) => {
    if (!file) return;
    setImporting(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const q = new URLSearchParams();
      if (managerTeam.trim()) q.set("manager_team_name", managerTeam.trim());
      const res = await apiFetch(`/api/hub/league-sheet/import?${q}`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setResult(data);
      setSelectedFile(null);
      onImported?.();
    } catch (e) {
      setError(e.message || "Import failed");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <section className={`panel hub-panel${embedded ? " hub-panel-embedded" : ""}`}>
      {!embedded && <h2>League sheet import</h2>}
      <p className="chart-note">
        CSV: wide (QB1…) or long (manager, player, salary).
        {commissionerMode && <> Blank team = import all.</>}
      </p>
      {!commissionerMode && (
      <div className="hub-form-row">
        <label>
          <span className="hub-field-label">Filter to my team (optional)</span>
          <input value={managerTeam} onChange={(e) => setManagerTeam(e.target.value)} placeholder="Exact team name from CSV" />
        </label>
      </div>
      )}
      <div className="hub-toolbar">
        <input ref={fileRef} type="file" accept=".csv" className="hub-file-input" onChange={(e) => { setSelectedFile(e.target.files?.[0] || null); setResult(null); setError(""); }} />
        <button type="button" className={selectedFile ? "btn-ghost" : "btn-primary"} disabled={importing} onClick={() => fileRef.current?.click()}>
          {SHEET_IMPORT_COPY.choose}
        </button>
      </div>
      {selectedFile && <div className="hub-sheet-import-confirm" role="region" aria-label={SHEET_IMPORT_COPY.review}>
        <h3>{SHEET_IMPORT_COPY.review}</h3>
        <p>{selectedFile.name} · {season}</p>
        <p className="chart-note">{SHEET_IMPORT_COPY.support} {SHEET_IMPORT_COPY.replaceWarning}</p>
        <div className="hub-toolbar">
          <button type="button" className="btn-ghost" disabled={importing} onClick={() => { setSelectedFile(null); if (fileRef.current) fileRef.current.value = ""; }}>{SHEET_IMPORT_COPY.cancel}</button>
          <button type="button" className="btn-primary" disabled={importing} onClick={() => importSheet(selectedFile)}>{importing ? SHEET_IMPORT_COPY.busy : SHEET_IMPORT_COPY.apply}</button>
        </div>
      </div>}
      {result && (
        <p className="chart-note">
          Imported {result.imported} players · matched {result.stats?.matched ?? result.imported}
          {(result.unmatched?.length ?? 0) > 0 && ` · ${result.unmatched.length} unmatched`}
          {result.by_team && (
            <> · {Object.entries(result.by_team).map(([n, c]) => `${n}: ${c}`).join(", ")}</>
          )}
        </p>
      )}
      {error && <div className="error">{error}</div>}
    </section>
  );
}
