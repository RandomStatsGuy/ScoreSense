import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import { createPortal } from "react-dom";
import useModalFocus from "../ui/useModalFocus";
import "../styles/my-team.css";
import confirmDialog from "../ui/confirm";
import { MY_TEAM_COPY, rosterCapSummary, rosterRowOccupies, rosterStatusInfo } from "./rosterPresentation";
import { HubFilterChip, HubFilterMenu, HubFilterScroll, HubLoadingSkeleton, HubPage } from "./HubUILayout";
import {
  CONTRACT_TYPE_OPTIONS,
  contractDeadCapStory,
  contractTypeBadgeClass,
  contractTypeLabel,
  fmtSal,
  leagueStepUp,
  rosterSlotKey,
  contractScheduleHint,
  previewSchedule,
  scheduleText,
  seasonCapYearHint,
  YEARS_LEFT_HINT,
} from "./rosterFormat";
import { leagueUsesSalaries } from "./leagueCapabilities";
import {
  canManagerRookieExtend,
  cancelRookieExtend,
  hasPendingExtension,
  isRookieExtendSuccessMessage,
  postRookieExtend,
  previewRookieExtendStartSalary,
  rookieExtendCancelSuccessMessage,
  rookieExtendSuccessMessage,
} from "./rookieExtend";
import ContractHistoryLink from "./ContractHistoryLink";
import { HUB_POS_ORDER, HUB_POSITION_FILTERS, normalizeHubPosition } from "./hubPositions";
import TeamRoom from "./TeamRoom";
import MatchupBannerArt from "./MatchupBannerArt";
import { SeasonNumbers, SeasonGameLog } from "./SeasonScore";
import TeamIdentityStudio from "./TeamIdentityStudio";
import { identityFor, useTeamIdentities } from "./TeamIdentityContext";
import { hubTeamLabel } from "./hubTeamLabel";
import { sendRosterWrite } from "./rosterWrite";

function posSortKey(position) {
  const pos = normalizeHubPosition(position);
  const idx = HUB_POS_ORDER.indexOf(pos);
  return idx >= 0 ? idx : HUB_POS_ORDER.length;
}

