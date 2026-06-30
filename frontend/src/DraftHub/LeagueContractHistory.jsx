import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import MobilePlayerCard from "../MobilePlayerCard";
import MobileBottomSheet from "../layout/MobileBottomSheet";
import OwnerSeasonMapPanel from "./OwnerSeasonMapPanel";
import { HubPage } from "./HubUILayout";

const ROSTER_STATUSES = ["active", "cut", "ir", "taxi"];
const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];
const CONTRACT_PHASES = ["", "initial", "extension", "extended", "waiver_rental", "post_2024_base"];
const ACQUISITION_TYPES = ["", "draft", "waiver", "unknown"];

function fmtSal(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `$${Number(v).toFixed(0)}`;
}

function rowFormState(row) {
  return {
    owner_label: row.owner_label || "",
    hub_team_name: row.hub_team_name || "",
    player_name: row.player_name || "",
    position: row.position || "",
    cap_hit: row.cap_hit != null ? String(row.cap_hit) : "",
    prior_salary: row.prior_salary != null ? String(row.prior_salary) : "",
    original_draft_year: row.original_draft_year != null ? String(row.original_draft_year) : "",
    roster_status: row.roster_status || "active",
    contract_phase: row.contract_phase || "",
    acquisition_type: row.acquisition_type || "",
    status_note: row.status_note || "",
    needs_review: Boolean(row.needs_review),
    review_reason: row.review_reason || "",
  };
}

function emptyRowFormState(seasonYear) {
  return rowFormState({
    season_year: seasonYear,
    roster_status: "active",
  });
}

