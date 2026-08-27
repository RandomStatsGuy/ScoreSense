import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import MobileDataList, { MobileStat } from "../MobileDataList";
import MobilePlayerCard from "../MobilePlayerCard";
import MobileBottomSheet from "../layout/MobileBottomSheet";
import HubTabIntro from "./HubTabIntro";
import { HubFilterChip, HubFilterScroll, HubPage, HubTableCard } from "./HubUILayout";
import {
  CONTRACT_TYPE_OPTIONS,
  contractTypeBadgeClass,
  contractTypeLabel,
  fmtSal,
  leagueStepUp,
  contractScheduleHint,
  previewSchedule,
  scheduleText,
  seasonCapYearHint,
  YEARS_LEFT_HINT,
} from "./rosterFormat";
import {
  canManagerRookieExtend,
  hasPendingExtension,
  postRookieExtend,
  previewRookieExtendStartSalary,
  rookieExtendSuccessMessage,
} from "./rookieExtend";
import ContractHistoryLink from "./ContractHistoryLink";

const TEAM_LOGO_ALIASES = { JAX: "jax", JAC: "jax", LA: "lar", LAR: "lar", WSH: "wsh", WAS: "wsh" };

function teamLogoUrl(team) {
  const abbr = String(team || "").trim().toUpperCase();
  if (!abbr) return null;
  const slug = TEAM_LOGO_ALIASES[abbr] || abbr.toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${slug}.png`;
}

function posSortKey(position) {
  const pos = normalizeHubPosition(position);
  const idx = HUB_POS_ORDER.indexOf(pos);
  return idx >= 0 ? idx : HUB_POS_ORDER.length;
}

function rosterStatusInfo(r, { draftCompleted, ctype, pendingType, pendingExt }) {
  if (r.roster_status === "cut_before_draft") {
    return { label: "Cut before draft", tone: "cut" };
  }
  if (pendingExt) return { label: "Extension queued", tone: "pending" };
  if (pendingType) return { label: "Pending type", tone: "pending" };
  const yrsLeft = Number(r.contract?.years_remaining ?? r.contract_years ?? 1);
  if (!draftCompleted && yrsLeft <= 1) {
    return ctype === "rookie"
      ? { label: "Extend?", tone: "warn" }
      : { label: "Expires — FA", tone: "warn" };
  }
  if (yrsLeft === 1) return { label: "Final year", tone: "warn" };
  return { label: "Active", tone: "ok" };
}

function ContractRulesDisclosure({
  contractsReadOnly,
  isLeague,
  isCommissioner,
  officeLink,
  defaultStepUp,
  maxYears,
  rules,
  season,
  draftCompleted,
}) {
  return (
    <details className="hub-roster-contract-rules">
      <summary>Contract rules</summary>
      <div className="hub-roster-contract-rules-body chart-note">
        {contractsReadOnly && isLeague ? (
          <>
            <p>
              Salary, years, and type are edited in Roster management → Contracts only
              {isCommissioner
                ? <> — {officeLink || "use Roster management → Contracts to edit"}.</>
                : ". Commissioners edit those fields in Roster management."}
            </p>
            <p>
              Before draft, eligible final-year contracts can queue one 1–{Math.max(1, Number(maxYears) || 3)} year extension
              (start salary = current + ${defaultStepUp}).
            </p>
          </>
        ) : (
          <p title={seasonCapYearHint(season)}>
            {contractScheduleHint(defaultStepUp, rules)}
            {!draftCompleted && " · Final-year deals expire before draft (rookies can extend once)"}
          </p>
        )}
        <p>{YEARS_LEFT_HINT}</p>
        {!contractsReadOnly && (
          <p>{seasonCapYearHint(season)}</p>
        )}
      </div>
    </details>
  );
}

function ContractSidePanelBody({
  r,
  season,
  contractsReadOnly,
  canEditType,
  draftCompleted,
  readOnly,
  edit,
  setEdit,
  ctype,
  pendingType,
  pendingExt,
  inferredMeta,
  livePreview,
  isSaving,
  justSaved,
  extendEligible,
  extendStart,
  extendYearsFor,
  setExtendYearsById,
  saveRow,
  saveContractType,
  queueRookieExtend,
  toggleCut,
  remove,
  maxYears,
  status,
  onOpenContractHistory,
}) {
  const isCut = r.roster_status === "cut_before_draft";

  return (
    <div className="hub-roster-contract-panel-body">
      <div className="hub-roster-contract-panel-meta">
        <div className="hub-roster-contract-panel-identity">
          <strong>{r.player_name}</strong>
          <span className="chart-note">
            {[r.team, normalizeHubPosition(r.position) || r.position].filter(Boolean).join(" · ") || "—"}
          </span>
        </div>
        <span className={`hub-roster-status hub-roster-status--${status.tone}`}>{status.label}</span>
      </div>

      <div className="hub-roster-contract-panel-grid">
        {canEditType ? (
          <label className="hub-roster-mobile-field">
            <span className="mobile-stat-label">Contract type</span>
            <select
              className="hub-roster-edit-input"
              value={pendingType || ctype}
              disabled={isSaving}
              onChange={(e) => saveContractType(r, e.target.value)}
            >
              {CONTRACT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        ) : (
          <div className="hub-roster-contract-panel-stat">
            <span className="mobile-stat-label">Contract type</span>
            <span className={contractTypeBadgeClass(ctype)}>{contractTypeLabel(ctype)}</span>
            {inferredMeta && <span className="hub-contract-infer-meta">Auto · {inferredMeta}</span>}
          </div>
        )}

        {contractsReadOnly ? (
          <div className="hub-roster-contract-panel-stat">
            <span className="mobile-stat-label">Cap hit ({season})</span>
            <strong>{fmtSal(edit.salary)}</strong>
          </div>
        ) : (
          <label className="hub-roster-mobile-field">
            <span className="mobile-stat-label">Cap hit ({season})</span>
            <input
              type="number"
              className="hub-roster-edit-input"
              min={0}
              step={1}
              value={edit.salary}
              disabled={isSaving}
              onChange={(e) => setEdit(r.player_id, { salary: e.target.value })}
              onBlur={() => saveRow(r)}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            />
          </label>
        )}

        {contractsReadOnly ? (
          <div className="hub-roster-contract-panel-stat">
            <span className="mobile-stat-label">Years left</span>
            <strong>{edit.years}</strong>
          </div>
        ) : (
          <label className="hub-roster-mobile-field">
            <span className="mobile-stat-label">Years left</span>
            <input
              type="number"
              className="hub-roster-edit-input hub-roster-edit-input-sm"
              min={1}
              max={maxYears}
              step={1}
              value={edit.years}
              disabled={isSaving}
              onChange={(e) => setEdit(r.player_id, { years: e.target.value })}
              onBlur={() => saveRow(r)}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            />
          </label>
        )}
      </div>

      <div className="hub-roster-contract-panel-stat hub-roster-contract-panel-schedule">
        <span className="mobile-stat-label">Schedule</span>
        <strong className="hub-schedule-preview">{livePreview || "—"}</strong>
      </div>

      {(pendingType || pendingExt) && (
        <p className="chart-note">
          {pendingType ? "Type change pending commissioner approval. " : ""}
          {pendingExt ? "Extension is queued for commissioner apply." : ""}
        </p>
      )}

      {!contractsReadOnly && (
        <div className="hub-roster-contract-panel-save" aria-live="polite">
          {isSaving && <span className="hub-roster-save-hint">Saving…</span>}
          {!isSaving && justSaved && (
            <span className="hub-roster-save-hint hub-roster-save-ok">Saved</span>
          )}
        </div>
      )}

      <div className="hub-roster-contract-panel-actions">
        {extendEligible && (
          <>
            <label className="hub-roster-extend-years">
              <span className="sr-only">Extension years</span>
              <select
                className="hub-roster-edit-input hub-roster-edit-input-sm"
                value={extendYearsFor(r)}
                disabled={isSaving}
                onChange={(e) => setExtendYearsById((prev) => ({
                  ...prev,
                  [r.player_id]: e.target.value,
                }))}
                aria-label={`Extension years for ${r.player_name}`}
              >
                {Array.from({ length: maxYears }, (_, index) => index + 1).map((years) => (
                  <option key={years} value={years}>{years} yr</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={isSaving}
              title={extendStart != null ? `Starts at ${fmtSal(extendStart)}` : undefined}
              onClick={() => queueRookieExtend(r)}
            >
              Queue extension
            </button>
          </>
        )}
        {!draftCompleted && (
          <button
            type="button"
            className={`btn-ghost btn-sm${isCut ? " hub-uncut-btn" : ""}`}
            disabled={isSaving}
            onClick={() => toggleCut(r, !isCut)}
          >
            {isCut ? "Undo cut" : "Cut pre-draft"}
          </button>
        )}
        {!readOnly && (
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={isSaving}
            onClick={() => remove(r.player_id)}
          >
            Remove
          </button>
        )}
        <ContractHistoryLink
          playerId={r.player_id}
          playerName={r.player_name}
          onOpen={onOpenContractHistory}
        />
      </div>
    </div>
  );
}

export default function RosterBuilder({
  roster,
  onChanged,
  valueRows,
  sleeper,
  workspace,
  hubContext,
  capSheet,
  readOnly = false,
  showManagerTeam = false,
  onEditInOffice,
  onOpenContractHistory,
}) {
  const [playerId, setPlayerId] = useState("");
  const [salary, setSalary] = useState("");
  const [years, setYears] = useState(1);
  const [error, setError] = useState("");
  const [mediaById, setMediaById] = useState({});
  const [draftEdits, setDraftEdits] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState("ALL");
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);

  const [typeOverrides, setTypeOverrides] = useState({});
  const [extendYearsById, setExtendYearsById] = useState({});

  const mobileLayout = useMobileLayout();
  const maxYears = Math.max(1, Number(workspace?.rules?.contracts?.max_years ?? 3) || 3);
  const defaultStepUp = leagueStepUp(workspace?.rules);
  const salaryCap = Number(workspace?.rules?.salary_cap ?? 200);
  const season = workspace?.season ?? new Date().getFullYear();
  const draftCompleted = Boolean(hubContext?.draft_completed);
  const preDraft = !draftCompleted ? capSheet?.pre_draft : null;
  const linked = Boolean(sleeper?.sleeper_league_id && sleeper?.sleeper_roster_id);
  const teamName = sleeper?.sleeper_team_name;
  const isLeague = hubContext?.mode === "league";
  const isCommissioner = Boolean(hubContext?.is_commissioner || hubContext?.can_edit_salaries);
  // SCORE-41: league My Team never edits salary/years/type — Roster management is the arbitrary editor.
  // SCORE-42: managers may still queue a server-calculated rookie extension for their own eligible rookies.
  const contractsReadOnly = isLeague || readOnly;
  const canEditType = !contractsReadOnly;

  const isSleeperPlayer = (r) => r.source === "sleeper" || Boolean(r.sleeper_player_id);
  const lookup = valueRows?.find((r) => r.player_id === playerId);

  const sortedRoster = useMemo(
    () => [...(roster || [])].sort(
      (a, b) => posSortKey(a.position) - posSortKey(b.position)
        || String(a.player_name).localeCompare(String(b.player_name)),
    ),
    [roster],
  );

  const filteredRoster = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sortedRoster.filter((r) => {
      if (posFilter !== "ALL" && normalizeHubPosition(r.position) !== posFilter) return false;
      if (!q) return true;
      const name = String(r.player_name || "").toLowerCase();
      const team = String(r.team || "").toLowerCase();
      const pos = String(r.position || "").toLowerCase();
      return name.includes(q) || team.includes(q) || pos.includes(q);
    });
  }, [search, posFilter, sortedRoster]);

  const posCounts = useMemo(() => {
    const counts = {};
    for (const row of roster || []) {
      const pos = String(row.position || "?").toUpperCase();
      counts[pos] = (counts[pos] || 0) + 1;
    }
    return counts;
  }, [roster]);

  const totalSalary = useMemo(() => {
    if (preDraft) return preDraft.season_committed;
    return (roster || []).reduce((sum, r) => sum + Number(r.salary || 0), 0);
  }, [preDraft, roster]);

  const selectedRow = useMemo(
    () => (selectedPlayerId ? (roster || []).find((r) => r.player_id === selectedPlayerId) : null),
    [roster, selectedPlayerId],
  );

  const closeContractPanel = useCallback(() => setSelectedPlayerId(null), []);

  const toggleCut = useCallback(async (r, cut) => {
    setSavingId(r.player_id);
    setError("");
    try {
      const res = await apiFetch("/api/hub/roster", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player_id: r.player_id,
          roster_status: cut ? "cut_before_draft" : "active",
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      onChanged?.();
    } catch (e) {
      setError(e.message || "Could not update cut status");
    } finally {
      setSavingId(null);
    }
  }, [onChanged]);

  useEffect(() => {
    if (!roster?.length) {
      setMediaById({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/hub/draft-room/enrichment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            season: workspace?.season,
            players: roster.map((r) => ({
              player_id: r.player_id,
              player_name: r.player_name,
              team: r.team,
              position: r.position,
            })),
          }),
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setMediaById(data.media_by_player_id || {});
      } catch {
        if (!cancelled) setMediaById({});
      }
    })();
    return () => { cancelled = true; };
  }, [roster, workspace?.season]);

  useEffect(() => {
    setDraftEdits({});
    setTypeOverrides({});
    setExtendYearsById({});
  }, [roster]);

  useEffect(() => {
    if (selectedPlayerId && !(roster || []).some((r) => r.player_id === selectedPlayerId)) {
      setSelectedPlayerId(null);
    }
  }, [roster, selectedPlayerId]);

  useEffect(() => {
    if (!selectedRow || mobileLayout) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") closeContractPanel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedRow, mobileLayout, closeContractPanel]);

  const getEdit = useCallback((r) => {
    const d = draftEdits[r.player_id];
    if (d) return d;
    return {
      salary: String(r.salary ?? ""),
      years: String(r.contract?.years_remaining ?? r.contract_years ?? 1),
    };
  }, [draftEdits]);

  const setEdit = (pid, patch) => {
    setDraftEdits((prev) => {
      const row = roster.find((x) => x.player_id === pid);
      const base = prev[pid] || {
        salary: String(row?.salary ?? ""),
        years: String(row?.contract?.years_remaining ?? row?.contract_years ?? 1),
      };
      return { ...prev, [pid]: { ...base, ...patch } };
    });
  };

  const extendYearsFor = useCallback((r) => {
    const raw = extendYearsById[r.player_id];
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1 && n <= maxYears) return n;
    return 1;
  }, [extendYearsById, maxYears]);

  const queueRookieExtend = useCallback(async (r) => {
    setSavingId(r.player_id);
    setError("");
    try {
      const data = await postRookieExtend(r.player_id, extendYearsFor(r), maxYears);
      setError(rookieExtendSuccessMessage(data));
      setTimeout(() => setError(""), 4000);
      onChanged?.();
    } catch (e) {
      setError(e.message || "Could not queue extension");
    } finally {
      setSavingId(null);
    }
  }, [extendYearsFor, maxYears, onChanged]);

  const saveRow = useCallback(async (r) => {
    if (hubContext?.mode === "league") return;
    const edit = getEdit(r);
    const nextSal = Number(edit.salary);
    const nextYears = Number(edit.years);
    const curSal = Number(r.salary);
    const curYears = Number(r.contract?.years_remaining ?? r.contract_years ?? 1);
    if (nextSal === curSal && nextYears === curYears) return;

    setSavingId(r.player_id);
    setError("");
    setSavedId(null);
    try {
      const res = await apiFetch("/api/hub/roster", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player_id: r.player_id,
          salary: Number.isFinite(nextSal) ? nextSal : curSal,
          contract_years: Number.isFinite(nextYears) ? nextYears : curYears,
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      setSavedId(r.player_id);
      setTimeout(() => setSavedId((id) => (id === r.player_id ? null : id)), 1500);
      onChanged?.();
    } catch (e) {
      setError(e.message || "Could not save changes");
    } finally {
      setSavingId(null);
    }
  }, [getEdit, onChanged, hubContext?.mode]);

  const saveContractType = useCallback(async (r, nextType) => {
    if (hubContext?.mode === "league") return;
    const cur = String(r.contract?.contract_type || "veteran");
    if (nextType === cur && !r.contract?.pending_type) return;
    setTypeOverrides((prev) => ({ ...prev, [r.player_id]: nextType }));
    setSavingId(r.player_id);
    setError("");
    try {
      const res = await apiFetch("/api/hub/roster/contract-type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: r.player_id, contract_type: nextType }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      const savedType = data.saved_contract_type
        || data.slot?.contract?.contract_type
        || (data.pending_type ? nextType : null);
      if (!data.pending_type && savedType !== nextType) {
        throw new Error(
          `Type did not save (still ${savedType || "unknown"}; received ${data.received_contract_type || "?"})`,
        );
      }
      setTypeOverrides((prev) => ({ ...prev, [r.player_id]: data.pending_type ? cur : savedType }));
      setSavedId(r.player_id);
      setTimeout(() => setSavedId((id) => (id === r.player_id ? null : id)), 1500);
      await onChanged?.();
      if (data.pending_type) {
        setError("Submitted — waiting on commissioner.");
        setTimeout(() => setError(""), 2500);
      }
    } catch (e) {
      setTypeOverrides((prev) => {
        const next = { ...prev };
        delete next[r.player_id];
        return next;
      });
      setError(e.message || "Could not update contract type");
    } finally {
      setSavingId(null);
    }
  }, [onChanged, hubContext?.mode]);

  const remove = async (pid) => {
    const res = await apiFetch("/api/hub/roster", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player_id: pid }),
    });
    if (!res.ok) setError(await parseApiError(res));
    else {
      if (selectedPlayerId === pid) setSelectedPlayerId(null);
      onChanged?.();
    }
  };

  const addManual = async () => {
    if (hubContext?.mode === "league") return;
    setError("");
    const row = lookup;
    if (!row) {
      setError("Pick a player from the value sheet list first.");
      return;
    }
    const res = await apiFetch("/api/hub/roster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        player_id: row.player_id,
        player_name: row.player,
        team: row.team,
        position: row.position,
        salary: Number(salary) || row.model_bid_hint || 1,
        contract_years: Number(years) || 1,
      }),
    });
    if (!res.ok) setError(await parseApiError(res));
    else {
      setPlayerId("");
      setSalary("");
      onChanged?.();
    }
  };

  const officeLink = isCommissioner && onEditInOffice ? (
    <button type="button" className="btn-link" onClick={onEditInOffice}>
      Edit in roster management
    </button>
  ) : null;

  const rowViewModel = useCallback((r) => {
    const edit = getEdit(r);
    const ctype = String(typeOverrides[r.player_id] || r.contract?.contract_type || "veteran");
    const pendingType = r.contract?.pending_type;
    const pendingExt = hasPendingExtension(r);
    const storedSchedule = scheduleText(r, workspace?.rules);
    const livePreview = contractsReadOnly
      ? storedSchedule
      : (previewSchedule(
        edit.salary,
        edit.years,
        defaultStepUp,
        ctype,
        workspace?.rules?.contracts?.rookie_salary_static !== false,
      ) || storedSchedule);
    const status = rosterStatusInfo(r, { draftCompleted, ctype, pendingType, pendingExt });
    const extendEligible = canManagerRookieExtend(r, { draftCompleted, rules: workspace?.rules }).ok;
    const extendStart = extendEligible
      ? previewRookieExtendStartSalary(r, workspace?.rules)
      : null;
    const inferredMeta = !r.contract?.contract_type_manual && r.contract?.inferred_from
      ? String(r.contract.inferred_from).replace("nfl_yr_", "NFL yr ")
      : null;
    return {
      edit,
      ctype,
      pendingType,
      pendingExt,
      livePreview,
      status,
      extendEligible,
      extendStart,
      inferredMeta,
      isSaving: savingId === r.player_id,
      justSaved: savedId === r.player_id,
    };
  }, [
    getEdit,
    typeOverrides,
    workspace?.rules,
    contractsReadOnly,
    defaultStepUp,
    draftCompleted,
    savingId,
    savedId,
  ]);

  const colSpan = showManagerTeam ? 7 : 6;

  const panelProps = selectedRow ? (() => {
    const vm = rowViewModel(selectedRow);
    return {
      r: selectedRow,
      season,
      contractsReadOnly,
      canEditType,
      draftCompleted,
      readOnly,
      edit: vm.edit,
      setEdit,
      ctype: vm.ctype,
      pendingType: vm.pendingType,
      pendingExt: vm.pendingExt,
      inferredMeta: vm.inferredMeta,
      livePreview: vm.livePreview,
      isSaving: vm.isSaving,
      justSaved: vm.justSaved,
      extendEligible: vm.extendEligible,
      extendStart: vm.extendStart,
      extendYearsFor,
      setExtendYearsById,
      saveRow,
      saveContractType,
      queueRookieExtend,
      toggleCut,
      remove,
      maxYears,
      status: vm.status,
      onOpenContractHistory,
    };
  })() : null;

  return (
    <HubPage className="hub-roster-builder">
      <HubTabIntro
        title="Roster"
        compact
        learnMore={
          contractsReadOnly
            ? (
              <p>
                {isLeague
                  ? "Salary, years, and type are edited in Roster management → Contracts only. Eligible final-year contracts can still queue one extension here."
                  : "Read-only — ask commish to edit."}
                {officeLink ? <> {officeLink}</> : null}
              </p>
            )
            : null
        }
      />

      <div className="hub-roster-hero">
        <div className="hub-roster-hero-top">
          {linked && teamName && (
            <div className="hub-roster-team-banner">
              <span className="hub-roster-team-avatar" aria-hidden="true">
                {teamName.slice(0, 2).toUpperCase()}
              </span>
              <div>
                <div className="hub-roster-team-name">{teamName}</div>
                <div className="hub-roster-team-meta">
                  {roster.length} players
                  {roster.filter(isSleeperPlayer).length > 0
                    ? ` · ${roster.filter(isSleeperPlayer).length} from Sleeper`
                    : ""}
                </div>
              </div>
            </div>
          )}
          <div className="hub-stat-card hub-stat-card--accent" style={{ minWidth: "9rem" }}>
            <span className="hub-stat-label">Cap ({season})</span>
            <strong className="hub-stat-value">
              ${totalSalary.toFixed(0)}
              <span className="hub-stat-value-note"> / ${salaryCap}</span>
            </strong>
            {preDraft && (
              <span className="hub-stat-sub">
                ${preDraft.draft_budget_available?.toFixed(0)} for draft
              </span>
            )}
          </div>
        </div>
        <div className="hub-chip-row">
          {HUB_POS_ORDER.filter((p) => posCounts[p]).map((pos) => (
            <span key={pos} className="hub-pos-chip">
              {pos} <strong>{posCounts[pos]}</strong>
            </span>
          ))}
        </div>
      </div>

      <ContractRulesDisclosure
        contractsReadOnly={contractsReadOnly}
        isLeague={isLeague}
        isCommissioner={isCommissioner}
        officeLink={officeLink}
        defaultStepUp={defaultStepUp}
        maxYears={maxYears}
        rules={workspace?.rules}
        season={season}
        draftCompleted={draftCompleted}
      />

      {!contractsReadOnly && (
      <details className="hub-roster-add">
        <summary>Add player manually</summary>
        <div className="hub-form-row hub-roster-add-row">
          <label>
            Player
            <select value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
              <option value="">Select…</option>
              {(valueRows || []).slice(0, 300).map((r) => (
                <option key={r.player_id} value={r.player_id}>{r.player} ({r.position})</option>
              ))}
            </select>
          </label>
          <label>
            Cap hit ($)
            <input type="number" min={0} value={salary} onChange={(e) => setSalary(e.target.value)} placeholder={lookup?.model_bid_hint || "1"} />
          </label>
          <label>
            Years left
            <input type="number" min={1} max={maxYears} value={years} onChange={(e) => setYears(e.target.value)} />
          </label>
          <button type="button" className="btn-primary" onClick={addManual}>Add</button>
        </div>
      </details>
      )}

      {contractsReadOnly && !isLeague && !mobileLayout && (
        <p className="chart-note">Salaries set by commish. Sync Sleeper after trades.</p>
      )}

      {error && (
        <div className={/queued|already queued/i.test(error) ? "hub-msg" : "error"}>
          {error}
        </div>
      )}

      <div className="hub-filter-bar hub-roster-pos-bar">
        <input
          type="search"
          className={`search-input hub-filter-search${mobileLayout ? " hub-roster-mobile-search" : ""}`}
          placeholder="Search roster…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search roster"
        />
        <HubFilterScroll>
          {HUB_POSITION_FILTERS.map((p) => (
            <HubFilterChip
              key={p}
              active={posFilter === p}
              onClick={() => setPosFilter(p)}
            >
              {p === "ALL" ? "All" : p}
            </HubFilterChip>
          ))}
        </HubFilterScroll>
      </div>

      <HubTableCard className="hub-roster-table-wrap">
        {mobileLayout ? (
          <MobileDataList
            emptyMessage={
              !filteredRoster.length
                ? (sortedRoster.length
                  ? "No players match these filters."
                  : "No players. Link Sleeper or add from Players.")
                : null
            }
          >
            {filteredRoster.map((r) => {
              const vm = rowViewModel(r);
              return (
                <MobilePlayerCard
                  key={r.player_id}
                  className={`${isSleeperPlayer(r) ? "hub-sleeper-row" : ""}${r.roster_status === "cut_before_draft" ? " hub-cut-row" : ""}`.trim()}
                  name={r.player_name}
                  meta={[r.team, normalizeHubPosition(r.position)].filter(Boolean).join(" · ") || "—"}
                  heroValue={fmtSal(vm.edit.salary)}
                  heroLabel="cap"
                  badge={(
                    <>
                      {isSleeperPlayer(r) && <span className="hub-sleeper-badge">Sleeper</span>}
                      <span className={`hub-roster-status hub-roster-status--${vm.status.tone}`}>
                        {vm.status.label}
                      </span>
                    </>
                  )}
                  expanded={(
                    <div className="mobile-stat-grid hub-roster-mobile-grid">
                      <MobileStat label="Pos" value={normalizeHubPosition(r.position) || r.position || "—"} />
                      <MobileStat label={`Cap hit (${season})`} value={fmtSal(vm.edit.salary)} />
                      <MobileStat label="Yrs left" value={vm.edit.years} />
                      <MobileStat label="Status" value={vm.status.label} />
                      {showManagerTeam && (
                        <MobileStat label="Manager" value={r.manager_team || "—"} />
                      )}
                    </div>
                  )}
                  actions={(
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => setSelectedPlayerId(r.player_id)}
                    >
                      Contract
                    </button>
                    <ContractHistoryLink
                      playerId={r.player_id}
                      playerName={r.player_name}
                      onOpen={onOpenContractHistory}
                    />
                  )}
                />
              );
            })}
          </MobileDataList>
        ) : (
        <div className="table-wrap">
          <table className="data-table hub-table hub-roster-table">
          <thead>
            <tr>
              <th className="hub-roster-col-player">Player</th>
              {showManagerTeam && <th className="hub-roster-col-manager">Manager</th>}
              <th className="hub-roster-col-pos">Pos</th>
              <th className="num hub-roster-col-cap">Cap hit ({season})</th>
              <th className="num hub-roster-col-years">Years</th>
              <th className="hub-roster-col-status">Status</th>
              <th className="hub-roster-actions">Contract</th>
            </tr>
          </thead>
          <tbody>
            {filteredRoster.map((r) => {
              const media = mediaById[r.player_id] || {};
              const logo = media.team_logo_url || teamLogoUrl(r.team);
              const thumb = media.headshot_url || logo;
              const vm = rowViewModel(r);
              const isCut = r.roster_status === "cut_before_draft";
              const selected = selectedPlayerId === r.player_id;
              return (
                <tr
                  key={r.player_id}
                  className={`${isSleeperPlayer(r) ? "hub-sleeper-row" : ""}${isCut ? " hub-cut-row" : ""}${selected ? " hub-roster-row--selected" : ""}`}
                >
                  <td className="hub-roster-col-player">
                    <button
                      type="button"
                      className="hub-roster-player-open"
                      onClick={() => setSelectedPlayerId(r.player_id)}
                    >
                      <div className="hub-roster-player-cell">
                        {thumb ? (
                          <img
                            className="hub-roster-player-thumb"
                            src={thumb}
                            alt=""
                            onError={(e) => {
                              if (logo && e.currentTarget.src !== logo) e.currentTarget.src = logo;
                              else e.currentTarget.style.visibility = "hidden";
                            }}
                          />
                        ) : (
                          <span className="hub-roster-player-thumb hub-roster-player-thumb-empty" />
                        )}
                        <div className="hub-roster-player-text">
                          <span className="hub-roster-player-name">{r.player_name}</span>
                          <span className="hub-roster-player-team">
                            {logo && (
                              <img className="hub-roster-inline-logo" src={logo} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                            )}
                            {r.team || "—"}
                            {isSleeperPlayer(r) && <span className="hub-sleeper-badge">Sleeper</span>}
                          </span>
                        </div>
                      </div>
                    </button>
                  </td>
                  {showManagerTeam && <td className="hub-roster-col-manager">{r.manager_team || "—"}</td>}
                  <td className="hub-roster-col-pos"><span className="hub-roster-pos-tag">{normalizeHubPosition(r.position) || r.position || "—"}</span></td>
                  <td className="num hub-roster-col-cap">{fmtSal(vm.edit.salary)}</td>
                  <td className="num hub-roster-col-years">{vm.edit.years}</td>
                  <td className="hub-roster-col-status">
                    <span className={`hub-roster-status hub-roster-status--${vm.status.tone}`}>
                      {vm.status.label}
                    </span>
                  </td>
                  <td className="hub-roster-actions">
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => setSelectedPlayerId(r.player_id)}
                    >
                      Contract
                    </button>
                    <ContractHistoryLink
                      playerId={r.player_id}
                      playerName={r.player_name}
                      onOpen={onOpenContractHistory}
                    />
                  </td>
                </tr>
              );
            })}
            {!sortedRoster.length && (
              <tr>
                <td colSpan={colSpan} className="chart-note hub-roster-empty">
                  No players yet. Link Sleeper in Setup or add from Values.
                </td>
              </tr>
            )}
            {Boolean(sortedRoster.length) && !filteredRoster.length && (
              <tr>
                <td colSpan={colSpan} className="chart-note hub-roster-empty">
                  No players match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        )}
      </HubTableCard>

      {panelProps && mobileLayout && (
        <MobileBottomSheet
          open
          onClose={closeContractPanel}
          title={`Contract · ${selectedRow.player_name}`}
          className="app-mobile-sheet-contract-edit"
        >
          <ContractSidePanelBody {...panelProps} />
        </MobileBottomSheet>
      )}

      {panelProps && !mobileLayout && (
        <div
          className="hub-roster-side-panel-overlay"
          role="presentation"
          onClick={closeContractPanel}
        >
          <aside
            className="hub-roster-side-panel panel"
            role="dialog"
            aria-label={`Contract for ${selectedRow.player_name}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="hub-roster-side-panel-head">
              <h3 className="hub-roster-side-panel-title">Contract</h3>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={closeContractPanel}
                aria-label="Close contract panel"
              >
                Close
              </button>
            </div>
            <ContractSidePanelBody {...panelProps} />
          </aside>
        </div>
      )}
    </HubPage>
  );
}