function ContractPanel({ title, onClose, children }) {
  const panelRef = useRef(null);
  const titleRef = useRef(null);
  useModalFocus(true, panelRef, onClose, titleRef);
  return createPortal(
    <div className="my-team-panel-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section ref={panelRef} className="my-team-panel" role="dialog" aria-modal="true" aria-labelledby="my-team-contract-title">
        <header className="my-team-panel-head">
          <h2 ref={titleRef} tabIndex={-1} id="my-team-contract-title">{title}</h2>
          <button className="my-team-icon" type="button" aria-label={MY_TEAM_COPY.closeDetails} onClick={onClose}>×</button>
        </header>
        <div className="my-team-panel-body">{children}</div>
      </section>
    </div>, document.body,
  );
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
      <summary>{MY_TEAM_COPY.learnMoreLabel}</summary>
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
  seasonScore, showSeasonScores,
  r,
  season,
  usesSalaries = true,
  contractsReadOnly,
  canEditType,
  draftCompleted,
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
  undoQueuedExtension,
  toggleCut,
  remove,
  canRemove,
  maxYears,
  status,
  onOpenContractHistory,
  rules,
}) {
  const isCut = !rosterRowOccupies(r);
  const deadStory = contractDeadCapStory(r, rules);

  return (
    <div className="hub-roster-contract-panel-body">
      <div className="hub-roster-contract-panel-meta">
        <div className="hub-roster-contract-panel-identity">
          <strong>{r.player_name}</strong>
          <span className="chart-note">
            {[r.team, normalizeHubPosition(r.position) || r.position].filter(Boolean).join(" · ") || "—"}
          </span>
        </div>
        <span className={`hub-roster-status hub-roster-status--${usesSalaries ? status.tone : "ok"}`}>
          {usesSalaries ? status.label : MY_TEAM_COPY.rosteredStatus}
        </span>
      </div>

      {showSeasonScores && <SeasonGameLog score={seasonScore} />}
      {usesSalaries && <div className="hub-roster-contract-panel-grid">
        {canEditType ? (
          <div className="hub-roster-mobile-field">
            <HubFilterMenu
              label="Contract type"
              value={pendingType || ctype}
              options={CONTRACT_TYPE_OPTIONS.map((o) => ({ id: o.value, label: o.label }))}
              onChange={(id) => saveContractType(r, id)}
              disabled={isSaving}
            />
          </div>
        ) : (
          <div className="hub-roster-contract-panel-stat">
            <span className="mobile-stat-label">Contract type</span>
            <span className={contractTypeBadgeClass(ctype)}>{contractTypeLabel(ctype)}</span>
            {inferredMeta && <span className="hub-contract-infer-meta">Auto · {inferredMeta}</span>}
          </div>
        )}

        {usesSalaries && (
          <>
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
          </>
        )}
      </div>}

      {usesSalaries && (
        <>
          <div className="hub-roster-contract-panel-stat hub-roster-contract-panel-schedule">
            <span className="mobile-stat-label">Salary schedule</span>
            <strong className="hub-schedule-preview">{livePreview || "—"}</strong>
          </div>

          <div className="hub-roster-contract-panel-grid">
            <div className="hub-roster-contract-panel-stat">
              <span className="mobile-stat-label">{deadStory.isCut ? "Dead cap" : "Dead cap if cut"}</span>
              <strong>{deadStory.deadLabel}</strong>
            </div>
            {deadStory.isCut && (
              <div className="hub-roster-contract-panel-stat">
                <span className="mobile-stat-label">Salary restored if cut is undone</span>
                <strong>{fmtSal(deadStory.salary)}</strong>
              </div>
            )}
          </div>
        </>
      )}

      {usesSalaries && (pendingType || pendingExt) && (
        <p className="chart-note">
          {pendingType ? "Type change pending commissioner approval. " : ""}
          {pendingExt ? MY_TEAM_COPY.queuedNote : ""}
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
        {usesSalaries && extendEligible && (
          <div className="hub-roster-contract-panel-primary">
            <p className="my-team-extension-preview">{MY_TEAM_COPY.extensionStart(fmtSal(extendStart), extendYearsFor(r))}</p>
            <HubFilterMenu
              label="Extension years"
              value={extendYearsFor(r)}
              options={Array.from({ length: maxYears }, (_, index) => index + 1).map((years) => ({
                id: years,
                label: `${years} yr`,
              }))}
              onChange={(id) => setExtendYearsById((prev) => ({
                ...prev,
                [r.player_id]: id,
              }))}
              disabled={isSaving}
            />
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={isSaving}
              title={extendStart != null ? `Starts at ${fmtSal(extendStart)}` : undefined}
              onClick={() => queueRookieExtend(r)}
            >
              Queue extension
            </button>
          </div>
        )}
        {usesSalaries && pendingExt && !draftCompleted && (
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={isSaving}
            onClick={() => undoQueuedExtension(r)}
          >
            {MY_TEAM_COPY.undoExtension}
            <span className="hub-btn-support">{MY_TEAM_COPY.undoExtensionHint}</span>
          </button>
        )}
        <div className="hub-roster-contract-panel-danger">
          {usesSalaries && <button
            type="button"
            className={`btn-ghost btn-sm${isCut ? " hub-uncut-btn" : ""}`}
            disabled={isSaving || (isCut && r.can_undo_cut === false)}
            onClick={() => toggleCut(r, !isCut)}
          >
            {isCut && r.can_undo_cut === false
              ? MY_TEAM_COPY.undoCutClosed
              : isCut ? MY_TEAM_COPY.undoCut : MY_TEAM_COPY.cutLabel}
            {isCut ? (
              <span className="hub-btn-support">
                {r.can_undo_cut === false
                  ? MY_TEAM_COPY.undoCutClosedSupport(r.claimed_by_owner)
                  : deadStory.undoSupport}
              </span>
            ) : null}
          </button>}
          {canRemove && (
            <button
              type="button"
              className="btn-ghost btn-sm hub-btn-danger"
              disabled={isSaving}
              onClick={() => remove(r)}
            >
              {usesSalaries ? MY_TEAM_COPY.dropLabel : MY_TEAM_COPY.dropPlayer}
            </button>
          )}
        </div>
        {usesSalaries && <ContractHistoryLink
          playerId={r.player_id}
          playerName={r.player_name}
          onOpen={onOpenContractHistory}
        />}
      </div>
    </div>
  );
}

export default function RosterBuilder({
  cacheScope,
  roster,
  onChanged,
  valueRows,
  sleeper,
  workspace,
  hubContext,
  capSheet,
  readOnly = false,
  loading = false,
  showManagerTeam = false,
  onEditInOffice,
  onOpenContractHistory,
  onNavigate,
  focusFilter = null,
  onFocusConsumed,
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
  const [statusFocus, setStatusFocus] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);
  const [selectedSlotKey, setSelectedSlotKey] = useState(null);
  const [lookOpen, setLookOpen] = useState(false);
  const [seasonScores, setSeasonScores] = useState(null);
  const [scoreError, setScoreError] = useState(false);
  useEffect(() => {
    setSeasonScores(null); setScoreError(false);
    if (!hubContext?.league_id || !hubContext?.team_id) return;
    const ctrl = new AbortController();
    let timer;
    const load = (attempt = 0) => apiFetch(`/api/hub/league/${encodeURIComponent(hubContext.league_id)}/teams/${encodeURIComponent(hubContext.team_id)}/season-scores`, { signal: ctrl.signal })
      .then(async res => { if (!res.ok) throw new Error(); return res.json(); })
      .then(data => {
        if (ctrl.signal.aborted) return;
        setSeasonScores(data);
        if (data.pending && attempt < 5) timer = setTimeout(() => load(attempt + 1), 3000);
      })
      .catch(() => { if (!ctrl.signal.aborted) setScoreError(true); });
    load();
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, [hubContext?.league_id, hubContext?.team_id, roster]);
  const [roomTab, setRoomTab] = useState("room");
  const manageTabRef = useRef(null);
  useEffect(() => { setRoomTab("room"); setSelectedSlotKey(null); setSearch(""); setSearchOpen(false); setPosFilter("ALL"); }, [hubContext?.league_id, hubContext?.team_id]);
  const restoreFocusRef = useRef(null);

  const [typeOverrides, setTypeOverrides] = useState({});
  const [extendYearsById, setExtendYearsById] = useState({});

  const { identities, setIdentities } = useTeamIdentities();
  const maxYears = Math.max(1, Number(workspace?.rules?.contracts?.max_years ?? 3) || 3);
  const defaultStepUp = leagueStepUp(workspace?.rules);
  const usesSalaries = leagueUsesSalaries(hubContext);
  const season = workspace?.season ?? new Date().getFullYear();
  const draftCompleted = Boolean(hubContext?.draft_completed);
  const cap = usesSalaries ? rosterCapSummary(capSheet) : null;
  const teamName = hubTeamLabel({
    name: hubContext?.team_name,
    sleeper_team_name: sleeper?.sleeper_team_name || hubContext?.sleeper_team_name,
  }) || sleeper?.sleeper_team_name || hubContext?.team_name;
  const ownerName = hubTeamLabel({ owner_name: hubContext?.owner_name, name: teamName }, { includeTeam: false }) || MY_TEAM_COPY.title;
  const teamIdentity = identityFor(identities, {
    id: hubContext?.team_id,
    identity: hubContext?.team_identity,
  });
  const isLeague = hubContext?.mode === "league";
  const isCommissioner = Boolean(hubContext?.is_commissioner || hubContext?.can_edit_salaries);
  // SCORE-41: league My Team never edits salary/years/type — Roster management is the arbitrary editor.
  // SCORE-42: managers may still queue a server-calculated extension for their own eligible deals.
  const contractsReadOnly = isLeague || readOnly;
  const canEditType = !contractsReadOnly;
  const canRemove = !isLeague || isCommissioner;
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
      if (usesSalaries && statusFocus === "extend") {
        const extend = canManagerRookieExtend(r, { draftCompleted, rules: workspace?.rules }).ok;
        if (!extend) return false;
      }
      if (!q) return true;
      const name = String(r.player_name || "").toLowerCase();
      const team = String(r.team || "").toLowerCase();
      const pos = String(r.position || "").toLowerCase();
      return name.includes(q) || team.includes(q) || pos.includes(q);
    });
  }, [search, posFilter, statusFocus, sortedRoster, draftCompleted, workspace?.rules, usesSalaries]);

  // Cut / dropped / traded / expired rows stay visible as history but never
  // count toward roster size, position limits, or committed salary.
  const liveRoster = useMemo(() => (roster || []).filter(rosterRowOccupies), [roster]);

  const posCounts = useMemo(() => {
    const counts = { ALL: (roster || []).length };
    for (const row of liveRoster) {
      const pos = normalizeHubPosition(row.position);
      if (!pos) continue;
      counts[pos] = (counts[pos] || 0) + 1;
    }
    return counts;
  }, [roster, liveRoster]);

  const selectedRow = useMemo(
    () => (selectedSlotKey ? (roster || []).find((r) => rosterSlotKey(r) === selectedSlotKey) : null),
    [roster, selectedSlotKey],
  );

  const openContractPanel = useCallback((rowOrId, fromEl) => {
    restoreFocusRef.current = fromEl || document.activeElement;
    const row = rowOrId && typeof rowOrId === "object"
      ? rowOrId
      : (roster || []).find((r) => r.player_id === rowOrId);
    setSelectedSlotKey((row ? rosterSlotKey(row) : null) || String(row?.player_id || rowOrId || ""));
  }, [roster]);

  const closeContractPanel = useCallback(() => {
    setSelectedSlotKey(null);
    const restore = restoreFocusRef.current;
    restoreFocusRef.current = null;
    queueMicrotask(() => restore?.focus?.());
  }, []);

  const toggleCut = useCallback(async (r, cut) => {
    if (!cut && r?.can_undo_cut === false) return;
    if (cut && draftCompleted) {
      const story = contractDeadCapStory({ ...r, roster_status: "active" }, workspace?.rules);
      const ok = await confirmDialog({
        title: MY_TEAM_COPY.cutConfirmTitle(r.player_name || "this player"),
        message: MY_TEAM_COPY.cutConfirm(fmtSal(story.freed), story.deadLabel),
        confirmLabel: MY_TEAM_COPY.cutConfirmLabel,
        danger: true,
      });
      if (!ok) return;
    }
    setSavingId(r.player_id);
    setError("");
    try {
      const res = await apiFetch("/api/hub/roster", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player_id: r.player_id,
          roster_slot_id: r.id || undefined,
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
  }, [onChanged, draftCompleted, workspace?.rules]);

  useEffect(() => {
    if (!lookOpen || !roster?.length) {
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
  }, [lookOpen, roster, workspace?.season]);

  useEffect(() => {
    setDraftEdits({});
    setTypeOverrides({});
    setExtendYearsById({});
  }, [roster]);

  useEffect(() => {
    if (selectedSlotKey && !(roster || []).some((r) => rosterSlotKey(r) === selectedSlotKey)) {
      setSelectedSlotKey(null);
    }
  }, [roster, selectedSlotKey]);

  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);

  useEffect(() => {
    if (focusFilter === "extend") {
      setRoomTab("manage");
      setStatusFocus("extend");
      setPosFilter("ALL");
      onFocusConsumed?.();
    }
  }, [focusFilter, onFocusConsumed]);

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
    return Math.min(2, maxYears);
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

  const undoQueuedExtension = useCallback(async (r) => {
    setSavingId(r.player_id);
    setError("");
    try {
      await cancelRookieExtend(r.player_id);
      setError(rookieExtendCancelSuccessMessage());
      setTimeout(() => setError(""), 4000);
      onChanged?.();
    } catch (e) {
      setError(e.message || "Could not undo the extension");
    } finally {
      setSavingId(null);
    }
  }, [onChanged]);

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
      const res = await sendRosterWrite(apiFetch, {
        playerId: r.player_id,
        rosterSlotId: r.id,
        salary: Number.isFinite(nextSal) ? nextSal : curSal,
        years: Number.isFinite(nextYears) ? nextYears : curYears,
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
      const res = await sendRosterWrite(apiFetch, {
        playerId: r.player_id,
        rosterSlotId: r.id,
        contractType: nextType,
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

  const remove = async (row) => {
    const pid = row?.player_id;
    if (!pid) return;
    const ok = await confirmDialog({
      title: usesSalaries ? MY_TEAM_COPY.removeTitle : MY_TEAM_COPY.dropPlayerTitle(row.player_name),
      message: usesSalaries
        ? MY_TEAM_COPY.removeConfirm
        : MY_TEAM_COPY.dropPlayerConfirm(row.player_name),
      confirmLabel: usesSalaries ? MY_TEAM_COPY.removeConfirmLabel : MY_TEAM_COPY.dropPlayer,
      danger: true,
    });
    if (!ok) return;
    const res = await sendRosterWrite(apiFetch, {
      playerId: pid,
      rosterSlotId: row?.id,
      drop: true,
    });
    if (!res.ok) setError(await parseApiError(res));
    else {
      if (selectedSlotKey && rosterSlotKey(row) === selectedSlotKey) setSelectedSlotKey(null);
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

  const displayedRoster = filteredRoster;

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
        workspace?.rules?.contracts?.veteran_salary_static !== false,
      ) || storedSchedule);
    const status = rosterStatusInfo(r, {
      draftCompleted, ctype, pendingType, pendingExt, rules: workspace?.rules,
    });
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

  const panelProps = selectedRow ? (() => {
    const vm = rowViewModel(selectedRow);
    return {
      r: selectedRow,
      season,
      usesSalaries,
      contractsReadOnly,
      canEditType,
      draftCompleted,
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
      undoQueuedExtension,
      toggleCut,
      remove,
      canRemove,
      maxYears,
      status: vm.status,
      onOpenContractHistory,
      rules: workspace?.rules,
    };
  })() : null;

  const rosterPage = (
    <HubPage frameless className="my-team-page">
      <section className={`my-team-overview${usesSalaries ? "" : " is-standard"}`} aria-label={usesSalaries ? MY_TEAM_COPY.summaryLabel : MY_TEAM_COPY.teamLabel}>
        <div className={`my-team-banner hub-banner-fill--${teamIdentity?.banner_preset || "navy_stripe"}`} aria-hidden="true">
          <MatchupBannerArt identity={teamIdentity} variant="room" />
        </div>
        <div className="my-team-identity">
          <h1>{teamName}</h1>
          <p>{[ownerName, MY_TEAM_COPY.playerCount(liveRoster.length)].filter(Boolean).join(" · ")}</p>
        </div>
        {usesSalaries && <>
          <button type="button" className="my-team-budget" disabled={!onNavigate} onClick={() => onNavigate?.("planner")} aria-label={MY_TEAM_COPY.openCap(cap?.leftoverLabel, draftCompleted)}>
            <span>{MY_TEAM_COPY.capRemaining(draftCompleted)}</span>
            <strong>{cap?.leftoverLabel || "—"} <span aria-hidden="true">↗</span></strong>
          </button>
          <p className="my-team-budget-facts">{cap ? <>{MY_TEAM_COPY.capCommitted(cap.committedLabel, cap.limitLabel)}{cap.dead > 0 ? ` · ${MY_TEAM_COPY.deadCapInline(fmtSal(cap.dead))}` : ""}</> : MY_TEAM_COPY.capLoading}</p>
        </>}
      </section>

      {isLeague && hubContext?.league_id && hubContext?.team_id && (
        <TeamIdentityStudio
          open={lookOpen}
          onClose={() => setLookOpen(false)}
          leagueId={hubContext.league_id}
          teamId={hubContext.team_id}
          team={{ id: hubContext.team_id, name: teamName, sleeper_team_name: sleeper?.sleeper_team_name }}
          identity={teamIdentity}
          roster={roster}
          mediaById={mediaById}
          onSaved={(next) => {
            setIdentities?.((prev) => ({ ...prev, [hubContext.team_id]: next }));
          }}
        />
      )}

      {!contractsReadOnly && (
      <details className="hub-roster-add">
        <summary>Add player manually</summary>
        <div className="hub-form-row hub-roster-add-row">
          <HubFilterMenu
            label="Player"
            value={playerId}
            options={[
              { id: "", label: "Select…" },
              ...(valueRows || []).slice(0, 300).map((r) => ({
                id: r.player_id,
                label: `${r.player} (${r.position})`,
              })),
            ]}
            onChange={setPlayerId}
          />
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

      {contractsReadOnly && !isLeague && (
        <p className="chart-note">Salaries set by commish. Sync Sleeper after trades.</p>
      )}

      {error && (
        <div className={isRookieExtendSuccessMessage(error) ? "hub-msg" : "error"}>
          {error}
        </div>
      )}

      {loading ? <HubLoadingSkeleton label={MY_TEAM_COPY.loading} rows={5} /> : !sortedRoster.length ? (
        <section className="my-team-empty" role="status">
          <h2>{MY_TEAM_COPY.noMoneyEmptyHeading}</h2>
          {onNavigate && <button className="btn-primary" type="button" onClick={() => onNavigate(draftCompleted ? "available" : "room")}>
            {draftCompleted ? MY_TEAM_COPY.freeAgents : MY_TEAM_COPY.emptyAction}
          </button>}
        </section>
      ) : <div className="my-team-main">
        <div className="my-team-controls">
          <div className="my-team-control-line">
            <HubFilterScroll className="my-team-positions">
              {HUB_POSITION_FILTERS.filter((pos) => pos === "ALL" || posCounts[pos] || pos === posFilter).map((pos) => (
                <HubFilterChip key={pos} active={posFilter === pos} disabled={pos !== "ALL" && !posCounts[pos]} onClick={() => {
                  setPosFilter(pos); setStatusFocus(null);
                }}>
                  {pos === "ALL" ? MY_TEAM_COPY.all : pos}<span className="hub-filter-count">{posCounts[pos] || 0}</span>
                </HubFilterChip>
              ))}
            </HubFilterScroll>
            <button type="button" className="my-team-icon" aria-label={MY_TEAM_COPY.search} aria-expanded={searchOpen} aria-controls="my-team-search" onClick={() => {
              setSearchOpen(!searchOpen); if (searchOpen) setSearch("");
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>
            </button>
          </div>
          {searchOpen && <input id="my-team-search" ref={searchRef} className="my-team-search" type="search" placeholder={MY_TEAM_COPY.search} aria-label={MY_TEAM_COPY.search} value={search} onChange={(event) => setSearch(event.target.value)} />}
          {statusFocus === "extend" && <button type="button" className="btn-ghost" onClick={() => setStatusFocus(null)}>{MY_TEAM_COPY.clearExtensionFilter}</button>}
          <span className="sr-only" role="status">{MY_TEAM_COPY.showingCount(displayedRoster.length, sortedRoster.length)}</span>
        </div>
        <p className="my-team-season-caption">{scoreError ? MY_TEAM_COPY.scoringError : seasonScores?.host === "sleeper" && !seasonScores?.available ? MY_TEAM_COPY.syncSeasonScores : MY_TEAM_COPY.seasonSoFar(seasonScores?.season ?? season)}</p>
        <section className="my-team-roster" aria-label={MY_TEAM_COPY.rosterHeading}>
          {displayedRoster.map((row) => {
            const vm = rowViewModel(row);
            const secondary = [normalizeHubPosition(row.position), row.team, usesSalaries ? contractTypeLabel(vm.ctype) : "", showManagerTeam ? row.manager_team : ""].filter(Boolean).join(" · ");
            return <button key={rosterSlotKey(row)} type="button" className={`my-team-player${isLeague ? " has-season-scores" : ""}`} onClick={(event) => openContractPanel(row, event.currentTarget)} aria-label={MY_TEAM_COPY.openPlayer(row.player_name, usesSalaries)}>
              <span className="my-team-player-identity">
                <strong>{row.player_name}</strong><span>{secondary}</span>
                {((usesSalaries && vm.status.key !== "ok") || !rosterRowOccupies(row)) && <span className={`my-team-player-status is-${vm.status.tone}`}>{vm.status.label}</span>}
              </span>
              {isLeague && <SeasonNumbers score={seasonScores?.players?.[row.player_id]} />}
              {usesSalaries && <span className="my-team-term"><strong>{fmtSal(vm.edit.salary)}</strong><span>{MY_TEAM_COPY.years(vm.edit.years)}</span></span>}
              <span className="my-team-arrow" aria-hidden="true">↗</span>
            </button>;
          })}
          {!displayedRoster.length && <p className="my-team-no-results" role="status">{MY_TEAM_COPY.noResults}</p>}
        </section>
      </div>}

      <footer className="my-team-footer">
        <nav aria-label={MY_TEAM_COPY.related}>
          {onNavigate && <button type="button" className="my-team-footer-action" onClick={() => onNavigate("trades")}>{MY_TEAM_COPY.trades} <span aria-hidden="true">↗</span></button>}
          {isLeague && hubContext?.league_id && hubContext?.team_id && <button type="button" className="my-team-footer-action" onClick={() => setLookOpen(true)}>{MY_TEAM_COPY.appearance} <span aria-hidden="true">↗</span></button>}
        </nav>
      {usesSalaries && <ContractRulesDisclosure
        contractsReadOnly={contractsReadOnly}
        isLeague={isLeague}
        isCommissioner={isCommissioner}
        officeLink={officeLink}
        defaultStepUp={defaultStepUp}
        maxYears={maxYears}
        rules={workspace?.rules}
        season={season}
        draftCompleted={draftCompleted}
      />}

      </footer>
      {panelProps && <ContractPanel title={usesSalaries ? MY_TEAM_COPY.contract : MY_TEAM_COPY.playerDetails} onClose={closeContractPanel}>
        {error && <div className={isRookieExtendSuccessMessage(error) ? "hub-msg" : "error"} role="status">{error}</div>}
        <ContractSidePanelBody {...panelProps} seasonScore={isLeague ? seasonScores?.players?.[selectedRow.player_id] : undefined} showSeasonScores={isLeague} />
      </ContractPanel>}
    </HubPage>
  );

  if (!isLeague || !hubContext?.team_id) return rosterPage;
  return <>
    <div className="my-team-tabs" role="group" aria-label="My team view">
      <button type="button" aria-pressed={roomTab === "room"} onClick={() => setRoomTab("room")}>{MY_TEAM_COPY.room}</button>
      <button ref={manageTabRef} type="button" aria-pressed={roomTab === "manage"} onClick={() => setRoomTab("manage")}>{usesSalaries ? MY_TEAM_COPY.manage : MY_TEAM_COPY.playerDetails}</button>
    </div>
    {roomTab === "room" ? <TeamRoom key={`${hubContext.league_id}:${hubContext.team_id}`} cacheScope={cacheScope} leagueId={hubContext.league_id} teamId={hubContext.team_id}
      onContract={usesSalaries ? (pid) => { setRoomTab("manage"); openContractPanel(pid, manageTabRef.current); } : null}
      onAppearance={() => { setRoomTab("manage"); setLookOpen(true); }}
      onLineup={() => onNavigate?.("week")} /> : rosterPage}
  </>;
}
