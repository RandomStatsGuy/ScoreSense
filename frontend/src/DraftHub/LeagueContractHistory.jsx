import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import MobilePlayerCard from "../MobilePlayerCard";
import MobileBottomSheet from "../layout/MobileBottomSheet";
import OwnerSeasonMapPanel from "./OwnerSeasonMapPanel";
import ContractHistoryAuditBar, { patchableIssues } from "./ContractHistoryAuditBar";
import ContractPlayerJourney from "./ContractPlayerJourney";
import ContractOwnerChangesPanel from "./ContractOwnerChangesPanel";
import ContractDataSourcesBanner from "./ContractDataSourcesBanner";
import { invalidateInsightsAfterCapSync } from "./hubDataCache";
import { HubPage } from './HubUILayout';
import { confirmDialog } from "../ui/confirm";
import { fmtSal } from "./rosterFormat";

const ROSTER_STATUSES = ["active", "cut", "ir", "taxi"];
const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];
const CONTRACT_PHASES = ["", "initial", "extension", "extended", "waiver_rental", "post_2024_base"];
const ACQUISITION_TYPES = ["", "draft", "waiver", "post_draft_fa", "trade", "unknown"];

function acqLabel(value) {
  const labels = {
    draft: "Auction",
    waiver: "Waiver",
    post_draft_fa: "FA",
    trade: "Trade",
    unknown: "—",
  };
  return labels[value] || (value ? value : "—");
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
    if (!(await confirmDialog({
      title: "Delete row",
      message: `Delete ${row.player_name || "this row"}?`,
      confirmLabel: "Delete",
      danger: true,
    }))) return;
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

function rowExpectedCap(rowIssues) {
  if (!rowIssues?.length) return null;
  const renewal = rowIssues.find((i) => i.code === "renewal_step_mismatch");
  if (renewal?.expected != null) return Number(renewal.expected);
  const dead = rowIssues.find((i) => i.code === "dead_cap_wrong");
  if (dead?.expected != null) return Number(dead.expected);
  return null;
}

function rowMatchesIssueFilter(row, filter, audit, seasonYear) {
  if (!filter) return true;
  const rowIssues = audit?.row_issues?.[String(row.id)] || [];
  if (filter === "issues") return rowIssues.length > 0;
  if (filter === "rookies") {
    const yr = Number(seasonYear);
    return row.contract_phase === "initial"
      || (row.original_draft_year != null && Number(row.original_draft_year) >= yr - 1);
  }
  if (filter === "waivers") {
    return row.acquisition_type === "waiver"
      || row.contract_phase === "waiver_rental"
      || Number(row.cap_hit) === 1;
  }
  if (filter === "cuts") return row.roster_status === "cut";
  return rowIssues.some((i) => i.category === filter);
}

export default function LeagueContractHistory({ leagueId, hubContext, seasonFilter = "", embedded = false }) {
  const mobileLayout = useMobileLayout();
  const [data, setData] = useState(null);
  const [season, setSeason] = useState("");
  const [loading, setLoading] = useState(Boolean(leagueId));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [audit, setAudit] = useState(null);
  const [issueFilter, setIssueFilter] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [applyingFixes, setApplyingFixes] = useState(false);

  const isCommissioner = Boolean(hubContext?.is_commissioner);
  const hideSeasonPicker = Boolean(seasonFilter && seasonFilter !== "current");
  const parentSeason = seasonFilter && seasonFilter !== "current" ? String(seasonFilter) : "";
  const seasonRef = useRef(season);
  seasonRef.current = season;

  const loadAudit = useCallback(async (seasonYear) => {
    if (!leagueId || !seasonYear) {
      setAudit(null);
      return;
    }
    try {
      const res = await apiFetch(
        `/api/hub/league/${leagueId}/contract-history/audit?season=${encodeURIComponent(seasonYear)}`,
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      setAudit(await res.json());
    } catch {
      setAudit(null);
    }
  }, [leagueId]);

  const loadGenerationRef = useRef(0);

  const load = useCallback(async (seasonOverride, opts = {}) => {
    if (!leagueId) return;
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      const yr = seasonOverride ?? (parentSeason || seasonRef.current);
      const allSeasons = Boolean(opts.allSeasons || seasonFilter === "all");
      if (allSeasons) {
        params.set("all_seasons", "1");
      } else if (yr) {
        params.set("season", String(yr));
      }
      const q = params.toString() ? `?${params.toString()}` : "";
      const res = await apiFetch(`/api/hub/league/${leagueId}/contract-history${q}`, {
        signal: AbortSignal.timeout(30000),
      });
      if (generation !== loadGenerationRef.current) return;
      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      if (generation !== loadGenerationRef.current) return;
      setData(payload);
      const activeSeason = allSeasons
        ? ""
        : String(payload.season_year || yr || payload.seasons?.[payload.seasons.length - 1] || "");
      if (activeSeason) {
        if (parentSeason) {
          if (seasonRef.current !== parentSeason) setSeason(parentSeason);
        } else if (seasonRef.current !== activeSeason) {
          setSeason(activeSeason);
        }
        void loadAudit(activeSeason);
      } else {
        setAudit(null);
        if (allSeasons) setSeason("");
      }
    } catch (e) {
      if (generation !== loadGenerationRef.current) return;
      const msg = connectionErrorMessage(e);
      setError(/timeout|aborted|abort/i.test(msg)
        ? "Contract history timed out — the API may be stuck. Restart with scripts/dev/start_local.ps1 and hard-refresh."
        : msg);
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false);
    }
  }, [leagueId, parentSeason, seasonFilter, loadAudit]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (seasonFilter === "all") {
      loadRef.current("", { allSeasons: true });
      return;
    }
    if (parentSeason) {
      setSeason(parentSeason);
      loadRef.current(parentSeason);
      return;
    }
    loadRef.current();
  }, [leagueId, seasonFilter, parentSeason]);

  useEffect(() => {
    setEditingId(null);
    setIssueFilter("");
  }, [season, reviewOnly]);

  const seasonOptions = useMemo(
    () => (data?.seasons || []).slice().sort((a, b) => b - a),
    [data?.seasons],
  );

  const rows = useMemo(() => {
    let all = data?.rows || [];
    if (reviewOnly) all = all.filter((r) => r.needs_review);
    if (issueFilter) {
      all = all.filter((r) => rowMatchesIssueFilter(r, issueFilter, audit, season));
    }
    return all;
  }, [data?.rows, reviewOnly, issueFilter, audit, season]);

  const applyRowFix = async (rowId, patch) => {
    setApplyingFixes(true);
    setError("");
    try {
      const res = await apiFetch(
        `/api/hub/league/${leagueId}/contract-history/audit/apply-flags`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patches: [{ row_id: rowId, patch }] }),
        },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      await load(season);
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setApplyingFixes(false);
    }
  };

  const applyAllFixes = async () => {
    if (!audit) return;
    const fixable = patchableIssues(audit.issues);
    const patches = fixable.map((i) => ({
      row_id: i.row_id ?? undefined,
      season_year: i.row_id ? undefined : audit.season_year,
      patch: i.suggested_patch,
    }));
    setApplyingFixes(true);
    setError("");
    try {
      const res = await apiFetch(
        `/api/hub/league/${leagueId}/contract-history/audit/apply-flags`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patches }),
        },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      await load(season);
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setApplyingFixes(false);
    }
  };

  const onSeasonChange = (next) => {
    setSeason(next);
    if (next) {
      load(next);
    } else {
      load("", { allSeasons: true });
    }
  };

  const runImport = async () => {
    setBusy("import");
    setError("");
    try {
      const res = await apiFetch(`/api/hub/league/${leagueId}/contract-history/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reconcile_sleeper: true }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      invalidateInsightsAfterCapSync(leagueId);
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
  const ownerChanges = data?.owner_changes || null;
  const editingRowId = useMemo(() => {
    if (!selectedPlayer || !season) return null;
    const key = selectedPlayer.toLowerCase().replace(/[^a-z0-9]/g, "");
    const match = (data?.rows || []).find(
      (r) => (r.player_name || "").toLowerCase().replace(/[^a-z0-9]/g, "") === key,
    );
    return match?.id ?? null;
  }, [data?.rows, selectedPlayer, season]);

  const scopeLabel = data?.all_seasons
    ? "All seasons (read-only overview — pick one year to edit)"
    : season
      ? `${season} end-of-season cap sheet`
      : "Cap sheet";

  const onMovementResolved = useCallback(() => {
    load(season);
  }, [load, season]);

  const tableLayout = !mobileLayout && !selectedPlayer;
  const showSeasonColumn = Boolean(data?.all_seasons);
  const splitLayout = !mobileLayout && selectedPlayer;

  const draftSourceNote = useMemo(() => {
    const sources = data?.draft_sources;
    if (!sources || !season) return null;
    const src = sources[String(season)];
    if (!src || src === "missing") return null;
    if (src === "excel") return "Auction wins tagged from commissioner draft spreadsheet.";
    if (src === "pdf") return "2021 auction wins tagged from inaugural draft PDF.";
    if (src === "sleeper") return "Auction wins tagged from Sleeper draft results.";
    return null;
  }, [data?.draft_sources, season]);

  // Embedded mode (Commissioner Desk) skips the outer panel + title so the
  // parent section header isn't duplicated; the controls row stays.
  const Wrapper = embedded ? "div" : HubPage;
  return (
    <Wrapper className={`hub-contract-history${splitLayout ? " hub-contract-history--split" : ""}`}>
      <header className="hub-section-head hub-section-head--row">
        {!embedded && (
        <div>
          <h2 className="hub-tab-intro-title">Contracts</h2>
          <p className="hub-page-meta">
            {scopeLabel}
            {season && !data?.all_seasons && audit?.season_year && (
              <span className="table-meta">
                {" · "}
                Expected/Delta vs {Number(season) - 1} renewals
              </span>
            )}
          </p>
        </div>
        )}
        <div className={`hub-insights-scoring-meta${mobileLayout ? " hub-insights-scoring-meta--desktop" : ""}`}>
          {seasonOptions.length > 0 && !hideSeasonPicker && (
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
          {isCommissioner && season && (
            <button type="button" className="btn-primary btn-sm" onClick={() => setEditingId("new")} disabled={!!busy}>
              Add row
            </button>
          )}
        </div>
      </header>

      {isCommissioner && (
        <details className="hub-contract-commissioner-tools">
          <summary>Commissioner tools</summary>
          <div className="hub-contract-commissioner-tools-inner">
            <button
              type="button"
              className="btn-ghost btn-sm"
              title="Re-import replaces imported rows only; manual edits are kept"
              onClick={runImport}
              disabled={!!busy}
            >
              {busy === "import" ? "Syncing…" : "Sync sheets"}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={runReconcile} disabled={!!busy}>
              {busy === "reconcile" ? "Matching…" : "Sync Sleeper moves"}
            </button>
            <OwnerSeasonMapPanel
              leagueId={leagueId}
              season={season}
              rows={data?.owner_season_map || []}
              isCommissioner={isCommissioner}
              onUpdated={() => load(season)}
            />
          </div>
        </details>
      )}

      {mobileLayout && (
        <div className="hub-contract-mobile-filters hub-filter-bar">
          {seasonOptions.length > 0 && !hideSeasonPicker && (
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
          {isCommissioner && season && (
            <div className="hub-contract-mobile-actions">
              <button type="button" className="btn-primary btn-sm" onClick={() => setEditingId("new")}>
                Add row
              </button>
            </div>
          )}
        </div>
      )}

      {!isCommissioner && (
        <OwnerSeasonMapPanel
          leagueId={leagueId}
          season={season}
          rows={data?.owner_season_map || []}
          isCommissioner={false}
          onUpdated={() => load(season)}
        />
      )}

      {error && <p className="error-banner">{error}</p>}
      {loading && <p className="chart-note">Loading contract history…</p>}

      {!loading && data && !data.available && !isCommissioner && (
        <p className="chart-note">
          Contract history has not been imported for this league yet.
        </p>
      )}

      {!loading && !data?.available && isCommissioner && (
        <p className="chart-note">
          No imported history yet. Import your commissioner cap sheets to build contract history.
        </p>
      )}

      {data?.needs_review_count > 0 && !reviewOnly && (
        <p className="chart-note hub-insights-callout">
          {data.needs_review_count} row(s) need review (ambiguous cut vs trade).
          {isCommissioner ? " Click Edit on a row, fix it, then uncheck Needs review." : ""}
        </p>
      )}

      {season && !data?.all_seasons && (
        <p className="hub-contract-scope-banner chart-note hub-insights-callout">
          Editing the <strong>{season}</strong> end-of-season cap sheet — who held each player and
          their salary that year. Mid-season Sleeper moves appear in player timelines and owner-change hints.
        </p>
      )}

      <ContractDataSourcesBanner
        draftSources={data?.draft_sources}
        sleeperLinked={Boolean(hubContext?.sleeper_league_id)}
      />

      {draftSourceNote && (
        <p className="chart-note hub-contract-draft-banner">{draftSourceNote}</p>
      )}

      {season && audit && (
        <ContractHistoryAuditBar
          audit={audit}
          activeFilter={issueFilter}
          onFilterChange={setIssueFilter}
          onApplyAll={applyAllFixes}
          applying={applyingFixes}
          isCommissioner={isCommissioner}
        />
      )}

      <ContractOwnerChangesPanel
        ownerChanges={ownerChanges}
        season={season}
        leagueId={leagueId}
        isCommissioner={isCommissioner}
        onResolved={onMovementResolved}
      />

      <div className="hub-contract-main">

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
          {rows.map((r) => {
            const rowIssues = audit?.row_issues?.[String(r.id)] || [];
            const fixIssue = rowIssues.find(
              (i) => i.suggested_patch && Object.keys(i.suggested_patch).length > 0,
            );
            return (
              <div key={r.id} className={`hub-contract-mobile-row${rowIssues.length ? " hub-contract-row--issue" : ""}`}>
                <MobilePlayerCard
                  name={r.player_name}
                  meta={[r.hub_team_name || r.owner_label, r.position, acqLabel(r.acquisition_type), r.roster_status].filter(Boolean).join(" · ")}
                  heroValue={fmtSal(r.cap_hit)}
                  heroLabel="cap"
                  badge={
                    rowIssues.length ? (
                      <span className="hub-contract-issue-badge">{rowIssues.length}</span>
                    ) : r.needs_review ? (
                      <span className="hub-sleeper-badge">Review</span>
                    ) : (
                      <SourceBadge sourceKind={r.source_kind} />
                    )
                  }
                  onSelect={() => setSelectedPlayer(r.player_name)}
                />
                <div className="hub-contract-mobile-actions">
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setSelectedPlayer(r.player_name)}>
                    Journey
                  </button>
                  {isCommissioner && fixIssue && (
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      disabled={applyingFixes}
                      onClick={() => applyRowFix(r.id, fixIssue.suggested_patch)}
                    >
                      Fix
                    </button>
                  )}
                  {isCommissioner && (
                    <button type="button" className="text-sm btn-ghost btn-sm" onClick={() => setEditingId(r.id)}>
                      Edit
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {rows.length > 0 && tableLayout && (
        <div className="table-wrap">
          <table className="data-table compact hub-live-starter-table hub-contract-table">
            <thead>
              <tr>
                <th>Owner</th>
                <th>Team</th>
                {showSeasonColumn && <th>Season</th>}
                <th>Player</th>
                <th>Pos</th>
                <th>How</th>
                <th className="num">Cap</th>
                <th className="num">Expected</th>
                <th className="num">Delta</th>
                <th>Status</th>
                <th>Issues</th>
                {isCommissioner && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rowIssues = audit?.row_issues?.[String(r.id)] || [];
                const expected = rowExpectedCap(rowIssues);
                const delta = expected != null && r.cap_hit != null
                  ? Number(r.cap_hit) - expected
                  : null;
                const fixIssue = rowIssues.find(
                  (i) => i.suggested_patch && Object.keys(i.suggested_patch).length > 0,
                );
                return (
                  <React.Fragment key={r.id}>
                    <tr className={[
                      rowIssues.length || r.needs_review ? "hub-contract-row--issue" : "",
                      editingRowId === r.id ? "hub-contract-row--selected" : "",
                    ].filter(Boolean).join(" ")}>
                      <td>{r.owner_label}</td>
                      <td>{r.hub_team_name || "—"}</td>
                      {showSeasonColumn && <td>{r.season_year || "—"}</td>}
                      <td>
                        <button
                          type="button"
                          className="btn-link hub-contract-player-link"
                          onClick={() => setSelectedPlayer(r.player_name)}
                        >
                          {r.player_name}
                        </button>
                      </td>
                      <td>{r.position || "—"}</td>
                      <td>{acqLabel(r.acquisition_type)}</td>
                      <td className="num">{fmtSal(r.cap_hit)}</td>
                      <td className="num">{expected != null ? fmtSal(expected) : "—"}</td>
                      <td className={`num${delta != null && Math.abs(delta) > 0.01 ? " hub-contract-delta-bad" : ""}`}>
                        {delta != null ? (delta > 0 ? `+${fmtSal(delta)}` : fmtSal(delta)) : "—"}
                      </td>
                      <td>{r.roster_status}</td>
                      <td>
                        {rowIssues.length > 0 ? (
                          <span className="hub-contract-issue-badge" title={rowIssues.map((i) => i.message).join("\n")}>
                            {rowIssues.length}
                          </span>
                        ) : "—"}
                      </td>
                      {isCommissioner && (
                        <td className="hub-contract-actions">
                          {fixIssue && (
                            <button
                              type="button"
                              className="btn-primary btn-sm"
                              disabled={applyingFixes}
                              onClick={() => applyRowFix(r.id, fixIssue.suggested_patch)}
                            >
                              Fix
                            </button>
                          )}
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
                        <td colSpan={showSeasonColumn ? 12 : 11}>
                          <ContractRowEditor
                            row={r}
                            leagueId={leagueId}
                            seasonYear={season}
                            onSaved={(updated) => {
                              onRowSaved(updated);
                              loadAudit(season);
                            }}
                            onDeleted={onRowDeleted}
                            onCancel={() => setEditingId(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && splitLayout && (
        <div className="table-wrap">
          <table className="data-table compact hub-live-starter-table hub-contract-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>How</th>
                <th className="num">Cap</th>
                <th>Status</th>
                <th>Issues</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rowIssues = audit?.row_issues?.[String(r.id)] || [];
                return (
                  <tr
                    key={r.id}
                    className={rowIssues.length ? "hub-contract-row--issue" : ""}
                    onClick={() => setSelectedPlayer(r.player_name)}
                  >
                    <td>{r.player_name}</td>
                    <td>{acqLabel(r.acquisition_type)}</td>
                    <td className="num">{fmtSal(r.cap_hit)}</td>
                    <td>{r.roster_status}</td>
                    <td>{rowIssues.length || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && reviewOnly && rows.length === 0 && (
        <p className="chart-note">No rows flagged for review this season.</p>
      )}

      {!loading && issueFilter && rows.length === 0 && (data?.rows?.length > 0) && (
        <p className="chart-note">No rows match this filter.</p>
      )}
      </div>

      {selectedPlayer && (
        <ContractPlayerJourney
          leagueId={leagueId}
          playerName={selectedPlayer}
          editingSeason={data?.all_seasons ? "" : season}
          onEditRow={(rowId) => {
            setEditingId(rowId);
            setSelectedPlayer(null);
          }}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </Wrapper>
  );
}
