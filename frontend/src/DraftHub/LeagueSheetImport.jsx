import React, { useRef, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";

export default function LeagueSheetImport({ season, onImported, embedded = false, commissionerMode = false }) {
  const fileRef = useRef(null);
  const [managerTeam, setManagerTeam] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

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
        <input ref={fileRef} type="file" accept=".csv" className="hub-file-input" onChange={(e) => importSheet(e.target.files?.[0])} />
        <button type="button" className="btn-primary" disabled={importing} onClick={() => fileRef.current?.click()}>
          {importing ? "Importing…" : "Upload league CSV"}
        </button>
      </div>
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
