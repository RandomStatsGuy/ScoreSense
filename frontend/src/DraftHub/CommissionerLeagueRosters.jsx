import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import MobileDataList, { MobileStat } from "../MobileDataList";
import MobilePlayerCard from "../MobilePlayerCard";
import { HubFilterMenu } from "./HubUILayout";
import LeagueSleeperConnect from "./LeagueSleeperConnect";
import { hubTeamLabel, hubTeamParts } from "./hubTeamLabel";
import {
  getAnyLeagueRostersCache,
  setLeagueRostersCache,
} from "./hubDataCache";
import {
  CONTRACT_TYPE_OPTIONS,
  contractTypeBadgeClass,
  contractTypeLabel,
  fmtSal,
  leagueStepUp,
  previewSchedule,
  scheduleText,
} from "./rosterFormat";
import {
  findLiveContractTarget,
  liveContractStage,
  matchLiveRosterPlayer,
} from "./officeCurrentContracts";
import {
  OFFICE_CONTRACTS_COPY,
  applyPendingToBlock,
  applyPendingToRow,
  capFieldFigures,
  contractStateChip,
  contractStateClass,
  cutButtonCopy,
  dropButtonCopy,
  mergePendingChange,
  pendingNeedsOverrideNote,
  pendingTraySummary,
  rowType,
  rowYears,
  salaryRoomForRow,
  summarizePending,
  teamCapStats,
  validatePendingForTeam,
  validateSalaryValue,
} from "./officeContractsPresentation";
import { setOfficeUnsavedGuard } from "./officeUnsavedGuard";
import { confirmDialog } from "../ui/confirm";
import { markDraftComplete, MARK_DRAFT_COMPLETE_COPY } from "./markDraftComplete";
import { promptDialog } from "../ui/prompt";
import {
  buildLiveRosterAddBody,
  isRosterReassignConflict,
} from "./liveRosterAdd";
import { sendRosterWrite } from "./rosterWrite";

const POS_ORDER = ["QB", "RB", "WR", "TE"];

function posSortKey(position) {
  const pos = String(position || "").toUpperCase();
  const idx = POS_ORDER.indexOf(pos);
  return idx >= 0 ? idx : POS_ORDER.length;
}

function StageColHead({ label, sub }) {
  return (
    <span className="hub-col-head">
      <span>{label}</span>
      {sub ? <span className="hub-col-sub">{sub}</span> : null}
    </span>
  );
}

