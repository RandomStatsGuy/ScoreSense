import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import MobilePlayerCard from "../MobilePlayerCard";
import { HubPage } from "./HubUILayout";

const ROSTER_STATUSES = ["active", "cut", "ir", "taxi"];
const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

function fmtSal(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `$${Number(v).toFixed(0)}`;
}

function rowFormState(row) {
  return {
    player_name: row.player_name || "",
    position: row.position || "",
    cap_hit: row.cap_hit != null ? String(row.cap_hit) : "",
    roster_status: row.roster_status || "active",
    needs_review: Boolean(row.needs_review),
    review_reason: row.review_reason || "",
  };
}

function ContractRowEditor({ row, leagueId, onSaved, onDeleted, onCancel }) {
  const [form, setForm] = useState(() => rowFormState(row));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const cap = form.cap_hit.trim() === "" ? null : Number(form.cap_hit);
      const body = {
        player_name: form.player_name.trim(),
        position: form.position.trim().toUpperCase() || null,
        cap_hit: Number.isFinite(cap) ? cap : null,
        base_salary: Number.isFinite(cap) ? cap : null,
        roster_status: form.roster_status,
        needs_review: form.needs_review,
        review_reason: form.review_reason.trim() || null,
      };
      const res = await apiFetch(`/api/hub/league/${leagueId}/contract-history/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      onSaved(await res.json());
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${row.player_name || "this row"}?`)) return;
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/api/hub/league/${leagueId}/contract-history/${row.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      onDeleted(row.id);
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="hub-contract-edit">
      <div className="hub-contract-edit-grid">
        <label>
          <span className="hub-filter-label">Player</span>
          <input
            className="search-input"
            value={form.player_name}
            onChange={(e) => setForm((f) => ({ ...f, player_name: e.target.value }))}
          />
        </label>
        <label>
          <span className="hub-filter-label">Pos</span>
          <select
            className="search-input"
            value={form.position}
            onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
          >
            <option value="">—</option>
            {POSITIONS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="hub-filter-label">Cap</span>
          <input
            className="search-input"
            inputMode="decimal"
            value={form.cap_hit}
            onChange={(e) => setForm((f) => ({ ...f, cap_hit: e.target.value }))}
          />
        </label>
        <label>
          <span className="hub-filter-label">Status</span>
          <select
            className="search-input"
            value={form.roster_status}
            onChange={(e) => setForm((f) => ({ ...f, roster_status: e.target.value }))}
          >
            {ROSTER_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="hub-contract-edit-check">
          <input
            type="checkbox"
            checked={form.needs_review}
            onChange={(e) => setForm((f) => ({ ...f, needs_review: e.target.checked }))}
          />
          <span>Needs review</span>
        </label>
      </div>
      {form.needs_review && (
        <label className="hub-contract-edit-note">
          <span className="hub-filter-label">Review note</span>
          <input
            className="search-input"
            value={form.review_reason}
            onChange={(e) => setForm((f) => ({ ...f, review_reason: e.target.value }))}
            placeholder="Why this row needs review"
          />
        </label>
      )}
      {error && <p className="error-banner">{error}</p>}
      <div className="hub-contract-edit-actions">
        <button type="button" className="btn-primary btn-sm" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn-ghost btn-sm" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="button" className="btn-ghost btn-sm hub-contract-delete" onClick={remove} disabled={saving}>
          Delete row
        </button>
      </div>
    </div>
  );
}

export default function LeagueContractHistory({ leagueId, hubContext, seasonFilter = "" }) {
  const mobileLayout = useMobileLayout();
  const [data, setData] = useState(null);
  const [season, setSeason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [reviewOnly, setReviewOnly] = useState(false);

  const isCommissioner = Boolean(hubContext?.is_commissioner);

  const load = useCallback(async (seasonOverride) => {
    if (!leagueId) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      const yr = seasonOverride ?? season;
      if (yr) params.set("season", String(yr));
      const q = params.toString() ? `?${params.toString()}` : "";
      const res = await apiFetch(`/api/hub/league/${leagueId}/contract-history${q}`);
      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      setData(payload);
      if (!season && payload.seasons?.length) {
        setSeason(String(payload.season_year || payload.seasons[payload.seasons.length - 1]));
      }
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [leagueId, season]);

  useEffect(() => {
    load();
  }, [leagueId]);

  useEffect(() => {
    if (seasonFilter === "all") {
      setSeason("");
      load("");
      return;
    }
    if (seasonFilter && seasonFilter !== "current") {
      setSeason(String(seasonFilter));
      load(seasonFilter);
    }
  }, [seasonFilter, leagueId]);

  useEffect(() => {
    setEditingId(null);
  }, [season, reviewOnly]);

  const seasonOptions = useMemo(
    () => (data?.seasons || []).slice().sort((a, b) => b - a),
    [data?.seasons],
  );

  const rows = useMemo(() => {
    const all = data?.rows || [];
    return reviewOnly ? all.filter((r) => r.needs_review) : all;
  }, [data?.rows, reviewOnly]);

  const onSeasonChange = (next) => {
    setSeason(next);
    load(next);
  };

  const runImport = async () => {
    setBusy("import");
    setError("");
    try {
      const res = await apiFetch(`/api/hub/league/${leagueId}/contract-history/import`, { method: "POST" });
      if (!res.ok) throw new Error(await parseApiError(res));
      await load(season);
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setBusy("");
    }
  };

  const runReconcile = async () => {
    setBusy("reconcile");
    setError("");
    try {
      const res = await apiFetch(`/api/hub/league/${leagueId}/contract-history/reconcile-sleeper`, { method: "POST" });
      if (!res.ok) throw new Error(await parseApiError(res));
      await load(season);
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setBusy("");
    }
  };

  const onRowSaved = (updated) => {
    setData((prev) => {
      if (!prev) return prev;
      const nextRows = prev.rows.map((r) => (r.id === updated.id ? { ...r, ...updated } : r));
      return {
        ...prev,
        rows: nextRows,
        needs_review_count: nextRows.filter((r) => r.needs_review).length,
      };
    });
    setEditingId(null);
  };

  const onRowDeleted = (rowId) => {
    setData((prev) => {
      if (!prev) return prev;
      const nextRows = prev.rows.filter((r) => r.id !== rowId);
      return {
        ...prev,
        rows: nextRows,
        row_count: nextRows.length,
        needs_review_count: nextRows.filter((r) => r.needs_review).length,
        available: nextRows.length > 0,
      };
    });
    setEditingId(null);
  };

  const movements = data?.movements || [];

  return (
    <HubPage className="hub-contract-history">
      <header className="hub-section-head hub-section-head--row">
        <div>
          <h2 className="hub-tab-intro-title">Contracts</h2>
          <p className="hub-page-meta">
            Imported cap sheets · matched to Sleeper rosters
          </p>
        </div>
        <div className="hub-insights-scoring-meta">
          {seasonOptions.length > 0 && (
            <label className="hub-insights-season-picker">
              <span className="hub-filter-label">Season</span>
              <select
                className="search-input"
                value={season || ""}
                onChange={(e) => onSeasonChange(e.target.value)}
                disabled={loading}
              >
                {seasonOptions.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </label>
          )}
          {data?.needs_review_count > 0 && (
            <label className="hub-contract-filter">
              <input
                type="checkbox"
                checked={reviewOnly}
                onChange={(e) => setReviewOnly(e.target.checked)}
              />
              <span>Review only</span>
            </label>
          )}
          {isCommissioner && (
            <>
              <button type="button" className="btn-ghost btn-sm" onClick={runImport} disabled={!!busy}>
                {busy === "import" ? "Importing…" : "Import sheets"}
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={runReconcile} disabled={!!busy}>
                {busy === "reconcile" ? "Matching…" : "Match Sleeper"}
              </button>
            </>
          )}
        </div>
      </header>

      {error && <p className="error-banner">{error}</p>}
      {loading && <p className="chart-note">Loading contract history…</p>}

      {!loading && data && !data.available && !isCommissioner && (
        <p className="chart-note">
          Contract history has not been imported for this league yet.
        </p>
      )}

      {!loading && !data?.available && isCommissioner && (
        <p className="chart-note">
          No imported history yet. Place files in <code>old_league_files/</code> and tap Import sheets.
        </p>
      )}

      {data?.needs_review_count > 0 && !reviewOnly && (
        <p className="chart-note hub-insights-callout">
          {data.needs_review_count} row(s) need review (ambiguous cut vs trade).
          {isCommissioner ? " Click Edit on a row, fix it, then uncheck Needs review." : ""}
        </p>
      )}

      {rows.length > 0 && mobileLayout && (
        <div className="hub-live-starter-grid">
          {rows.map((r) => (
            <div key={r.id} className="hub-contract-mobile-row">
              <MobilePlayerCard
                name={r.player_name}
                meta={[r.hub_team_name || r.owner_label, r.position, r.roster_status].filter(Boolean).join(" · ")}
                heroValue={fmtSal(r.cap_hit)}
                heroLabel="cap"
                badge={r.needs_review ? <span className="hub-sleeper-badge">Review</span> : null}
              />
              {isCommissioner && editingId !== r.id && (
                <button type="button" className="btn-ghost btn-sm" onClick={() => setEditingId(r.id)}>
                  Edit
                </button>
              )}
              {isCommissioner && editingId === r.id && (
                <ContractRowEditor
                  row={r}
                  leagueId={leagueId}
                  onSaved={onRowSaved}
                  onDeleted={onRowDeleted}
                  onCancel={() => setEditingId(null)}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && !mobileLayout && (
        <div className="table-wrap">
          <table className="data-table compact hub-live-starter-table hub-contract-table">
            <thead>
              <tr>
                <th>Owner</th>
                <th>Team</th>
                <th>Player</th>
                <th>Pos</th>
                <th className="num">Cap</th>
                <th>Status</th>
                <th>Phase</th>
                <th>Conf.</th>
                {isCommissioner && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <React.Fragment key={r.id}>
                  <tr className={r.needs_review ? "hub-cut-row" : ""}>
                    <td>{r.owner_label}</td>
                    <td>{r.hub_team_name || "—"}</td>
                    <td>{r.player_name}</td>
                    <td>{r.position || "—"}</td>
                    <td className="num">{fmtSal(r.cap_hit)}</td>
                    <td>{r.roster_status}</td>
                    <td>{r.contract_phase || "—"}</td>
                    <td>{r.confidence}</td>
                    {isCommissioner && (
                      <td className="hub-contract-actions">
                        {editingId === r.id ? (
                          <button type="button" className="btn-ghost btn-sm" onClick={() => setEditingId(null)}>
                            Close
                          </button>
                        ) : (
                          <button type="button" className="btn-ghost btn-sm" onClick={() => setEditingId(r.id)}>
                            Edit
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                  {isCommissioner && editingId === r.id && (
                    <tr className="hub-contract-edit-row">
                      <td colSpan={9}>
                        <ContractRowEditor
                          row={r}
                          leagueId={leagueId}
                          onSaved={onRowSaved}
                          onDeleted={onRowDeleted}
                          onCancel={() => setEditingId(null)}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && reviewOnly && rows.length === 0 && (
        <p className="chart-note">No rows flagged for review this season.</p>
      )}

      {movements.length > 0 && (
        <section className="hub-live-section">
          <h4 className="hub-live-section-title">Inferred movements ({season})</h4>
          <ul className="hub-insights-timeline">
            {movements.slice(0, 40).map((m) => (
              <li key={m.id}>
                <strong>{m.player_name}</strong>
                {" — "}
                {m.event_type}
                {m.from_owner ? ` from ${m.from_owner}` : ""}
                {m.to_owner ? ` → ${m.to_owner}` : ""}
                {m.salary != null ? ` (${fmtSal(m.salary)})` : ""}
                <span className="table-meta"> · {m.confidence}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </HubPage>
  );
}
