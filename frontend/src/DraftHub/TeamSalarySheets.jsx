import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import { invalidateInsightsAfterCapSync } from "./hubDataCache";
import { HubFilterChip, HubFilterScroll, HubPage, SortTh } from "./HubUILayout";
import PlayerNameAliasPanel from "./PlayerNameAliasPanel";
import { confirmDialog } from "../ui/confirm";
import { fmtSal } from "./rosterFormat";

function looksLikeAlias(name) {
  const parts = String(name || "").trim().split(/\s+/);
  if (parts.length === 1) return true;
  return parts.length === 2 && parts[0].length <= 2 && parts[0].endsWith(".");
}

function isSheetSummaryRow(row) {
  const name = String(row?.player_name || "").trim().toLowerCase().replace(/:$/, "");
  if (!name) return true;
  return name === "total salary"
    || name === "salary available"
    || name === "team total"
    || name.startsWith("total salary")
    || name.startsWith("salary available");
}

function rosterCapTotals(rows, capLimit) {
  const eligible = (rows || []).filter((r) => !isSheetSummaryRow(r));
  const committed = eligible
    .filter((r) => r.roster_status !== "cut")
    .reduce((sum, r) => sum + (Number(r.cap_hit) || 0), 0);
  const deadCap = eligible
    .filter((r) => r.roster_status === "cut")
    .reduce((sum, r) => sum + (Number(r.cap_hit) || 0), 0);
  const cap = Number(capLimit) || 200;
  return {
    committed,
    dead_cap: deadCap,
    unspent: Math.max(0, cap - committed - deadCap),
  };
}

function applySeasonCapsToPayload(payload, capsBySeason) {
  if (!payload) return payload;
  const defaultCap = Number(payload.default_salary_cap ?? payload.salary_cap ?? 200);
  const caps = { ...(capsBySeason || {}) };
  const capFor = (y) => {
    const v = caps[String(y)];
    return v != null && Number.isFinite(Number(v)) ? Number(v) : defaultCap;
  };
  const matrix = (payload.summary_matrix || []).map((row) => ({
    ...row,
    seasons: Object.fromEntries(
      Object.entries(row.seasons || {}).map(([y, cell]) => {
        const capVal = capFor(y);
        const committed = Number(cell?.committed || 0);
        const dead = Number(cell?.dead_cap || 0);
        return [y, { ...cell, unspent: Math.max(0, capVal - committed - dead) }];
      }),
    ),
  }));
  const activeSeason = String(payload.season_year || "");
  return {
    ...payload,
    salary_caps_by_season: caps,
    summary_matrix: matrix,
    salary_cap: activeSeason && caps[activeSeason] != null ? caps[activeSeason] : payload.salary_cap,
  };
}

function rosterMapPosition(pos) {
  const p = String(pos || "").trim().toUpperCase();
  if (!p || p === "NAN" || p === "NONE" || p === "WC") return "";
  if (p === "DST" || p === "D") return "DEF";
  return p;
}

function playerNameCell(row, { isCommissioner, onMapName } = {}) {
  const mapped = row.name_mapped || row.sleeper_player_id || row.canonical_player_name;
  const showMap = isCommissioner && onMapName && !mapped && !isSheetSummaryRow(row);
  return (
    <>
      {row.player_name}
      {row.canonical_player_name && row.canonical_player_name !== row.player_name ? (
        <span className="table-meta hub-salary-name-map"> → {row.canonical_player_name}</span>
      ) : null}
      {mapped && row.sleeper_player_id ? (
        <span className="table-meta hub-salary-name-map"> · Sleeper linked</span>
      ) : mapped ? (
        <span className="table-meta hub-salary-name-map"> · Linked</span>
      ) : null}
      {showMap ? (
        <button
          type="button"
          className="btn-ghost btn-sm hub-salary-map-btn"
          title={looksLikeAlias(row.player_name)
            ? "Map abbreviated name to Sleeper player"
            : "Map this cap-sheet name to a Sleeper player"}
          onClick={() => onMapName({
            alias_name: row.player_name,
            position: rosterMapPosition(row.position),
          })}
        >
          Map
        </button>
      ) : null}
    </>
  );
}

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

const POS_RANK = Object.fromEntries(POSITIONS.map((p, i) => [p, i]));

function rosterRowSortKey(row) {
  let pos = String(row.position || "").toUpperCase();
  if (pos === "DST" || pos === "D") pos = "DEF";
  return [POS_RANK[pos] ?? 99, String(row.player_name || "").toLowerCase()];
}

function sortRosterRows(list) {
  return [...list].sort((a, b) => {
    const [ar, an] = rosterRowSortKey(a);
    const [br, bn] = rosterRowSortKey(b);
    return ar - br || an.localeCompare(bn);
  });
}

function fmtDelta(cur, prior) {
  if (cur == null || prior == null || !Number.isFinite(Number(cur)) || !Number.isFinite(Number(prior))) {
    return "—";
  }
  const d = Number(cur) - Number(prior);
  if (Math.abs(d) < 0.01) return "—";
  const sign = d > 0 ? "+" : "";
  return `${sign}$${d.toFixed(0)}`;
}

function teamLabel(sheet) {
  if (sheet.team_name && sheet.team_name !== sheet.owner_label) {
    return `${sheet.owner_label} · ${sheet.team_name}`;
  }
  return sheet.owner_label;
}

function statusLabel(row) {
  if (row.roster_status === "cut") return row.status || "CUT";
  return row.status || row.contract_phase || "";
}

function sourceBadge(row) {
  if (row.db_overlay) return "DB";
  if (row.source_kind && row.source_kind !== "file") return row.source_kind;
  return "";
}