function LiveContractStageBanner({ stage }) {
  if (!stage) return null;
  const rules = stage.draftRules?.length ? stage.draftRules : [stage.draftImpact].filter(Boolean);
  return (
    <details
      className={`hub-live-contract-stage hub-live-contract-stage--${stage.phase}`}
      aria-label={stage.headline}
    >
      <summary>{stage.headline}</summary>
      {rules.length > 0 && (
        <ul className="hub-live-contract-rules">
          {rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

function RowOverflow({ label, children }) {
  return (
    <details className="hub-row-overflow">
      <summary className="hub-row-overflow-summary">{label}</summary>
      <div className="hub-row-overflow-menu">{children}</div>
    </details>
  );
}

function StateChips({ chip, pendingType, inferredMeta }) {
  return (
    <>
      {pendingType && <span className="hub-sleeper-badge hub-pending-badge">Pending</span>}
      {inferredMeta && <span className="hub-contract-infer-meta">Auto · {inferredMeta}</span>}
      {chip && <span className={contractStateClass(chip.tone)}>{chip.label}</span>}
    </>
  );
}

function AddPlayerForm({
  leagueId,
  season,
  teamId,
  teamName,
  maxYears,
  maxSalary,
  remaining,
  stage,
  onSaved,
  onError,
  onNotice,
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [salary, setSalary] = useState("1");
  const [years, setYears] = useState("1");
  const [contractType, setContractType] = useState("veteran");
  const [openList, setOpenList] = useState(false);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const abortRef = useRef(null);
  const salaryMax = Number.isFinite(Number(maxSalary)) ? Number(maxSalary) : remaining;
  const salaryError = validateSalaryValue(salary, salaryMax);

  useEffect(() => {
    const q = query.trim();
    if (selected && q === selected.player_name) {
      setSuggestions([]);
      setOpenList(false);
      return undefined;
    }
    if (q.length < 2 || !leagueId) {
      setSuggestions([]);
      setSearching(false);
      return undefined;
    }
    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ name: q });
        if (season) params.set("season", String(season));
        const res = await apiFetch(
          `/api/hub/league/${encodeURIComponent(leagueId)}/player-name-aliases/suggest?${params}`,
          { signal: ctrl.signal },
        );
        if (!res.ok) throw new Error(await parseApiError(res));
        const data = await res.json();
        const rows = (data.suggestions || []).filter(
          (s) => s.sleeper_player_id || s.player_id,
        );
        setSuggestions(rows);
        setOpenList(true);
      } catch (e) {
        if (e?.name === "AbortError") return;
        setSuggestions([]);
        onError?.(connectionErrorMessage(e));
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, leagueId, season, selected, onError]);

  const pickSuggestion = (row) => {
    setSelected(row);
    setQuery(row.player_name || "");
    setSuggestions([]);
    setOpenList(false);
    onError?.("");
  };

  const resetForm = () => {
    setQuery("");
    setSelected(null);
    setSuggestions([]);
    setSalary("1");
    setYears("1");
    setContractType("veteran");
    setOpenList(false);
  };

  const submit = async ({ force = false } = {}) => {
    if (salaryError) {
      onError?.(salaryError);
      return;
    }
    const body = buildLiveRosterAddBody({
      suggestion: selected,
      salary,
      years,
      contractType,
      teamId,
      force,
    });
    if (!body) {
      onError?.("Search and pick a player, then set salary and years.");
      return;
    }
    if (!force) setAdding(true);
    onError?.("");
    try {
      const res = await apiFetch("/api/hub/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        const msg = await parseApiError(res);
        if (!force && isRosterReassignConflict(msg)) {
          const ok = await confirmDialog({
            title: "Player already rostered",
            message: msg,
            confirmLabel: `Move to ${teamName}`,
            danger: true,
          });
          if (ok) {
            await submit({ force: true });
          }
          return;
        }
        throw new Error(msg);
      }
      if (!res.ok) throw new Error(await parseApiError(res));
      onNotice?.(`Added ${body.player_name} to ${teamName}.`);
      resetForm();
      onSaved?.({ syncHub: true });
    } catch (e) {
      onError?.(connectionErrorMessage(e));
    } finally {
      if (!force) setAdding(false);
    }
  };

  return (
    <div className="hub-league-add-player">
      <h4 className="hub-league-add-player-title">Add player</h4>
      <div className="hub-league-add-player-grid">
        <label className="hub-league-add-search">
          <span>Player</span>
          <input
            type="text"
            className="search-input"
            role="combobox"
            aria-expanded={openList && suggestions.length > 0}
            aria-autocomplete="list"
            autoComplete="off"
            placeholder="Search NFL players…"
            value={query}
            disabled={adding}
            onChange={(e) => {
              setSelected(null);
              setQuery(e.target.value);
            }}
            onFocus={() => { if (suggestions.length) setOpenList(true); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpenList(false);
              if (e.key === "Enter" && suggestions[0] && !selected) {
                e.preventDefault();
                pickSuggestion(suggestions[0]);
              }
            }}
          />
          {searching && <span className="hub-league-add-search-status">Searching…</span>}
          {openList && suggestions.length > 0 && (
            <ul className="hub-league-suggest" role="listbox">
              {suggestions.slice(0, 8).map((row) => (
                <li key={`${row.sleeper_player_id || row.player_id}-${row.player_name}`}>
                  <button
                    type="button"
                    className="hub-league-suggest-item"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickSuggestion(row)}
                  >
                    <strong>{row.player_name}</strong>
                    <span>
                      {[row.position, row.team].filter(Boolean).join(" · ") || row.source || "player"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </label>
        <HubFilterMenu
          label="Type"
          value={contractType}
          options={CONTRACT_TYPE_OPTIONS.map((o) => ({ id: o.value, label: o.label }))}
          onChange={setContractType}
          disabled={adding}
        />
        <label>
          <span>{stage?.salaryFieldLabel || (season ? `${season} $` : "Salary")}</span>
          <input
            type="number"
            className="hub-roster-edit-input"
            min={0}
            max={salaryMax}
            step={1}
            value={salary}
            disabled={adding}
            aria-invalid={Boolean(salaryError)}
            onChange={(e) => setSalary(e.target.value)}
          />
          <span className="hub-cap-field-hint">{capFieldFigures({ free: remaining, dead: 0 })}</span>
        </label>
        <label>
          <span>{stage?.yearsFieldLabel || "Yrs left"}</span>
          <input
            type="number"
            className="hub-roster-edit-input hub-roster-edit-input-sm"
            min={1}
            max={maxYears}
            step={1}
            value={years}
            disabled={adding}
            onChange={(e) => setYears(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn-primary btn-sm"
          disabled={adding || !selected || Boolean(salaryError)}
          onClick={() => submit()}
        >
          {adding ? "Adding…" : "Add to roster"}
        </button>
      </div>
      {selected && (
        <p className="chart-note hub-league-add-selected">
          Adding {selected.player_name}
          {[selected.position, selected.team].filter(Boolean).length
            ? ` · ${[selected.position, selected.team].filter(Boolean).join(" · ")}`
            : ""}
        </p>
      )}
    </div>
  );
}

function TeamRosterBlock({
  block,
  leagueId,
  season,
  maxYears,
  salaryCap,
  rules,
  draftCompleted,
  stage,
  defaultOpen,
  highlightPlayerId,
  pendingByPlayer,
  fieldErrors,
  onQueue,
  onSaved,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mobileLayout = useMobileLayout();

  useEffect(() => {
    setOpen(defaultOpen);
  }, [block.team.id, defaultOpen]);

  useEffect(() => {
    if (!highlightPlayerId || !open) return undefined;
    const el = document.getElementById("live-contract-highlight");
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    return undefined;
  }, [highlightPlayerId, open, block.roster]);

  const sorted = useMemo(
    () => [...(block.roster || [])].sort(
      (a, b) => posSortKey(a.position) - posSortKey(b.position)
        || String(a.player_name).localeCompare(String(b.player_name)),
    ),
    [block.roster],
  );

  const stepUp = leagueStepUp(rules);
  const appliedBlock = useMemo(
    () => applyPendingToBlock(block, pendingByPlayer),
    [block, pendingByPlayer],
  );
  const stats = teamCapStats(appliedBlock, salaryCap, rules);
  const committedPct = Math.min(100, (stats.committed / stats.cap) * 100);
  const deadCapPct = Math.min(100 - committedPct, (stats.deadCap / stats.cap) * 100);
  const capPct = Math.min(100, Math.round(committedPct + deadCapPct));
  const capFigures = capFieldFigures({ free: stats.remaining, dead: stats.deadCap });

  const getEdit = (r) => {
    const pending = pendingByPlayer[r.player_id];
    const effective = applyPendingToRow(r, pending);
    return {
      salary: String(effective.salary ?? ""),
      years: String(rowYears(effective)),
    };
  };

  const team = block.team;

  const renderRowFields = (r) => {
    const pending = pendingByPlayer[r.player_id] || {};
    const effective = applyPendingToRow(r, pending);
    const edit = getEdit(r);
    const isCut = effective.roster_status === "cut_before_draft";
    const queuedDrop = Boolean(pending.drop);
    const locked = isCut || queuedDrop;
    const ctype = pending.contractType || rowType(effective);
    const pendingType = r.contract?.pending_type;
    const inferredMeta = !r.contract?.contract_type_manual && r.contract?.inferred_from
      ? String(r.contract.inferred_from).replace("nfl_yr_", "NFL yr ")
      : null;
    const storedSchedule = scheduleText(effective, rules);
    const livePreview = previewSchedule(
      edit.salary,
      edit.years,
      stepUp,
      ctype,
      rules?.contracts?.rookie_salary_static !== false,
    ) || storedSchedule;
    const chip = contractStateChip({
      rosterStatus: effective.roster_status,
      yearsLeft: rowYears(effective),
      contractType: ctype,
      draftCompleted,
      queuedDrop,
    });
    const isHighlight = Boolean(
      highlightPlayerId && matchLiveRosterPlayer(r, highlightPlayerId),
    );
    const salaryMax = salaryRoomForRow(block, pendingByPlayer, r, salaryCap, rules);
    const salaryError = fieldErrors[r.player_id] || (
      pending.salary != null ? validateSalaryValue(pending.salary, salaryMax) : ""
    );
    const cutCopy = cutButtonCopy(r, rules, { queuedCut: isCut && pending.rosterStatus === "cut_before_draft" });
    const dropCopy = dropButtonCopy(r, { queuedDrop });
    const cutControl = !draftCompleted && !queuedDrop ? (
      <button
        type="button"
        className={`btn-ghost btn-sm${isCut ? " hub-uncut-btn" : ""}`}
        aria-label={cutCopy.ariaLabel}
        onClick={() => onQueue(r, {
          rosterStatus: isCut ? "active" : "cut_before_draft",
        })}
      >
        {cutCopy.label}
      </button>
    ) : null;
    const dropControl = (
      <button
        type="button"
        className="btn-ghost btn-sm hub-drop-btn"
        aria-label={dropCopy.ariaLabel}
        onClick={() => onQueue(r, { drop: !queuedDrop })}
      >
        {dropCopy.label}
      </button>
    );
    return {
      pending,
      effective,
      edit,
      isCut,
      queuedDrop,
      locked,
      ctype,
      pendingType,
      inferredMeta,
      livePreview,
      chip,
      isHighlight,
      salaryMax,
      salaryError,
      cutControl,
      dropControl,
    };
  };

  return (
    <details
      className="hub-league-team-card"
      open={open}
      id={`team-${team.id}`}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="hub-league-team-card-head">
        <div className="hub-league-team-card-title">
          <strong>{hubTeamLabel(team)}</strong>
          <span className="hub-league-team-badges">
            {team.user_sub ? (
              <span className="hub-badge hub-badge-claimed">Claimed</span>
            ) : (
              <span className="hub-badge hub-badge-open">Unclaimed</span>
            )}
            {team.sleeper_roster_id && (
              <span className="hub-badge hub-badge-sleeper">Sleeper</span>
            )}
          </span>
        </div>
        <div className="hub-league-team-card-stats">
          <span>{stats.playerCount} players</span>
          <span>{fmtSal(stats.committed)} committed</span>
          {stats.deadCap > 0 && (
            <span className="hub-league-cut-count">{fmtSal(stats.deadCap)} dead cap</span>
          )}
          <span className="hub-league-cap-free">{fmtSal(stats.remaining)} free</span>
          {stats.cutCount > 0 && (
            <span className="hub-league-cut-count">{stats.cutCount} cut pre-draft</span>
          )}
          {!open && stats.playerCount > 0 && (
            <span className="hub-league-expand-hint hub-league-expand-hint--desktop">Tap to edit</span>
          )}
        </div>
        <div
          className="hub-cap-bar"
          role="progressbar"
          aria-valuenow={capPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${capPct}% of salary cap used`}
        >
          <div className="hub-cap-bar-committed" style={{ width: `${committedPct}%` }} />
          {deadCapPct > 0 && (
            <div className="hub-cap-bar-dead" style={{ width: `${deadCapPct}%` }} />
          )}
        </div>
      </summary>

      {open && error && <div className="error hub-league-team-error">{error}</div>}
      {open && notice && <p className="chart-note hub-league-team-notice" role="status">{notice}</p>}

      {open && leagueId && (
        <AddPlayerForm
          leagueId={leagueId}
          season={season}
          teamId={team.id}
          teamName={hubTeamLabel(team)}
          maxYears={maxYears}
          maxSalary={Math.max(0, stats.remaining)}
          remaining={stats.remaining}
          stage={stage}
          onSaved={onSaved}
          onError={setError}
          onNotice={(msg) => {
            setNotice(msg);
            setTimeout(() => setNotice(""), 3500);
          }}
        />
      )}

      {open && (
      mobileLayout ? (
        <MobileDataList
          emptyMessage={!sorted.length ? "No players. Add one above, or sync from Sleeper above." : null}
        >
          {sorted.map((r) => {
            const vm = renderRowFields(r);
            return (
              <div
                key={r.player_id}
                id={vm.isHighlight ? "live-contract-highlight" : undefined}
              >
              <MobilePlayerCard
                className={`${vm.isCut ? "hub-cut-row" : ""}${vm.queuedDrop ? " hub-drop-queued-row" : ""}`.trim()}
                selected={vm.isHighlight}
                defaultOpen={vm.isHighlight}
                name={r.player_name}
                titleNode={(
                  <span className="hub-office-player-title">
                    <span className="mobile-player-card-name">{r.player_name}</span>
                    <span className="hub-office-player-chips">
                      <span className={contractTypeBadgeClass(vm.ctype)}>{contractTypeLabel(vm.ctype)}</span>
                      <StateChips
                        chip={vm.chip}
                        pendingType={vm.pendingType}
                        inferredMeta={vm.inferredMeta}
                      />
                    </span>
                  </span>
                )}
                meta={[r.team, r.position].filter(Boolean).join(" · ") || "—"}
                heroValue={fmtSal(vm.edit.salary)}
                heroLabel={stage?.salaryFieldLabel || `${season} $`}
                expanded={(
                  <div className="mobile-stat-grid hub-roster-mobile-grid">
                    <HubFilterMenu
                      label="Contract type"
                      value={vm.pendingType || vm.ctype}
                      options={CONTRACT_TYPE_OPTIONS.map((o) => ({ id: o.value, label: o.label }))}
                      onChange={(id) => onQueue(r, { contractType: id })}
                      disabled={vm.locked}
                    />
                    <label className="hub-roster-mobile-field">
                      <span className="mobile-stat-label">
                        {stage?.salaryFieldLabel || `Cap hit (${season} season)`}
                      </span>
                      <input
                        type="number"
                        className="hub-roster-edit-input"
                        min={0}
                        max={vm.salaryMax}
                        step={1}
                        value={vm.edit.salary}
                        disabled={vm.locked}
                        aria-invalid={Boolean(vm.salaryError)}
                        aria-describedby={`cap-hint-${r.player_id}`}
                        onChange={(e) => onQueue(r, { salary: e.target.value })}
                      />
                      <span id={`cap-hint-${r.player_id}`} className="hub-cap-field-hint">
                        {capFigures}
                      </span>
                      {vm.salaryError && <span className="hub-field-error">{vm.salaryError}</span>}
                    </label>
                    <label className="hub-roster-mobile-field">
                      <span className="mobile-stat-label">
                        {stage?.yearsFieldLabel || "Yrs left"}
                      </span>
                      <input
                        type="number"
                        className="hub-roster-edit-input hub-roster-edit-input-sm"
                        min={1}
                        max={maxYears}
                        step={1}
                        value={vm.edit.years}
                        disabled={vm.locked}
                        onChange={(e) => onQueue(r, { years: e.target.value })}
                      />
                    </label>
                    <MobileStat
                      label="Schedule"
                      value={vm.livePreview || "—"}
                      className="hub-roster-mobile-schedule"
                    />
                  </div>
                )}
                actions={(
                  <>
                    {vm.cutControl}
                    <RowOverflow label={OFFICE_CONTRACTS_COPY.moreActions}>
                      {vm.dropControl}
                    </RowOverflow>
                  </>
                )}
              />
              </div>
            );
          })}
        </MobileDataList>
      ) : (
      <div className="hub-league-table-wrap">
        <table className="data-table hub-table hub-roster-table hub-league-roster-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Pos</th>
              <th>Type</th>
              <th title={stage?.capHint}>
                <StageColHead label={stage?.capColumn || `${season} $`} sub={stage?.capColumnSub} />
              </th>
              <th title={stage?.yearsHint}>
                <StageColHead label={stage?.yearsColumn || "Yrs"} sub={stage?.yearsColumnSub} />
              </th>
              <th>Schedule</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const vm = renderRowFields(r);
              return (
                <tr
                  key={r.player_id}
                  id={vm.isHighlight ? "live-contract-highlight" : undefined}
                  className={`${vm.isCut ? "hub-cut-row" : ""}${vm.queuedDrop ? " hub-drop-queued-row" : ""}${vm.isHighlight ? " hub-roster-row--selected" : ""}`.trim()}
                >
                  <td>
                    <div className="hub-league-player-cell">
                      <span className="hub-roster-player-name">{r.player_name}</span>
                      <span className="hub-league-player-meta">
                        {r.team || "—"}
                        <StateChips
                          chip={vm.chip}
                          pendingType={vm.pendingType}
                          inferredMeta={vm.inferredMeta}
                        />
                      </span>
                    </div>
                  </td>
                  <td><span className="hub-roster-pos-tag">{r.position}</span></td>
                  <td>
                    <HubFilterMenu
                      label="Type"
                      value={vm.pendingType || vm.ctype}
                      options={CONTRACT_TYPE_OPTIONS.map((o) => ({ id: o.value, label: o.label }))}
                      onChange={(id) => onQueue(r, { contractType: id })}
                      disabled={vm.locked}
                    />
                  </td>
                  <td>
                    <label className="hub-roster-field">
                      <span className="sr-only">
                        {stage?.salaryFieldLabel || "Cap"} for {r.player_name}
                      </span>
                      <input
                        type="number"
                        className="hub-roster-edit-input"
                        min={0}
                        max={vm.salaryMax}
                        step={1}
                        value={vm.edit.salary}
                        disabled={vm.locked}
                        aria-label={`${stage?.salaryFieldLabel || "Cap"} for ${r.player_name}`}
                        aria-describedby={`cap-hint-${r.player_id}`}
                        aria-invalid={Boolean(vm.salaryError)}
                        onChange={(e) => onQueue(r, { salary: e.target.value })}
                      />
                      <span id={`cap-hint-${r.player_id}`} className="hub-cap-field-hint">
                        {capFigures}
                      </span>
                      {vm.salaryError && <span className="hub-field-error">{vm.salaryError}</span>}
                    </label>
                  </td>
                  <td>
                    <label className="hub-roster-field">
                      <span className="sr-only">
                        {stage?.yearsFieldLabel || "Years"} for {r.player_name}
                      </span>
                      <input
                        type="number"
                        className="hub-roster-edit-input hub-roster-edit-input-sm"
                        min={1}
                        max={maxYears}
                        step={1}
                        value={vm.edit.years}
                        disabled={vm.locked}
                        aria-label={`${stage?.yearsFieldLabel || "Years"} for ${r.player_name}`}
                        onChange={(e) => onQueue(r, { years: e.target.value })}
                      />
                    </label>
                  </td>
                  <td className="chart-note hub-schedule-preview">{vm.livePreview}</td>
                  <td className="hub-roster-actions">
                    {vm.cutControl}
                    <RowOverflow label={OFFICE_CONTRACTS_COPY.moreActions}>
                      {vm.dropControl}
                    </RowOverflow>
                  </td>
                </tr>
              );
            })}
            {!sorted.length && (
              <tr>
                <td colSpan={7} className="chart-note hub-roster-empty">
                  No players. Add one above, or sync from Sleeper above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )
      )}
    </details>
  );
}

function LeagueRostersSkeleton() {
  return (
    <div className="hub-league-team-list" aria-busy="true" aria-label="Loading league rosters">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="hub-league-team-card hub-league-team-skeleton">
          <div className="hub-league-team-card-head">
            <div className="hub-league-skeleton-line hub-league-skeleton-title" />
            <div className="hub-league-skeleton-line hub-league-skeleton-stats" />
            <div className="hub-cap-bar"><div className="hub-cap-bar-committed" style={{ width: `${20 + i * 12}%` }} /></div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CommissionerLeagueRosters({ leagueId, season, workspace, hubContext, onChanged, reloadNonce = 0 }) {
  const [searchParams] = useSearchParams();
  const playerFromUrl = (searchParams.get("player") || "").trim();
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [playerLinkNotice, setPlayerLinkNotice] = useState("");
  const [pendingByPlayer, setPendingByPlayer] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState("");
  const loadGenRef = React.useRef(0);
  const overviewRef = React.useRef(null);
  const appliedPlayerRef = React.useRef("");
  const pendingRef = React.useRef(pendingByPlayer);
  pendingRef.current = pendingByPlayer;
  overviewRef.current = overview;
  const mobileLayout = useMobileLayout();

  const load = useCallback(async (opts = {}) => {
    if (!leagueId) return;
    const cached = !opts.refresh ? getAnyLeagueRostersCache(leagueId) : null;
    if (cached && !overviewRef.current) {
      setOverview(cached);
      setLoading(false);
    }
    const hasUi = Boolean(overviewRef.current || cached);
    const background = Boolean(opts.background || (hasUi && !opts.refresh));
    if (!background && !hasUi) setLoading(true);
    setError("");
    const generation = ++loadGenRef.current;
    try {
      const params = new URLSearchParams();
      if (opts.refresh) params.set("refresh", "1");
      const q = params.toString() ? `?${params.toString()}` : "";
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/rosters${q}`);
      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      if (generation !== loadGenRef.current) return;
      setOverview(payload);
      setLeagueRostersCache(leagueId, payload.source_version || "", payload);
    } catch (e) {
      if (generation !== loadGenRef.current) return;
      if (!overviewRef.current && !cached) {
        setError(connectionErrorMessage(e));
      }
    } finally {
      if (generation === loadGenRef.current) setLoading(false);
    }
  }, [leagueId]);

  useEffect(() => {
    load({ refresh: Boolean(reloadNonce) });
  }, [leagueId, reloadNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!playerFromUrl) {
      appliedPlayerRef.current = "";
      setPlayerLinkNotice("");
      return;
    }
    if (!overview?.teams?.length) return;
    const hit = findLiveContractTarget(overview.teams, playerFromUrl);
    if (hit?.teamId) {
      if (appliedPlayerRef.current !== playerFromUrl) {
        setTeamFilter(hit.teamId);
        appliedPlayerRef.current = playerFromUrl;
      }
      setPlayerLinkNotice(
        `Opened ${hit.row.player_name || "player"} on ${hubTeamLabel(hit.block.team)}.`,
      );
      return;
    }
    setPlayerLinkNotice(
      "No live contract for this player. Add them here, or open History for year-book records.",
    );
  }, [overview, playerFromUrl]);

  const maxYears = Number(
    workspace?.rules?.contracts?.max_years
    ?? overview?.league?.rules?.contracts?.max_years
    ?? 3,
  );
  const targetSeason = season || overview?.league?.season || workspace?.season;
  const draftCompleted = Boolean(hubContext?.draft_completed);
  const stage = liveContractStage(targetSeason, {
    draftCompleted,
    leagueStatus: hubContext?.league_status,
  });

  const handleSaved = useCallback(async (opts = {}) => {
    await load({ background: Boolean(overviewRef.current), refresh: true });
    if (opts.syncHub) onChanged?.();
  }, [load, onChanged]);

  const refresh = useCallback(async () => {
    await load({ refresh: true });
    onChanged?.();
  }, [load, onChanged]);

  const teams = useMemo(() => {
    return [...(overview?.teams || [])].sort((a, b) => {
      const aLabel = hubTeamLabel(a.team, { includeTeam: false }) || hubTeamLabel(a.team);
      const bLabel = hubTeamLabel(b.team, { includeTeam: false }) || hubTeamLabel(b.team);
      return aLabel.localeCompare(bLabel);
    });
  }, [overview]);
  const filteredTeams = useMemo(() => {
    const q = search.trim().toLowerCase();
    return teams
      .filter((block) => !teamFilter || block.team.id === teamFilter)
      .map((block) => {
        if (!q) return block;
        const roster = (block.roster || []).filter(
          (r) => String(r.player_name || "").toLowerCase().includes(q)
            || String(r.position || "").toLowerCase().includes(q)
            || String(r.team || "").toLowerCase().includes(q),
        );
        return roster.length ? { ...block, roster } : null;
      })
      .filter(Boolean);
  }, [teams, search, teamFilter]);

  const salaryCap = Number(overview?.salary_cap ?? workspace?.rules?.salary_cap ?? 200);
  const leagueRules = workspace?.rules || overview?.league?.rules;

  const leagueTotals = useMemo(() => {
    let players = 0;
    let committed = 0;
    let deadCap = 0;
    for (const block of teams) {
      const s = teamCapStats(applyPendingToBlock(block, pendingByPlayer), salaryCap, leagueRules);
      players += s.playerCount;
      committed += s.committed;
      deadCap += s.deadCap;
    }
    return { teams: teams.length, players, committed, deadCap };
  }, [teams, salaryCap, leagueRules, pendingByPlayer]);

  const pendingSummary = useMemo(
    () => summarizePending(teams, pendingByPlayer, salaryCap, leagueRules),
    [teams, pendingByPlayer, salaryCap, leagueRules],
  );
  const hasPending = pendingSummary.count > 0;

  const queueChange = useCallback((row, patch) => {
    setFieldErrors((prev) => {
      if (!prev[row.player_id]) return prev;
      const next = { ...prev };
      delete next[row.player_id];
      return next;
    });
    setPendingByPlayer((prev) => mergePendingChange(prev, row.player_id, {
      ...patch,
      playerName: row.player_name,
    }, row));
  }, []);

  const discardPending = useCallback(() => {
    setPendingByPlayer({});
    setFieldErrors({});
    setError("");
  }, []);

  const confirmLeave = useCallback(async () => {
    if (!Object.keys(pendingRef.current).length) return true;
    const discard = await confirmDialog({
      title: OFFICE_CONTRACTS_COPY.leaveTitle,
      message: OFFICE_CONTRACTS_COPY.leaveMessage,
      confirmLabel: OFFICE_CONTRACTS_COPY.leaveDiscard,
      cancelLabel: OFFICE_CONTRACTS_COPY.leaveStay,
      danger: true,
    });
    if (discard) discardPending();
    return Boolean(discard);
  }, [discardPending]);

  useEffect(() => {
    setOfficeUnsavedGuard(hasPending, confirmLeave);
    return () => setOfficeUnsavedGuard(false, null);
  }, [hasPending, confirmLeave]);

  useEffect(() => {
    if (!hasPending) return undefined;
    const onLeave = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [hasPending]);

  const savePending = async () => {
    const errors = [];
    const byPlayer = {};
    for (const block of teams) {
      for (const err of validatePendingForTeam(block, pendingByPlayer, salaryCap, leagueRules)) {
        errors.push(err);
        if (err.playerId) byPlayer[err.playerId] = err.message;
      }
    }
    if (errors.length) {
      setFieldErrors(byPlayer);
      setError(OFFICE_CONTRACTS_COPY.saveBlocked);
      return;
    }
    let note = "";
    if (pendingNeedsOverrideNote(pendingByPlayer)) {
      const reason = await promptDialog({
        title: OFFICE_CONTRACTS_COPY.overrideTitle,
        message: OFFICE_CONTRACTS_COPY.overrideMessage,
        label: OFFICE_CONTRACTS_COPY.overrideLabel,
        placeholder: OFFICE_CONTRACTS_COPY.overridePlaceholder,
        confirmLabel: OFFICE_CONTRACTS_COPY.overrideConfirm,
      });
      if (reason == null) return;
      note = reason;
    }
    setSaving(true);
    setError("");
    const remaining = { ...pendingByPlayer };
    try {
      for (const [playerId, change] of Object.entries(pendingByPlayer)) {
        const res = await sendRosterWrite(apiFetch, {
          playerId,
          drop: Boolean(change.drop),
          contractType: change.drop ? undefined : change.contractType,
          salary: change.drop ? undefined : change.salary,
          years: change.drop ? undefined : change.years,
          rosterStatus: change.drop ? undefined : change.rosterStatus,
          note,
        });
        if (!res?.ok) throw new Error(await parseApiError(res));
        delete remaining[playerId];
      }
      setPendingByPlayer({});
      setFieldErrors({});
      setSaveNotice(OFFICE_CONTRACTS_COPY.saved);
      setTimeout(() => setSaveNotice(""), 4000);
      await handleSaved({ syncHub: true });
    } catch (e) {
      setPendingByPlayer(remaining);
      setError(connectionErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const initialLoad = loading && !overview;
  const refreshing = loading && Boolean(overview);

  if (error && !overview) {
    return (
      <div className="hub-league-rosters">
        <div className="error">{error}</div>
      </div>
    );
  }

  return (
    <div className="hub-league-rosters">
      <LiveContractStageBanner stage={stage} />
      <header className="hub-league-rosters-head">
        <div className="hub-league-rosters-intro">
          <h2>Contracts</h2>
        </div>
        <div className="hub-league-rosters-summary" aria-label="League totals">
          {hubContext?.is_commissioner && draftCompleted ? (
            <span className="chart-note">{MARK_DRAFT_COMPLETE_COPY.done}</span>
          ) : null}
          {refreshing && <span className="hub-league-refresh-badge">Updating…</span>}
          <span className="hub-league-summary-stat">
            <strong>{leagueTotals.teams || "—"}</strong> {Number(leagueTotals.teams) === 1 ? "team" : "teams"}
          </span>
          <span className="hub-league-summary-stat">
            <strong>{leagueTotals.players || "—"}</strong> players
          </span>
          <span className="hub-league-summary-stat">
            <strong>{overview ? fmtSal(leagueTotals.committed) : "—"}</strong> committed
          </span>
          {leagueTotals.deadCap > 0 && (
            <span className="hub-league-summary-stat">
              <strong>{fmtSal(leagueTotals.deadCap)}</strong> dead cap
            </span>
          )}
        </div>
      </header>

      {error && overview && <div className="error hub-league-inline-error">{error}</div>}
      {saveNotice && (
        <p className="hub-office-save-confirm" role="status">{saveNotice}</p>
      )}
      {playerLinkNotice && (
        <p className="chart-note" role="status">{playerLinkNotice}</p>
      )}

      {overview && (
        <LeagueSleeperConnect
          leagueId={leagueId}
          hubContext={hubContext}
          overview={overview}
          onConnected={refresh}
        />
      )}

      {initialLoad ? (
        <LeagueRostersSkeleton />
      ) : (
        <>
      {teams.length > 0 && (
        <div className="hub-league-rosters-toolbar">
          <label className="hub-league-search">
            <span className="hub-field-label">{OFFICE_CONTRACTS_COPY.searchPlayers}</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, position, NFL team…"
            />
          </label>
          {mobileLayout ? (
            <HubFilterMenu
              label={OFFICE_CONTRACTS_COPY.teamPicker}
              value={teamFilter}
              options={[
                { id: "", label: OFFICE_CONTRACTS_COPY.showAll },
                ...teams.map((block) => {
                  const parts = hubTeamParts(block.team);
                  return {
                    id: block.team.id,
                    label: parts.owner || hubTeamLabel(block.team),
                  };
                }),
              ]}
              onChange={setTeamFilter}
            />
          ) : (
            <>
              <div className="hub-league-team-jump" role="group" aria-label="Filter by team">
                {teams.map((block) => {
                  const s = teamCapStats(
                    applyPendingToBlock(block, pendingByPlayer),
                    salaryCap,
                    leagueRules,
                  );
                  const parts = hubTeamParts(block.team);
                  const ownerLabel = parts.owner || hubTeamLabel(block.team);
                  return (
                    <button
                      key={block.team.id}
                      type="button"
                      className={`hub-league-jump-pill${teamFilter === block.team.id ? " active" : ""}`}
                      onClick={() => setTeamFilter((id) => (id === block.team.id ? "" : block.team.id))}
                      title={`${hubTeamLabel(block.team)} · ${fmtSal(s.committed)} committed`}
                    >
                      {ownerLabel}
                      <span className="hub-league-jump-meta">
                        {parts.owner && parts.team ? `${parts.team} · ` : ""}
                        {fmtSal(s.committed)}
                      </span>
                    </button>
                  );
                })}
              </div>
              {teamFilter && (
                <button
                  type="button"
                  className="btn-ghost btn-sm hub-league-show-all"
                  onClick={() => setTeamFilter("")}
                >
                  {OFFICE_CONTRACTS_COPY.showAll}
                </button>
              )}
            </>
          )}
        </div>
      )}

      <div className="hub-league-team-list">
        {!teamFilter && !search.trim() ? (
          <p className="chart-note">
            No team selected — pick a team above to add players or edit salaries, years, and contract type.
          </p>
        ) : (
          <>
            {filteredTeams.map((block) => (
              <TeamRosterBlock
                key={block.team.id}
                block={block}
                leagueId={leagueId}
                season={targetSeason}
                maxYears={maxYears}
                salaryCap={salaryCap}
                rules={leagueRules}
                draftCompleted={draftCompleted}
                stage={stage}
                defaultOpen={Boolean(teamFilter) || Boolean(search.trim())}
                highlightPlayerId={playerFromUrl}
                pendingByPlayer={pendingByPlayer}
                fieldErrors={fieldErrors}
                onQueue={queueChange}
                onSaved={handleSaved}
              />
            ))}
            {!filteredTeams.length && (
              <p className="chart-note">No teams match your search.</p>
            )}
          </>
        )}
      </div>
        </>
      )}
      {hasPending && (
        <div className="hub-office-pending-tray" role="region" aria-label="Pending contract changes">
          <p className="hub-office-pending-summary">{pendingTraySummary(pendingSummary)}</p>
          <div className="hub-office-pending-actions">
            <button
              type="button"
              className="btn-ghost"
              disabled={saving}
              onClick={discardPending}
            >
              {OFFICE_CONTRACTS_COPY.discard}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={saving}
              onClick={savePending}
            >
              {saving ? OFFICE_CONTRACTS_COPY.saving : OFFICE_CONTRACTS_COPY.save}
            </button>
          </div>
        </div>
      )}
      {hubContext?.is_commissioner && !draftCompleted ? (
        <div className="hub-office-draft-complete">
          <button
            type="button"
            className="btn-danger"
            onClick={async () => {
              if (hasPending && !(await confirmLeave())) return;
              try {
                const data = await markDraftComplete(leagueId);
                if (data) onChanged?.();
              } catch (e) {
                setError(e.message || "Could not mark draft complete");
              }
            }}
          >
            {MARK_DRAFT_COMPLETE_COPY.action}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export { scheduleText, fmtSal } from "./rosterFormat";
