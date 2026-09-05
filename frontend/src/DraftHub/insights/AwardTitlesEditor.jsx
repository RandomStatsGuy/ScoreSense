import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../auth";
import { parseApiError } from "../../format";
import { awardCatalogFromRules, INSIGHTS_COPY } from "./insightsPresentation";

export default function AwardTitlesEditor({
  catalog,
  currentRules,
  onSaved,
}) {
  const rows = useMemo(
    () => (catalog?.length ? catalog : awardCatalogFromRules(currentRules)),
    [catalog, currentRules],
  );
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const draftKey = rows.map((row) => `${row.id}:${row.title || row.default_title || ""}`).join("|");

  useEffect(() => {
    setDraft(Object.fromEntries(
      rows.map((row) => [row.id, row.title || row.default_title || ""]),
    ));
  }, [draftKey]); // eslint-disable-line react-hooks/exhaustive-deps -- draftKey is the catalog fingerprint

  const spend = rows.filter((row) => row.group === "spend");
  const scoring = rows.filter((row) => row.group === "scoring");
  const copy = INSIGHTS_COPY.awards;

  const save = async () => {
    setSaving(true);
    setStatus("");
    try {
      const insight_award_titles = {};
      rows.forEach((row) => {
        const next = String(draft[row.id] || "").trim();
        if (next && next !== row.default_title) insight_award_titles[row.id] = next;
      });
      const res = await apiFetch("/api/hub/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rules: { ...(currentRules || {}), insight_award_titles },
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      onSaved?.(data);
      setStatus(copy.saved);
    } catch (error) {
      setStatus(error.message || copy.failed);
    } finally {
      setSaving(false);
    }
  };

  if (!rows.length) return null;

  return (
    <section className="hub-office-award-names" aria-label={copy.heading}>
      <header className="hub-section-head">
        <h3 className="hub-section-title">{copy.heading}</h3>
        <p className="hub-section-hint">{copy.support}</p>
      </header>
      <div className="hub-insights-award-editor">
        <p className="hub-section-hint">{copy.restore}</p>
        <div className="hub-insights-award-editor-grid">
          <fieldset>
            <legend>{copy.spend}</legend>
            {spend.map((row) => (
              <label key={row.id}>
                <span>{row.default_title}</span>
                <input
                  type="text"
                  maxLength={48}
                  value={draft[row.id] ?? ""}
                  onChange={(event) => setDraft((prev) => ({ ...prev, [row.id]: event.target.value }))}
                />
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>{copy.scoring}</legend>
            {scoring.map((row) => (
              <label key={row.id}>
                <span>{row.default_title}</span>
                <input
                  type="text"
                  maxLength={48}
                  value={draft[row.id] ?? ""}
                  onChange={(event) => setDraft((prev) => ({ ...prev, [row.id]: event.target.value }))}
                />
              </label>
            ))}
          </fieldset>
        </div>
        <div className="hub-insights-award-editor-actions">
          <button type="button" className="btn-primary btn-sm" disabled={saving} onClick={save}>
            {saving ? copy.saving : copy.save}
          </button>
          {status ? <span className="chart-note">{status}</span> : null}
        </div>
      </div>
    </section>
  );
}