function MissingPlayersPanel({
  items,
  defaultOwnerLabel,
  teamOptions = [],
  isCommissioner,
  onAdd,
  busyKey,
}) {
  const [targets, setTargets] = useState({});
  const [positions, setPositions] = useState({});
  const [salaries, setSalaries] = useState({});

  const ownerOptions = useMemo(() => {
    const set = new Set(teamOptions);
    if (defaultOwnerLabel) set.add(defaultOwnerLabel);
    return [...set].sort();
  }, [teamOptions, defaultOwnerLabel]);

  if (!items?.length) {
    return (
      <p className="chart-note hub-salary-audit-ok">
        No missing players — roster matches prior-year carryovers and draft wins.
      </p>
    );
  }

  const targetFor = (item) => {
    const key = item.player_name;
    if (targets[key]) return targets[key];
    if (item.current_owner_label) return item.current_owner_label;
    return defaultOwnerLabel;
  };

  const positionFor = (item) => {
    if (item.position) return item.position;
    return positions[item.player_name] || "WR";
  };

  const salaryFor = (item) => {
    if (salaries[item.player_name] != null) return salaries[item.player_name];
    const v = item.suggested_cap_hit ?? item.prior_salary;
    return v != null ? String(Number(v)) : "";
  };

  const sorted = [...items].sort((a, b) => {
    const rank = { prior_roster: 0, draft_win: 1, traded_to: 2, unowned: 3 };
    return (rank[a.reason] ?? 9) - (rank[b.reason] ?? 9);
  });

  return (
    <div className="table-wrap">
      <table className="data-table compact hub-salary-missing-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Why missing</th>
            <th className="num">Suggested $</th>
            {isCommissioner && <th>Add to team</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((item) => {
            const key = `${item.player_name}-${item.reason}`;
            const targetOwner = targetFor(item);
            const rowOwnerOptions = ownerOptions.includes(targetOwner)
              ? ownerOptions
              : [...ownerOptions, targetOwner].sort();
            const needsPos = !item.position;
            const pos = positionFor(item);
            return (
              <tr key={key} className="hub-salary-missing-row">
                <td className="col-player">
                  {item.player_name}
                  {item.position ? (
                    <span className="table-meta"> · {item.position}</span>
                  ) : needsPos && isCommissioner ? (
                    <label className="hub-salary-missing-pos">
                      <span className="table-meta">Pos </span>
                      <select
                        className="search-input hub-salary-pos-pick"
                        value={pos}
                        onChange={(e) => setPositions((prev) => ({ ...prev, [item.player_name]: e.target.value }))}
                      >
                        {POSITIONS.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </td>
                <td>
                  <span className="hub-salary-reason">{item.reason_label || item.reason}</span>
                  {item.detail ? <div className="table-meta">{item.detail}</div> : null}
                </td>
                <td className="num">
                  {isCommissioner ? (
                    <input
                      type="number"
                      className="search-input hub-salary-cap-input"
                      value={salaryFor(item)}
                      min="0"
                      step="1"
                      placeholder="—"
                      onChange={(e) => setSalaries((prev) => ({ ...prev, [item.player_name]: e.target.value }))}
                    />
                  ) : (
                    fmtSal(item.suggested_cap_hit ?? item.prior_salary)
                  )}
                </td>
                {isCommissioner && (
                  <td className="hub-salary-missing-actions">
                    <select
                      className="search-input hub-salary-owner-pick"
                      value={targetOwner}
                      onChange={(e) => setTargets((prev) => ({ ...prev, [item.player_name]: e.target.value }))}
                    >
                      {rowOwnerOptions.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={busyKey === key}
                      onClick={() => onAdd(item, targetOwner, pos, salaryFor(item))}
                    >
                      {busyKey === key ? "Adding…" : "Add"}
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SalaryEditCell({
  value,
  rowKey,
  field,
  editingKey,
  busyKey,
  isCommissioner,
  onStartEdit,
  onSave,
}) {
  const isEditing = editingKey === `${rowKey}-${field}`;
  const isBusy = busyKey === `${rowKey}-${field}`;
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (isEditing) {
      setDraft(value != null && Number.isFinite(Number(value)) ? String(Number(value)) : "");
    }
  }, [isEditing, value]);

  if (!isCommissioner) {
    return <td className="num">{fmtSal(value)}</td>;
  }

  if (isEditing) {
    return (
      <td className="num hub-salary-edit-cell">
        <input
          type="number"
          className="search-input hub-salary-cap-input"
          value={draft}
          min="0"
          step="1"
          autoFocus
          disabled={isBusy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSave(draft);
            if (e.key === "Escape") onStartEdit(null);
          }}
          onBlur={() => onSave(draft)}
        />
      </td>
    );
  }

  return (
    <td className="num hub-salary-edit-cell">
      <button
        type="button"
        className="btn-link hub-salary-cap-btn"
        disabled={isBusy}
        title="Click to edit salary"
        onClick={() => onStartEdit(`${rowKey}-${field}`)}
      >
        {isBusy ? "…" : fmtSal(value)}
      </button>
    </td>
  );
}

function CapLimitCell({
  seasonYear,
  cap,
  isCommissioner,
  isEditing,
  isBusy,
  onStartEdit,
  onSave,
  onCancel,
}) {
  const [draft, setDraft] = useState("");
  const skipBlurRef = useRef(false);
  const commitRef = useRef(false);
  const openedCapRef = useRef(null);

  useEffect(() => {
    if (isEditing) {
      if (openedCapRef.current !== cap) {
        openedCapRef.current = cap;
        commitRef.current = false;
        setDraft(cap != null && Number.isFinite(Number(cap)) ? String(Number(cap)) : "");
      }
    } else {
      openedCapRef.current = null;
    }
  }, [isEditing, cap]);

  const commit = async (rawDraft, viaEnter = false) => {
    if (commitRef.current) return;
    commitRef.current = true;
    skipBlurRef.current = viaEnter;
    try {
      await onSave(rawDraft);
    } finally {
      commitRef.current = false;
    }
  };

  if (!isCommissioner) {
    return <span className="hub-salary-cap-label">{fmtSal(cap)}</span>;
  }

  if (isEditing) {
    return (
      <span className="hub-salary-cap-edit-wrap">
        <input
          type="number"
          className="search-input hub-salary-cap-input"
          value={draft}
          min="0"
          step="1"
          autoFocus
          disabled={isBusy}
          title={`Cap limit for ${seasonYear}`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commit(draft, true);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              skipBlurRef.current = true;
              onCancel();
            }
          }}
          onBlur={(e) => {
            if (skipBlurRef.current) {
              skipBlurRef.current = false;
              return;
            }
            if (e.relatedTarget?.closest?.(".hub-salary-cap-edit-wrap")) return;
            void commit(draft, false);
          }}
        />
        <button
          type="button"
          className="btn-ghost btn-sm hub-salary-cap-save-btn"
          disabled={isBusy}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void commit(draft, true)}
        >
          Save
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      className="btn-link hub-salary-cap-btn hub-salary-cap-label"
      disabled={isBusy}
      title={`Click to edit ${seasonYear} cap limit`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onStartEdit(String(seasonYear))}
    >
      {isBusy ? "…" : fmtSal(cap)}
    </button>
  );
}

function RosterTable({
  sheet,
  priorSeason,
  seasonYear,
  showDelta,
  posFilter,
  showCuts,
  isCommissioner,
  onDrop,
  onSaveSalary,
  busyRowKey,
  editingSalaryKey,
  onStartSalaryEdit,
  onMapName,
}) {
  const hasPrior = priorSeason != null;
  const rows = useMemo(() => {
    let list = sheet.rows || [];
    list = list.filter((r) => !isSheetSummaryRow(r));
    if (!showCuts) list = list.filter((r) => r.roster_status !== "cut");
    if (posFilter.size > 0 && posFilter.size < POSITIONS.length) {
      list = list.filter((r) => !r.position || posFilter.has(r.position));
    }
    return sortRosterRows(list);
  }, [sheet.rows, showCuts, posFilter]);

  return (
    <div className="table-wrap table-sticky">
      <table className="data-table compact hub-salary-sheet-table">
        <thead>
          <tr>
            <th>Pos</th>
            <th className="col-player">Player</th>
            {hasPrior && <th className="num">{priorSeason} $</th>}
            <th>Status</th>
            {showDelta && hasPrior && <th className="num">Δ</th>}
            <th className="num">{seasonYear} $</th>
            {isCommissioner && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const delta = fmtDelta(row.cap_hit, row.prior_salary);
            const deltaUp = delta.startsWith("+");
            const deltaDown = delta.startsWith("-");
            const rowKey = `${row.player_name}-${row.position}-${row.cap_hit}`;
            const badge = sourceBadge(row);
            return (
              <tr
                key={rowKey}
                className={row.roster_status === "cut" ? "hub-salary-sheet-row--cut" : ""}
              >
                <td>{row.position || "—"}</td>
                <td className="col-player">
                  {playerNameCell(row, { isCommissioner, onMapName })}
                  {badge ? <span className="hub-salary-src-badge">{badge}</span> : null}
                </td>
                {hasPrior && (
                  <SalaryEditCell
                    value={row.prior_salary}
                    rowKey={rowKey}
                    field="prior"
                    editingKey={editingSalaryKey}
                    busyKey={busyRowKey}
                    isCommissioner={isCommissioner}
                    onStartEdit={onStartSalaryEdit}
                    onSave={(draft) => onSaveSalary?.(row, "prior_salary", draft, rowKey)}
                  />
                )}
                <td>{statusLabel(row)}</td>
                {showDelta && hasPrior && (
                  <td className={`num${deltaUp ? " hub-salary-delta-up" : ""}${deltaDown ? " hub-salary-delta-down" : ""}`}>
                    {delta}
                  </td>
                )}
                <SalaryEditCell
                  value={row.cap_hit}
                  rowKey={rowKey}
                  field="cap"
                  editingKey={editingSalaryKey}
                  busyKey={busyRowKey}
                  isCommissioner={isCommissioner}
                  onStartEdit={onStartSalaryEdit}
                  onSave={(draft) => onSaveSalary?.(row, "cap_hit", draft, rowKey)}
                />
                {isCommissioner && (
                  <td>
                    {row.roster_status !== "cut" && (
                      <button
                        type="button"
                        className="btn-ghost btn-sm hub-salary-drop-btn"
                        disabled={busyRowKey === rowKey}
                        onClick={() => onDrop?.(row)}
                      >
                        {busyRowKey === rowKey ? "…" : "Drop"}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="hub-salary-sheet-totals">
            <td colSpan={hasPrior ? (showDelta ? 5 : 4) : 3}>Team total</td>
            <td className="num">{fmtSal(sheet.totals?.committed)}</td>
          </tr>
          {sheet.totals?.dead_cap > 0 && (
            <tr className="hub-salary-sheet-totals hub-salary-sheet-row--cut">
              <td colSpan={hasPrior ? (showDelta ? 5 : 4) : 3}>Dead cap</td>
              <td className="num">{fmtSal(sheet.totals.dead_cap)}</td>
            </tr>
          )}
          <tr className="hub-salary-sheet-totals">
            <td colSpan={hasPrior ? (showDelta ? 5 : 4) : 3}>Unspent</td>
            <td className="num">{fmtSal(sheet.totals?.unspent)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function TeamRosterSheet({
  sheet,
  priorSeason,
  seasonYear,
  selected,
  open,
  onToggle,
  showDelta,
  posFilter,
  showCuts,
  sheetRef,
  isCommissioner,
  onDrop,
  onSaveSalary,
  busyRowKey,
  editingSalaryKey,
  onStartSalaryEdit,
  onMapName,
}) {
  return (
    <details
      ref={sheetRef}
      className={`hub-salary-sheet panel${selected ? " hub-salary-sheet--selected" : ""}`}
      open={open}
      onToggle={(e) => onToggle?.(sheet.owner_label, e.target.open)}
    >
      <summary className="hub-salary-sheet-summary">
        <strong>{teamLabel(sheet)}</strong>
        <span className="table-meta">
          {fmtSal(sheet.totals?.committed)} committed
          {sheet.totals?.dead_cap > 0 ? ` · ${fmtSal(sheet.totals.dead_cap)} dead` : ""}
          {" · "}
          {fmtSal(sheet.totals?.unspent)} left
        </span>
      </summary>
      <RosterTable
        sheet={sheet}
        priorSeason={priorSeason}
        seasonYear={seasonYear}
        showDelta={showDelta}
        posFilter={posFilter}
        showCuts={showCuts}
        isCommissioner={isCommissioner}
        onDrop={onDrop}
        onSaveSalary={onSaveSalary}
        busyRowKey={busyRowKey}
        editingSalaryKey={editingSalaryKey}
        onStartSalaryEdit={onStartSalaryEdit}
        onMapName={onMapName}
      />
    </details>
  );
}

export default function TeamSalarySheets({ leagueId, seasonFilter = "", isCommissioner = false, embedded = false }) {
  const [data, setData] = useState(null);
  const [audit, setAudit] = useState(null);
  const [season, setSeason] = useState("");
  const [loading, setLoading] = useState(Boolean(leagueId));
  const [auditLoading, setAuditLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [busyRowKey, setBusyRowKey] = useState("");
  const [editingSalaryKey, setEditingSalaryKey] = useState("");
  const [editingCapYear, setEditingCapYear] = useState("");
  const [capBusyYear, setCapBusyYear] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [selectedOwner, setSelectedOwner] = useState("");
  const [viewMode, setViewMode] = useState("focus");
  const [showCuts, setShowCuts] = useState(false);
  const [showMissing, setShowMissing] = useState(true);
  const [showNameMaps, setShowNameMaps] = useState(false);
  const [mapRequest, setMapRequest] = useState(null);
  const [showDelta, setShowDelta] = useState(true);
  const [posFilter, setPosFilter] = useState(() => new Set(POSITIONS));
  const [matrixSortKey, setMatrixSortKey] = useState("team");
  const [matrixSortDir, setMatrixSortDir] = useState("asc");
  const [openSheets, setOpenSheets] = useState(() => new Set());
  const [sheetView, setSheetView] = useState("snapshot");
  const [syncBusy, setSyncBusy] = useState(false);
  const [applySleeperBusy, setApplySleeperBusy] = useState(false);
  const sheetRefs = useRef(new Map());
  const dataRef = useRef(null);
  const capSavingRef = useRef(null);
  const parentSeason = seasonFilter && seasonFilter !== "current" ? String(seasonFilter) : "";
  const seasonRef = useRef(season);
  seasonRef.current = season;

  const load = useCallback(async (seasonOverride, { silent = false } = {}) => {
    if (!leagueId) return null;
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const yr = seasonOverride ?? (parentSeason || seasonRef.current);
      const q = new URLSearchParams();
      if (yr) q.set("season", String(yr));
      if (sheetView === "effective") q.set("view", "effective");
      const params = q.toString() ? `?${q}` : "";
      const res = await apiFetch(
        `/api/hub/league/${leagueId}/team-salary-sheets${params}`,
        { signal: AbortSignal.timeout(30000), cache: "no-store" },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      setData((prev) => {
        const mergedCaps = {
          ...(prev?.salary_caps_by_season || {}),
          ...(payload.salary_caps_by_season || {}),
        };
        return applySeasonCapsToPayload(payload, mergedCaps);
      });
      const active = String(payload.season_year || yr || payload.seasons?.[payload.seasons.length - 1] || "");
      if (active && seasonRef.current !== active) setSeason(active);
      return payload;
    } catch (e) {
      if (!silent) setError(connectionErrorMessage(e));
      throw e;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [leagueId, parentSeason, sheetView]);

  const loadRef = useRef(load);
  loadRef.current = load;

  const loadAudit = useCallback(async (seasonOverride, ownerOverride) => {
    if (!leagueId) return;
    const yr = seasonOverride ?? (parentSeason || seasonRef.current);
    const owner = ownerOverride ?? selectedOwnerRef.current;
    if (!yr) return;
    setAuditLoading(true);
    try {
      const params = new URLSearchParams({ season: String(yr) });
      if (owner) params.set("owner", owner);
      const res = await apiFetch(
        `/api/hub/league/${leagueId}/team-salary-sheets/audit?${params}`,
        { signal: AbortSignal.timeout(30000), cache: "no-store" },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      setAudit(await res.json());
    } catch {
      setAudit(null);
    } finally {
      setAuditLoading(false);
    }
  }, [leagueId, parentSeason]);

  const selectedOwnerRef = useRef(selectedOwner);
  selectedOwnerRef.current = selectedOwner;

  const auditRef = useRef(loadAudit);
  auditRef.current = loadAudit;

  const refreshAll = useCallback(async (seasonOverride) => {
    await loadRef.current(seasonOverride);
    await auditRef.current(seasonOverride, selectedOwnerRef.current);
  }, []);

  useEffect(() => {
    if (!leagueId || !data?.available) return;
    loadRef.current(undefined, { silent: true });
  }, [leagueId, sheetView, data?.available]);

  const refreshAfterNameMap = useCallback(async (seasonOverride) => {
    const yr = seasonOverride ?? (parentSeason || seasonRef.current);
    if (!leagueId || !yr) return;
    const owner = selectedOwnerRef.current;
    try {
      const auditParams = new URLSearchParams({ season: String(yr) });
      if (owner) auditParams.set("owner", owner);
      const auditRes = await apiFetch(
        `/api/hub/league/${leagueId}/team-salary-sheets/audit?${auditParams}`,
        { signal: AbortSignal.timeout(30000), cache: "no-store" },
      );
      if (auditRes.ok) setAudit(await auditRes.json());
    } catch {
      /* keep current audit on background refresh failure */
    }
    try {
      const sheetRes = await apiFetch(
        `/api/hub/league/${leagueId}/team-salary-sheets?season=${encodeURIComponent(yr)}`,
        { signal: AbortSignal.timeout(30000), cache: "no-store" },
      );
      if (sheetRes.ok) setData(await sheetRes.json());
    } catch {
      /* keep current sheets on background refresh failure */
    }
  }, [leagueId, parentSeason]);

  useEffect(() => {
    if (parentSeason) {
      setSeason(parentSeason);
      loadRef.current(parentSeason);
      return;
    }
    loadRef.current();
  }, [leagueId, parentSeason]);

  const seasons = data?.seasons || [];
  const priorSeason = data?.prior_season;
  const seasonYear = data?.season_year;
  const salaryCap = data?.salary_cap;
  const defaultSalaryCap = data?.default_salary_cap ?? salaryCap;
  const capsBySeason = data?.salary_caps_by_season || {};
  const teamSheets = data?.team_sheets || [];
  dataRef.current = data;

  const capForSeason = useCallback((yr) => {
    const key = String(yr);
    const v = capsBySeason[key];
    if (v != null && Number.isFinite(Number(v))) return Number(v);
    return Number(defaultSalaryCap) || 200;
  }, [capsBySeason, defaultSalaryCap]);

  const teamOwnerOptions = useMemo(
    () => (audit?.owners?.length ? audit.owners : teamSheets.map((s) => s.owner_label)).filter(Boolean),
    [audit?.owners, teamSheets],
  );

  const addMissingPlayer = useCallback(async (item, targetOwner, position, salaryDraft) => {
    const yr = String(seasonRef.current || dataRef.current?.season_year || "");
    if (!isCommissioner) {
      setActionError("Commissioner access required to edit salary sheets.");
      return;
    }
    if (!yr) {
      setActionError("Season not loaded yet — try again in a moment.");
      return;
    }
    if (!targetOwner) {
      setActionError("Pick a team to add this player to.");
      return;
    }
    const pos = (position || item.position || "").trim().toUpperCase();
    if (!pos || !POSITIONS.includes(pos)) {
      setActionError(`Pick a position for ${item.player_name} before adding.`);
      return;
    }
    const key = `${item.player_name}-${item.reason}`;
    setBusyKey(key);
    setActionError("");
    try {
      const capRaw = salaryDraft ?? item.suggested_cap_hit ?? item.prior_salary;
      const cap = capRaw != null && String(capRaw).trim() !== "" ? Number(capRaw) : null;
      if (cap == null || !Number.isFinite(Number(cap))) {
        throw new Error("No suggested salary for this player — edit in Contracts first.");
      }
      const body = {
        season_year: Number(yr),
        owner_label: targetOwner,
        player_name: item.player_name,
        position: pos,
        cap_hit: Number(cap),
        base_salary: Number(cap),
        prior_salary: item.suggested_prior_salary ?? item.prior_salary ?? undefined,
        roster_status: "active",
        acquisition_type: item.acquisition_type || undefined,
      };
      const res = await apiFetch(`/api/hub/league/${leagueId}/contract-history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      await refreshAll(yr);
    } catch (e) {
      setActionError(connectionErrorMessage(e));
    } finally {
      setBusyKey("");
    }
  }, [isCommissioner, leagueId, refreshAll]);

  const openNameMap = useCallback((req) => {
    setShowNameMaps(true);
    setMapRequest(req);
  }, []);

  const saveSalary = useCallback(async (row, field, draftValue, rowKey, ownerLabel) => {
    const yr = String(seasonRef.current || dataRef.current?.season_year || "");
    if (!isCommissioner || !yr || !ownerLabel) return;
    setEditingSalaryKey("");
    const parsed = draftValue.trim() === "" ? null : Number(draftValue);
    if (parsed != null && !Number.isFinite(parsed)) {
      setActionError("Enter a valid dollar amount.");
      return;
    }
    const current = field === "cap_hit" ? row.cap_hit : row.prior_salary;
    if (parsed != null && current != null && Math.abs(Number(current) - parsed) < 0.01) return;

    const busyField = field === "cap_hit" ? "cap" : "prior";
    setBusyRowKey(`${rowKey}-${busyField}`);
    setActionError("");
    try {
      if (row.row_id) {
        const body = field === "cap_hit"
          ? { cap_hit: parsed, base_salary: parsed }
          : { prior_salary: parsed };
        const res = await apiFetch(`/api/hub/league/${leagueId}/contract-history/${row.row_id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(await parseApiError(res));
      } else {
        const cap = field === "cap_hit"
          ? (parsed ?? row.cap_hit ?? 1)
          : (row.cap_hit ?? 1);
        const prior = field === "prior_salary"
          ? parsed
          : (row.prior_salary ?? undefined);
        const body = {
          season_year: Number(yr),
          owner_label: ownerLabel,
          player_name: row.player_name,
          position: row.position || "WR",
          cap_hit: Number(cap),
          base_salary: Number(cap),
          prior_salary: prior ?? undefined,
          roster_status: row.roster_status || "active",
        };
        const res = await apiFetch(`/api/hub/league/${leagueId}/contract-history`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(await parseApiError(res));
      }
      await refreshAll(yr);
    } catch (e) {
      setActionError(connectionErrorMessage(e));
    } finally {
      setBusyRowKey("");
    }
  }, [isCommissioner, leagueId, refreshAll]);

  const saveSeasonCap = useCallback(async (year, draftValue) => {
    const yr = String(year);
    if (!isCommissioner || !yr) return;
    if (capSavingRef.current === yr) return;

    const parsed = String(draftValue ?? "").trim() === "" ? null : Number(draftValue);
    if (parsed == null || !Number.isFinite(parsed) || parsed < 0) {
      setEditingCapYear("");
      setActionError("Enter a valid cap limit (0 or higher).");
      return;
    }
    const current = Number(
      dataRef.current?.salary_caps_by_season?.[yr]
      ?? dataRef.current?.default_salary_cap
      ?? 200,
    );
    if (Math.abs(current - parsed) < 0.01) {
      setEditingCapYear("");
      return;
    }

    capSavingRef.current = yr;
    setCapBusyYear(yr);
    setActionError("");
    try {
      const res = await apiFetch(`/api/hub/league/${leagueId}/season-salary-cap`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ season_year: Number(yr), salary_cap: parsed }),
      });
      if (!res.ok) {
        const msg = await parseApiError(res);
        if (res.status === 404 || res.status === 405) {
          throw new Error(
            `${msg} Restart the API server (scripts/dev/start_local.ps1) so the season cap route is loaded.`,
          );
        }
        throw new Error(msg);
      }
      setEditingCapYear("");
      setData((prev) => {
        if (!prev) return prev;
        const caps = { ...(prev.salary_caps_by_season || {}), [yr]: parsed };
        return applySeasonCapsToPayload(prev, caps);
      });
      try {
        await loadRef.current(yr, { silent: true });
      } catch {
        /* keep optimistic cap if background refresh fails */
      }
      try {
        await auditRef.current(yr, selectedOwnerRef.current);
      } catch {
        /* roster totals can refresh on next audit load */
      }
    } catch (e) {
      setActionError(connectionErrorMessage(e));
    } finally {
      capSavingRef.current = null;
      setCapBusyYear("");
    }
  }, [isCommissioner, leagueId]);

  const dropPlayer = useCallback(async (row, ownerLabel) => {
    const yr = String(seasonRef.current || dataRef.current?.season_year || "");
    if (!isCommissioner || !yr) return;
    if (!(await confirmDialog({
      title: "Cut player",
      message: `Mark ${row.player_name} as cut on the ${yr} sheet?`,
      confirmLabel: "Mark as cut",
      danger: true,
    }))) return;
    const rowKey = `${row.player_name}-${row.position}-${row.cap_hit}`;
    setBusyRowKey(rowKey);
    setActionError("");
    try {
      if (row.row_id) {
        if (row.source_kind === "file") {
          const res = await apiFetch(`/api/hub/league/${leagueId}/contract-history/${row.row_id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ roster_status: "cut" }),
          });
          if (!res.ok) throw new Error(await parseApiError(res));
        } else {
          const res = await apiFetch(`/api/hub/league/${leagueId}/contract-history/${row.row_id}`, {
            method: "DELETE",
          });
          if (!res.ok) throw new Error(await parseApiError(res));
        }
      } else {
        const cap = row.cap_hit != null ? Number(row.cap_hit) : 1;
        const body = {
          season_year: Number(yr),
          owner_label: ownerLabel,
          player_name: row.player_name,
          position: row.position || undefined,
          cap_hit: cap,
          base_salary: cap,
          prior_salary: row.prior_salary ?? undefined,
          roster_status: "cut",
        };
        const res = await apiFetch(`/api/hub/league/${leagueId}/contract-history`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(await parseApiError(res));
      }
      await refreshAll(yr);
    } catch (e) {
      setActionError(connectionErrorMessage(e));
    } finally {
      setBusyRowKey("");
    }
  }, [isCommissioner, leagueId, refreshAll]);

  useEffect(() => {
    if (viewMode !== "focus" && !showMissing && !showNameMaps) return;
    const yr = seasonYear || season;
    if (!leagueId || !yr) return;
    auditRef.current(yr, selectedOwner);
  }, [leagueId, seasonYear, season, selectedOwner, showMissing, showNameMaps, viewMode]);

  useEffect(() => {
    if (!teamSheets.length) return;
    setSelectedOwner((prev) => {
      if (prev && teamSheets.some((s) => s.owner_label === prev)) return prev;
      return teamSheets[0].owner_label;
    });
  }, [teamSheets]);

  const filteredSheets = useMemo(() => {
    const q = teamFilter.trim().toLowerCase();
    if (!q) return teamSheets;
    return teamSheets.filter(
      (s) => (s.owner_label || "").toLowerCase().includes(q)
        || (s.team_name || "").toLowerCase().includes(q),
    );
  }, [teamSheets, teamFilter]);

  const selectedSheet = useMemo(
    () => teamSheets.find((s) => s.owner_label === selectedOwner) || filteredSheets[0] || null,
    [teamSheets, filteredSheets, selectedOwner],
  );

  const focusSheet = useMemo(() => {
    if (!selectedSheet) return null;
    const auditRows = audit?.rosters?.[selectedSheet.owner_label];
    const cap = capForSeason(seasonYear);
    if (!auditRows?.length) return selectedSheet;
    const totals = rosterCapTotals(auditRows, cap);
    return {
      ...selectedSheet,
      rows: auditRows,
      totals: {
        ...selectedSheet.totals,
        ...totals,
      },
    };
  }, [selectedSheet, audit?.rosters, seasonYear, capForSeason]);

  const missingPlayers = audit?.missing_by_owner?.[selectedOwner] || [];
  const missingCount = audit?.missing_count ?? missingPlayers.length;

  const selectedIndex = useMemo(
    () => filteredSheets.findIndex((s) => s.owner_label === selectedOwner),
    [filteredSheets, selectedOwner],
  );

  const onMatrixSort = useCallback((col) => {
    setMatrixSortKey((prevKey) => {
      if (prevKey === col) {
        setMatrixSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prevKey;
      }
      setMatrixSortDir(col === "team" ? "asc" : "desc");
      return col;
    });
  }, []);

  const sortedMatrix = useMemo(() => {
    const rows = [...(data?.summary_matrix || [])];
    const yr = String(seasonYear || "");
    const val = (row, col) => {
      if (col === "team") {
        return teamLabel({ owner_label: row.owner_label, team_name: row.team_name }).toLowerCase();
      }
      if (col === "committed") return Number(row.seasons?.[yr]?.committed || 0);
      if (col === "unspent") return Number(row.seasons?.[yr]?.unspent || 0);
      return 0;
    };
    rows.sort((a, b) => {
      const av = val(a, matrixSortKey);
      const bv = val(b, matrixSortKey);
      if (typeof av === "string") {
        return matrixSortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return matrixSortDir === "asc" ? av - bv : bv - av;
    });
    return rows;
  }, [data?.summary_matrix, matrixSortKey, matrixSortDir, seasonYear]);

  const selectTeam = useCallback((owner, opts = {}) => {
    setSelectedOwner(owner);
    if (opts.scroll && viewMode === "grid") {
      requestAnimationFrame(() => {
        sheetRefs.current.get(owner)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
  }, [viewMode]);

  const onSeasonChange = (next) => {
    setSeason(next);
    load(next);
  };

  const runSyncSheets = useCallback(async () => {
    if (!leagueId || !isCommissioner) return;
    setSyncBusy(true);
    setActionError("");
    try {
      const res = await apiFetch(`/api/hub/league/${leagueId}/contract-history/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reconcile_sleeper: true }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      invalidateInsightsAfterCapSync(leagueId);
      await refreshAll();
    } catch (e) {
      setActionError(connectionErrorMessage(e));
    } finally {
      setSyncBusy(false);
    }
  }, [isCommissioner, leagueId, refreshAll]);

  const runApplySleeperMoves = useCallback(async () => {
    const yr = String(seasonRef.current || dataRef.current?.season_year || "");
    if (!leagueId || !isCommissioner || !yr) return;
    setActionError("");
    try {
      const preview = await apiFetch(
        `/api/hub/league/${leagueId}/contract-history/apply-sleeper-moves?season=${encodeURIComponent(yr)}`,
      );
      if (!preview.ok) throw new Error(await parseApiError(preview));
      const diff = await preview.json();
      const n = (diff.add_count || 0) + (diff.remove_count || 0);
      if (n === 0) return;
      if (!(await confirmDialog({
        title: "Apply Sleeper moves",
        message: `Apply ${n} Sleeper move(s) to contract history for ${yr}?`,
        confirmLabel: "Apply moves",
      }))) return;
      setApplySleeperBusy(true);
      const res = await apiFetch(
        `/api/hub/league/${leagueId}/contract-history/apply-sleeper-moves?season=${encodeURIComponent(yr)}`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      invalidateInsightsAfterCapSync(leagueId);
      await refreshAll();
    } catch (e) {
      setActionError(connectionErrorMessage(e));
    } finally {
      setApplySleeperBusy(false);
    }
  }, [isCommissioner, leagueId, refreshAll]);

  const togglePosition = (pos) => {
    setPosFilter((prev) => {
      const next = new Set(prev);
      if (next.has(pos)) {
        if (next.size > 1) next.delete(pos);
      } else {
        next.add(pos);
      }
      return next;
    });
  };

  const stepTeam = (delta) => {
    if (!filteredSheets.length) return;
    const idx = selectedIndex >= 0 ? selectedIndex : 0;
    const next = (idx + delta + filteredSheets.length) % filteredSheets.length;
    selectTeam(filteredSheets[next].owner_label, { scroll: true });
  };

  const setAllSheetsOpen = (open) => {
    setOpenSheets(new Set(open ? filteredSheets.map((s) => s.owner_label) : []));
  };

  // Embedded mode (Commissioner Desk) skips the outer panel + title so the
  // parent section header isn't duplicated.
  const Wrapper = embedded ? "div" : HubPage;
  return (
    <Wrapper className="hub-team-salary-sheets">
      {(!embedded || (seasons.length > 0 && !parentSeason)) && (
      <header className="hub-section-head hub-section-head--row">
        {!embedded && (
        <div>
          <h2 className="hub-tab-intro-title">Team salary sheets</h2>
          <p className="hub-section-hint">
            Commissioner Excel layout by team and season. Use the audit panel to find players who should be on a roster but are missing.
          </p>
        </div>
        )}
        {seasons.length > 0 && !parentSeason && (
          <label className="hub-insights-season-picker">
            <span className="hub-filter-label">Roster season</span>
            <select
              className="search-input"
              value={season || ""}
              onChange={(e) => onSeasonChange(e.target.value)}
              disabled={loading}
            >
              {seasons.slice().sort((a, b) => b - a).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
        )}
      </header>
      )}

      {error && <p className="error-banner">{error}</p>}
      {actionError && <p className="error-banner">{actionError}</p>}
      {loading && <p className="chart-note">Loading salary sheets…</p>}

      {!loading && data && !data.available && (
        <p className="chart-note">
          No imported cap history yet. Import commissioner sheets from Contracts → Commissioner tools.
        </p>
      )}

      {!loading && data?.available && (
        <>
          {data.sync_status?.stale && isCommissioner && (
            <div className="error-banner hub-sync-banner" role="status">
              Excel cap sheets are newer than the last import — Insights may be stale until you sync.
              <button type="button" className="btn-primary btn-sm" onClick={runSyncSheets} disabled={syncBusy}>
                {syncBusy ? "Syncing…" : "Sync sheets"}
              </button>
            </div>
          )}
          {data.data_source === "commissioner_files" ? (
            <p className="chart-note hub-insights-callout">
              Loaded from imported commissioner cap sheets
              {data.view === "effective" ? " · effective view includes Sleeper in-season moves" : ""}
              {data.import_meta?.[String(seasonYear)]?.snapshot_phase
                ? ` · ${seasonYear} snapshot: ${data.import_meta[String(seasonYear)].snapshot_phase.replace(/_/g, " ")}`
                : ""}
            </p>
          ) : (
            <p className="chart-note hub-insights-callout">
              Loaded from imported contract history (database). Re-import cap sheets if numbers look stale.
            </p>
          )}
          {isCommissioner && (
            <div className="hub-salary-toolbar-actions">
              <button type="button" className="btn-ghost btn-sm" onClick={runSyncSheets} disabled={syncBusy}>
                {syncBusy ? "Syncing…" : "Sync sheets"}
              </button>
              <button
                type="button"
                className={`btn-ghost btn-sm${sheetView === "effective" ? " active" : ""}`}
                onClick={() => setSheetView((v) => (v === "effective" ? "snapshot" : "effective"))}
              >
                {sheetView === "effective" ? "Sheet snapshot" : "Effective (Sleeper)"}
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={runApplySleeperMoves}
                disabled={applySleeperBusy}
              >
                {applySleeperBusy ? "Applying…" : "Apply Sleeper moves"}
              </button>
            </div>
          )}
          <section className="hub-salary-matrix panel">
            <div className="hub-section-head hub-section-head--row">
              <h3 className="hub-live-section-title">League totals by season</h3>
              <span className="table-meta">
                {seasonYear ? `${fmtSal(capForSeason(seasonYear))} cap for ${seasonYear}` : "Cap by season"}
                {" · click season to load rosters"}
                {isCommissioner ? " · commissioners can edit cap limits in the matrix" : ""}
              </span>
            </div>
            <div className="table-wrap hub-salary-matrix-wrap">
              <table className="data-table compact hub-salary-matrix-table">
                <thead>
                  <tr>
                    <SortTh
                      label="Team"
                      col="team"
                      sortKey={matrixSortKey}
                      sortDir={matrixSortDir}
                      onSort={onMatrixSort}
                    />
                    {seasons.map((y) => (
                      <th
                        key={y}
                        colSpan={2}
                        className={`hub-salary-matrix-season-head${String(y) === String(seasonYear) ? " hub-salary-matrix-season-head--active" : ""}`}
                      >
                        <button
                          type="button"
                          className="btn-link hub-salary-season-btn"
                          onClick={() => onSeasonChange(String(y))}
                        >
                          {y}
                        </button>
                      </th>
                    ))}
                  </tr>
                  <tr className="hub-salary-cap-row">
                    <th className="hub-salary-cap-row-label">Cap limit</th>
                    {seasons.map((y) => (
                      <th
                        key={`cap-${y}`}
                        colSpan={2}
                        className={`num hub-salary-cap-head${String(y) === String(seasonYear) ? " hub-salary-matrix-col--active" : ""}`}
                      >
                        <CapLimitCell
                          seasonYear={y}
                          cap={capForSeason(y)}
                          isCommissioner={isCommissioner}
                          isEditing={editingCapYear === String(y)}
                          isBusy={capBusyYear === String(y)}
                          onStartEdit={setEditingCapYear}
                          onSave={(draft) => saveSeasonCap(y, draft)}
                          onCancel={() => setEditingCapYear("")}
                        />
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th />
                    {seasons.map((y) => (
                      <React.Fragment key={`sub-${y}`}>
                        <th className={`num${String(y) === String(seasonYear) ? " hub-salary-matrix-col--active" : ""}`}>
                          Spent
                        </th>
                        <th className={`num${String(y) === String(seasonYear) ? " hub-salary-matrix-col--active" : ""}`}>
                          Left
                        </th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedMatrix.map((row) => {
                    const selected = row.owner_label === selectedOwner;
                    return (
                      <tr
                        key={row.owner_label}
                        className={`hub-salary-matrix-row${selected ? " hub-salary-matrix-row--selected" : ""}`}
                      >
                        <td>
                          <button
                            type="button"
                            className="btn-link hub-salary-team-btn"
                            onClick={() => selectTeam(row.owner_label, { scroll: true })}
                          >
                            {teamLabel(row)}
                          </button>
                        </td>
                        {seasons.map((y) => {
                          const cell = row.seasons?.[String(y)] || {};
                          const active = String(y) === String(seasonYear);
                          return (
                            <React.Fragment key={`${row.owner_label}-${y}`}>
                              <td
                                className={`num hub-salary-matrix-cell${active ? " hub-salary-matrix-col--active" : ""}`}
                              >
                                <button
                                  type="button"
                                  className="btn-link hub-salary-cell-btn"
                                  onClick={() => {
                                    onSeasonChange(String(y));
                                    selectTeam(row.owner_label, { scroll: true });
                                  }}
                                >
                                  {fmtSal(cell.committed)}
                                </button>
                              </td>
                              <td
                                className={`num hub-salary-matrix-cell${active ? " hub-salary-matrix-col--active" : ""}`}
                              >
                                {fmtSal(cell.unspent)}
                              </td>
                            </React.Fragment>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="hub-salary-rosters">
            <div className="hub-salary-toolbar">
              <div className="hub-salary-toolbar-group">
                <span className="hub-filter-label">View</span>
                <div className="hub-filter-scroll">
                  <HubFilterChip active={viewMode === "focus"} onClick={() => setViewMode("focus")}>
                    Focus
                  </HubFilterChip>
                  <HubFilterChip active={viewMode === "grid"} onClick={() => setViewMode("grid")}>
                    All teams
                  </HubFilterChip>
                </div>
              </div>
              <div className="hub-salary-toolbar-group">
                <span className="hub-filter-label">Positions</span>
                <HubFilterScroll>
                  {POSITIONS.map((p) => (
                    <HubFilterChip
                      key={p}
                      active={posFilter.has(p)}
                      onClick={() => togglePosition(p)}
                    >
                      {p}
                    </HubFilterChip>
                  ))}
                </HubFilterScroll>
              </div>
              <div className="hub-salary-toolbar-group hub-salary-toolbar-toggles">
                <label className="hub-salary-toggle">
                  <input type="checkbox" checked={showDelta} onChange={(e) => setShowDelta(e.target.checked)} />
                  Show Δ
                </label>
                <label className="hub-salary-toggle">
                  <input type="checkbox" checked={showCuts} onChange={(e) => setShowCuts(e.target.checked)} />
                  Show cuts
                </label>
                <label className="hub-salary-toggle">
                  <input type="checkbox" checked={showMissing} onChange={(e) => setShowMissing(e.target.checked)} />
                  Show missing
                </label>
                {isCommissioner && (
                  <label className="hub-salary-toggle">
                    <input type="checkbox" checked={showNameMaps} onChange={(e) => setShowNameMaps(e.target.checked)} />
                    Name maps
                  </label>
                )}
                {viewMode === "grid" && (
                  <>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setAllSheetsOpen(true)}>
                      Expand all
                    </button>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setAllSheetsOpen(false)}>
                      Collapse all
                    </button>
                  </>
                )}
              </div>
            </div>

            {showNameMaps && isCommissioner && (
              <PlayerNameAliasPanel
                leagueId={leagueId}
                season={seasonYear || season}
                isCommissioner={isCommissioner}
                onUpdated={() => {
                  refreshAfterNameMap(seasonYear || season);
                }}
                mapRequest={mapRequest}
                onClearMapRequest={() => setMapRequest(null)}
              />
            )}

            <div className="hub-section-head hub-section-head--row">
              <h3 className="hub-live-section-title">
                {seasonYear} rosters
                {priorSeason ? ` (${priorSeason} → ${seasonYear})` : ""}
              </h3>
              <input
                type="search"
                className="search-input hub-salary-team-filter"
                placeholder="Filter teams…"
                value={teamFilter}
                onChange={(e) => setTeamFilter(e.target.value)}
              />
            </div>

            <div className="hub-salary-team-chips">
              <HubFilterScroll>
                {filteredSheets.map((s) => (
                  <HubFilterChip
                    key={s.owner_label}
                    active={s.owner_label === selectedOwner}
                    onClick={() => selectTeam(s.owner_label, { scroll: true })}
                  >
                    {s.owner_label}
                    <span className="table-meta"> · {fmtSal(s.totals?.committed)}</span>
                  </HubFilterChip>
                ))}
              </HubFilterScroll>
            </div>

            {viewMode === "focus" && focusSheet && (
              <div className="hub-salary-focus panel">
                <div className="hub-salary-focus-head">
                  <div className="hub-salary-focus-nav">
                    <button type="button" className="btn-ghost btn-sm" onClick={() => stepTeam(-1)} aria-label="Previous team">
                      ←
                    </button>
                    <div>
                      <strong>{teamLabel(focusSheet)}</strong>
                      <p className="table-meta">
                        {fmtSal(focusSheet.totals?.committed)} spent · {fmtSal(focusSheet.totals?.unspent)} left
                        {focusSheet.totals?.dead_cap > 0 ? ` · ${fmtSal(focusSheet.totals.dead_cap)} dead` : ""}
                        {showMissing && missingCount > 0 ? ` · ${missingCount} missing` : ""}
                      </p>
                    </div>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => stepTeam(1)} aria-label="Next team">
                      →
                    </button>
                  </div>
                  <span className="table-meta">
                    {selectedIndex + 1} / {filteredSheets.length}
                  </span>
                </div>

                {showMissing && (
                <section className="hub-salary-audit panel">
                  <div className="hub-section-head hub-section-head--row">
                    <h3 className="hub-live-section-title">Missing from {seasonYear} sheet</h3>
                    <span className="table-meta">
                      {auditLoading ? "Checking…" : `${missingPlayers.length} player${missingPlayers.length === 1 ? "" : "s"}`}
                    </span>
                  </div>
                  <p className="hub-section-hint">
                    Carryovers from {priorSeason || "prior year"} and draft wins not on this team&apos;s cap sheet.
                    {isCommissioner ? " Pick team + position, edit $ before Add. Click roster $ cells to correct salaries (DB overlay)." : ""}
                  </p>
                  <MissingPlayersPanel
                    items={missingPlayers}
                    defaultOwnerLabel={focusSheet.owner_label}
                    teamOptions={teamOwnerOptions}
                    isCommissioner={isCommissioner}
                    onAdd={addMissingPlayer}
                    busyKey={busyKey}
                  />
                </section>
                )}

                <RosterTable
                  sheet={focusSheet}
                  priorSeason={priorSeason}
                  seasonYear={seasonYear}
                  showDelta={showDelta}
                  posFilter={posFilter}
                  showCuts={showCuts}
                  isCommissioner={isCommissioner}
                  onDrop={(row) => dropPlayer(row, focusSheet.owner_label)}
                  onSaveSalary={(row, field, draft, rowKey) => saveSalary(row, field, draft, rowKey, focusSheet.owner_label)}
                  busyRowKey={busyRowKey}
                  editingSalaryKey={editingSalaryKey}
                  onStartSalaryEdit={setEditingSalaryKey}
                  onMapName={openNameMap}
                />
              </div>
            )}

            {viewMode === "grid" && (
              <div className="hub-salary-sheet-grid">
                {filteredSheets.map((sheet) => (
                  <TeamRosterSheet
                    key={sheet.owner_label}
                    sheet={sheet}
                    priorSeason={priorSeason}
                    seasonYear={seasonYear}
                    selected={sheet.owner_label === selectedOwner}
                    open={openSheets.has(sheet.owner_label)}
                    onToggle={(owner, open) => {
                      setOpenSheets((prev) => {
                        const next = new Set(prev);
                        if (open) next.add(owner);
                        else next.delete(owner);
                        return next;
                      });
                      if (open) setSelectedOwner(owner);
                    }}
                    showDelta={showDelta}
                    posFilter={posFilter}
                    showCuts={showCuts}
                    sheetRef={(el) => {
                      if (el) sheetRefs.current.set(sheet.owner_label, el);
                      else sheetRefs.current.delete(sheet.owner_label);
                    }}
                    isCommissioner={isCommissioner}
                    onDrop={(row) => dropPlayer(row, sheet.owner_label)}
                    onSaveSalary={(row, field, draft, rowKey) => saveSalary(row, field, draft, rowKey, sheet.owner_label)}
                    busyRowKey={busyRowKey}
                    editingSalaryKey={editingSalaryKey}
                    onStartSalaryEdit={setEditingSalaryKey}
                    onMapName={openNameMap}
                  />
                ))}
              </div>
            )}

            {filteredSheets.length === 0 && (
              <p className="chart-note">No teams match this filter.</p>
            )}
          </section>
        </>
      )}
    </Wrapper>
  );
}
