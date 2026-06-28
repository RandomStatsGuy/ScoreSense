import React, { useRef, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";

export default function SalaryRangeImport({ season, onImported, embedded = false }) {
  const fileRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  const importCsv = async (file) => {
    if (!file) return;
    setImporting(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const q = season ? `?season=${season}` : "";
      const res = await apiFetch(`/api/hub/salary-ranges/import${q}`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setStats(data);
      onImported?.();
    } catch (e) {
      setError(e.message || "Import failed");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const generate = async () => {
    setGenerating(true);
    setError("");
    try {
      const q = season ? `?season=${season}` : "";
      const res = await apiFetch(`/api/hub/salary-ranges/generate${q}`, { method: "POST" });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setStats({ generated: data.generated });
      onImported?.();
    } catch (e) {
      setError(e.message || "Generate failed");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section className={`panel hub-panel${embedded ? " hub-panel-embedded" : ""}`}>
      {!embedded && <h2>Salary ranges</h2>}
      <h3 className="hub-panel-subtitle">{embedded ? "Custom salary ranges" : "Salary ranges"}</h3>
      <p className="chart-note">
        Optional custom min/max. Skip for model prices.
      </p>
      <div className="hub-toolbar">
        <input ref={fileRef} type="file" accept=".csv" className="hub-file-input" onChange={(e) => importCsv(e.target.files?.[0])} />
        <button type="button" className="btn-ghost" disabled={importing} onClick={() => fileRef.current?.click()}>
          {importing ? "Importing…" : "Upload CSV"}
        </button>
        <button type="button" className="btn-primary" disabled={generating} onClick={generate}>
          {generating ? "Generating…" : "Use model tiers"}
        </button>
      </div>
      <p className="chart-note hub-field-hint">
        CSV columns: <code>player</code>, <code>min</code>, <code>max</code> (optional: team, position).
      </p>
      {stats && (
        <p className="chart-note">
          {stats.imported != null && `Imported ${stats.imported}. `}
          {stats.generated != null && `Generated ${stats.generated} tiers. `}
          {stats.stats && `Matched ${stats.stats.matched}, unmatched ${stats.stats.unmatched}.`}
        </p>
      )}
      {error && <div className="error">{error}</div>}
    </section>
  );
}