function ContractRowEditor({ row, leagueId, seasonYear, isNew, onSaved, onDeleted, onCancel, mobileLayout = false }) {
  const [form, setForm] = useState(() => (isNew ? emptyRowFormState(seasonYear) : rowFormState(row)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const buildBody = () => {
    const cap = form.cap_hit.trim() === "" ? null : Number(form.cap_hit);
    const prior = form.prior_salary.trim() === "" ? null : Number(form.prior_salary);
    const draftYear = form.original_draft_year.trim() === "" ? null : Number(form.original_draft_year);
    return {
      owner_label: form.owner_label.trim(),
      hub_team_name: form.hub_team_name.trim() || null,
      player_name: form.player_name.trim(),
      position: form.position.trim().toUpperCase() || null,
      cap_hit: Number.isFinite(cap) ? cap : null,
      base_salary: Number.isFinite(cap) ? cap : null,
      prior_salary: Number.isFinite(prior) ? prior : null,
      original_draft_year: Number.isFinite(draftYear) ? draftYear : null,
      roster_status: form.roster_status,
      contract_phase: form.contract_phase || null,
      acquisition_type: form.acquisition_type || null,
      status_note: form.status_note.trim() || null,
      needs_review: form.needs_review,
      review_reason: form.review_reason.trim() || null,
    };
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const body = buildBody();
      if (isNew) {
        if (!seasonYear || !body.owner_label || !body.player_name || body.cap_hit == null) {
          throw new Error("Season, owner, player, and cap are required");
        }
        const res = await apiFetch(`/api/hub/league/${leagueId}/contract-history`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ season_year: Number(seasonYear), ...body }),
        });
        if (!res.ok) throw new Error(await parseApiError(res));
        onSaved(await res.json(), { isNew: true });
        return;
      }
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
    if (isNew) {
      onCancel();
      return;
    }
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
    <div className={`hub-contract-edit${mobileLayout ? " hub-contract-edit--mobile" : ""}`}>
      <div className="hub-contract-edit-grid">
        <label>
          <span className="hub-filter-label">Owner</span>
          <input
            className="search-input"
            value={form.owner_label}
            onChange={(e) => setForm((f) => ({ ...f, owner_label: e.target.value }))}
          />
        </label>
        <label>
          <span className="hub-filter-label">Team</span>
          <input
            className="search-input"
            value={form.hub_team_name}
            onChange={(e) => setForm((f) => ({ ...f, hub_team_name: e.target.value }))}
            placeholder="Hub team name"
          />
        </label>
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
          <span className="hub-filter-label">Prior cap</span>
          <input
            className="search-input"
            inputMode="decimal"
            value={form.prior_salary}
            onChange={(e) => setForm((f) => ({ ...f, prior_salary: e.target.value }))}
          />
        </label>
        <label>
          <span className="hub-filter-label">Draft yr</span>
          <input
            className="search-input"
            inputMode="numeric"
            value={form.original_draft_year}
            onChange={(e) => setForm((f) => ({ ...f, original_draft_year: e.target.value }))}
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
        <label>
          <span className="hub-filter-label">Phase</span>
          <select
            className="search-input"
            value={form.contract_phase}
            onChange={(e) => setForm((f) => ({ ...f, contract_phase: e.target.value }))}
          >
            {CONTRACT_PHASES.map((p) => (
              <option key={p || "none"} value={p}>{p || "—"}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="hub-filter-label">Acquired</span>
          <select
            className="search-input"
            value={form.acquisition_type}
            onChange={(e) => setForm((f) => ({ ...f, acquisition_type: e.target.value }))}
          >
            {ACQUISITION_TYPES.map((a) => (
              <option key={a || "none"} value={a}>{a || "—"}</option>
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
      <label className="hub-contract-edit-note">
        <span className="hub-filter-label">Status note</span>
        <input
          className="search-input"
          value={form.status_note}
          onChange={(e) => setForm((f) => ({ ...f, status_note: e.target.value }))}
          placeholder="e.g. 2 of 2 years"
        />
      </label>
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
          {saving ? "Saving…" : isNew ? "Add row" : "Save"}
        </button>
        <button type="button" className="btn-ghost btn-sm" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        {!isNew && (
          <button type="button" className="btn-ghost btn-sm hub-contract-delete" onClick={remove} disabled={saving}>
            Delete row
          </button>
        )}
      </div>
    </div>
  );
}

function SourceBadge({ sourceKind }) {
  if (!sourceKind || sourceKind === "import") return null;
  return <span className="hub-sleeper-badge">{sourceKind}</span>;
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

  const onRowSaved = (updated, opts = {}) => {
    setData((prev) => {
      if (!prev) return prev;
      const nextRows = opts.isNew
        ? [...prev.rows, updated]
        : prev.rows.map((r) => (r.id === updated.id ? { ...r, ...updated } : r));
      return {
        ...prev,
        rows: nextRows,
        row_count: nextRows.length,
        available: nextRows.length > 0,
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

  const editingRow = useMemo(() => {
    if (!editingId || editingId === "new") return null;
    return (data?.rows || []).find((r) => r.id === editingId) || null;
  }, [data?.rows, editingId]);

  const closeEditor = () => setEditingId(null);
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
        <div className={`hub-insights-scoring-meta${mobileLayout ? " hub-insights-scoring-meta--desktop" : ""}`}>
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
              <button
                type="button"
                className="btn-ghost btn-sm"
                title="Re-import replaces imported rows only; manual edits are kept"
                onClick={runImport}
                disabled={!!busy}
              >
                {busy === "import" ? "Importing…" : "Import sheets"}
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={runReconcile} disabled={!!busy}>
                {busy === "reconcile" ? "Matching…" : "Match Sleeper"}
              </button>
              {season && (
                <button type="button" className="btn-primary btn-sm" onClick={() => setEditingId("new")} disabled={!!busy}>
                  Add row
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {mobileLayout && (
        <div className="hub-contract-mobile-filters hub-filter-bar">
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
            <div className="hub-contract-mobile-actions">
              <button type="button" className="btn-ghost btn-sm" onClick={runImport} disabled={!!busy}>
                {busy === "import" ? "Importing…" : "Import sheets"}
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={runReconcile} disabled={!!busy}>
                {busy === "reconcile" ? "Matching…" : "Match Sleeper"}
              </button>
              {season && (
                <button type="button" className="btn-primary btn-sm" onClick={() => setEditingId("new")}>
                  Add row
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {error && <p className="error-banner">{error}</p>}
      {loading && <p className="chart-note">Loading contract history…</p>}

      <OwnerSeasonMapPanel
        leagueId={leagueId}
        season={season}
        rows={data?.owner_season_map || []}
        isCommissioner={isCommissioner}
        onUpdated={() => load(season)}
      />

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

      {isCommissioner && editingId === "new" && season && !mobileLayout && (
        <div className="panel hub-contract-edit-panel">
          <h4 className="hub-live-section-title">New contract row ({season})</h4>
          <ContractRowEditor
            row={{}}
            leagueId={leagueId}
            seasonYear={season}
            isNew
            onSaved={onRowSaved}
            onDeleted={closeEditor}
            onCancel={closeEditor}
          />
        </div>
      )}

      {mobileLayout && isCommissioner && editingId && season && (
        <MobileBottomSheet
          open
          onClose={closeEditor}
          title={editingId === "new" ? `New row (${season})` : `Edit ${editingRow?.player_name || "contract"}`}
          className="app-mobile-sheet-contract-edit"
        >
          <ContractRowEditor
            row={editingRow || {}}
            leagueId={leagueId}
            seasonYear={season}
            isNew={editingId === "new"}
            mobileLayout
            onSaved={(payload, opts) => {
              onRowSaved(payload, opts);
              closeEditor();
            }}
            onDeleted={onRowDeleted}
            onCancel={closeEditor}
          />
        </MobileBottomSheet>
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
                badge={
                  r.needs_review ? (
                    <span className="hub-sleeper-badge">Review</span>
                  ) : (
                    <SourceBadge sourceKind={r.source_kind} />
                  )
                }
              />
              {isCommissioner && (
                <button type="button" className="btn-ghost btn-sm" onClick={() => setEditingId(r.id)}>
                  Edit
                </button>
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
                <th>Source</th>
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
                    <td>{r.source_kind || "import"}</td>
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
                          seasonYear={season}
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
