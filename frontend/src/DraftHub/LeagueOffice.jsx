import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirmDialog } from "../ui/confirm";
import { LEAGUE_TEAM_SIZES } from "./leagueCreateJoin";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import { HubAlert, HubExperienceHero, HubFilterChip, HubFilterMenu, HubFilterScroll, HubPage, HubPageSticky } from "./HubUILayout";
import CommissionerLeagueRosters from "./CommissionerLeagueRosters";
import TeamSalarySheets from "./TeamSalarySheets";
import LeagueContractHistory from "./LeagueContractHistory";
import LeagueInvites from "./LeagueInvites";
import LeagueSleeperConnect from "./LeagueSleeperConnect";
import CapSheetImport from "./CapSheetImport";
import { hubTeamLabel } from "./hubTeamLabel";
import {
  LEAGUE_SIZE_COPY,
  addFranchiseLabel,
  addFranchiseSupport,
  canAddSeat,
  franchiseResizeHint,
  franchiseSeatSummary,
  removeFranchiseBlocked,
  removeFranchiseConfirm,
  removeFranchiseLabel,
} from "./leagueAccessCopy";
import LeagueSheetImport from "./LeagueSheetImport";
import OfficeLeagueLifecycle from "./OfficeLeagueLifecycle";
import {
  defaultOfficeTab,
  isOfficeTabAllowed,
  visibleOfficeTabs,
} from "./hubOfficeTabs";
import {
  commissionerIntro,
  markSheetsGuideSeen,
  sheetsDefaultHint,
  sheetsGuideCopy,
  shouldAutoOpenSheetsGuide,
} from "./commissionerSections";
import { liveContractStage } from "./officeCurrentContracts";
import AwardTitlesEditor from "./insights/AwardTitlesEditor";
import { awardCatalogFromRules } from "./insights/insightsPresentation";

/** Mount bulk contract-history tools only after the commissioner opens Advanced. */
function OfficeAdvancedAudit({ leagueId, hubContext, seasonFilter }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="hub-office-advanced"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Advanced · bulk audit (optional)</summary>
      <p className="chart-note" style={{ marginTop: 0 }}>
        Optional bulk audit and import tools — day-to-day edits stay on the table above.
      </p>
      {open && (
        <LeagueContractHistory
          leagueId={leagueId}
          hubContext={hubContext}
          seasonFilter={seasonFilter}
          embedded
        />
      )}
    </details>
  );
}

function SheetsYearGuide({ year }) {
  const guide = useMemo(() => sheetsGuideCopy(year), [year]);
  const [open, setOpen] = useState(() => shouldAutoOpenSheetsGuide());

  return (
    <details
      className="hub-sheets-guide"
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        setOpen(next);
        if (!next) markSheetsGuideSeen();
      }}
    >
      <summary>{guide.summary}</summary>
      <div className="hub-sheets-guide-body">
        {guide.paragraphs.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
    </details>
  );
}

export function OfficeMembers({ leagueId, hubContext, onChanged, onNavigate }) {
  const [teams, setTeams] = useState([]);
  const [commissionerSub, setCommissionerSub] = useState("");
  const [resize, setResize] = useState(null);
  const [franchiseName, setFranchiseName] = useState("");
  const [targetSize, setTargetSize] = useState(12);
  const [notice, setNotice] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const isPrimary = Boolean(hubContext?.is_primary_commissioner);

  const load = useCallback(async (keepTarget = false) => {
    if (!leagueId) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/members`);
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      if (!mounted.current) return;
      if (!keepTarget) setTargetSize(data.resize?.team_count || 12);
      setTeams(data.teams || []);
      setCommissionerSub(data.commissioner_sub || "");
      setResize(data.resize || null);
    } catch (e) {
      if (mounted.current) setError(connectionErrorMessage(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [leagueId]);

  useEffect(() => {
    load();
  }, [load]);

  const claimed = teams.filter((t) => t.user_sub).length;
  const sleeperLinked = teams.filter((t) => t.sleeper_roster_id).length;
  const addPreview = resize?.add || null;
  const removals = useMemo(() => {
    const byId = new Map((resize?.removals || []).map((row) => [String(row.team_id), row]));
    return byId;
  }, [resize]);

  const toggleCoCommish = async (teamId, enabled) => {
    if (busy || loading) return;
    setBusy(teamId);
    setError("");
    try {
      const res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/teams/${encodeURIComponent(teamId)}/co-commissioner`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      await load();
      if (!mounted.current) return;
      onChanged?.(data.hub_context);
    } catch (e) {
      if (mounted.current) setError(connectionErrorMessage(e));
    } finally {
      if (mounted.current) setBusy("");
    }
  };

  const addFranchise = async (e) => {
    e.preventDefault();
    const name = franchiseName.trim();
    if (!name || busy || loading) return;
    setBusy("add");
    setError("");
    try {
      const res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/franchises`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      if (!mounted.current) return;
      setNotice(LEAGUE_SIZE_COPY.added(name));
      setFranchiseName("");
      setResize(data.resize || null);
      await load();
      if (!mounted.current) return;
      onChanged?.(data.hub_context);
    } catch (err) {
      if (mounted.current) setError(connectionErrorMessage(err));
    } finally {
      if (mounted.current) setBusy("");
    }
  };

  const removeFranchise = async (teamId, teamName) => {
    if (busy || loading) return;
    const label = teamName || "this team";
    const preview = removals.get(String(teamId));
    if (!(await confirmDialog({
      title: removeFranchiseLabel(),
      message: removeFranchiseConfirm(label, preview),
      confirmLabel: removeFranchiseLabel(),
      danger: true,
    })) || !mounted.current) {
      return;
    }
    setBusy(teamId);
    setError("");
    try {
      const res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/franchises/${encodeURIComponent(teamId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      if (!mounted.current) return;
      setNotice(LEAGUE_SIZE_COPY.removed(label, data.resize?.team_count));
      setResize(data.resize || null);
      await load(targetSize !== resize?.team_count);
      if (!mounted.current) return;
      onChanged?.(data.hub_context);
    } catch (err) {
      if (mounted.current) setError(connectionErrorMessage(err));
    } finally {
      if (mounted.current) setBusy("");
    }
  };

  const actual = resize?.actual_teams ?? teams.length;
  const configured = resize?.team_count;
  const sizeOptions = [...new Set([...LEAGUE_TEAM_SIZES, configured].filter(Boolean))].sort((a, b) => a - b);
  const sizeBlocked = resize?.blocker || (targetSize < actual ? LEAGUE_SIZE_COPY.preview(targetSize, actual) : "");
  const saveSize = async (e) => {
    e.preventDefault();
    if (busy || loading || sizeBlocked || targetSize === configured) return;
    setBusy("size");
    setError("");
    setNotice("");
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/size`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_count: targetSize }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      if (!mounted.current) return;
      await load();
      if (!mounted.current) return;
      setNotice(LEAGUE_SIZE_COPY.saved(data.league.team_count));
      onChanged?.(data.hub_context);
    } catch (err) {
      if (mounted.current) setError(connectionErrorMessage(err));
    } finally {
      if (mounted.current) setBusy("");
    }
  };

  return (
    <div className="hub-office-members">
      <header className="hub-section-head">
        <h3 className="hub-section-title">Members</h3>
        <p className="hub-section-hint">
          See who manages each team and update commissioner access. Manage invitations and Sleeper connections under Access & imports.
        </p>
      </header>

      <div className="hub-roster-team-stats" aria-label="Membership summary">
        <span><strong>{claimed}</strong> / {teams.length} claimed</span>
        <span><strong>{sleeperLinked}</strong> / {teams.length} Sleeper-linked</span>
        <span>
          {franchiseSeatSummary({
            configured: resize?.team_count,
            actual: resize?.actual_teams ?? teams.length,
          })}
        </span>
      </div>

      <section className="hub-office-franchises" aria-label={LEAGUE_SIZE_COPY.title}>
        <header className="hub-section-head">
          <h3 className="hub-section-title">{LEAGUE_SIZE_COPY.title}</h3>
          <p className="hub-section-hint">{franchiseResizeHint()}</p>
        </header>
        <form className="hub-form-row" onSubmit={saveSize}>
          <HubFilterMenu
            label={LEAGUE_SIZE_COPY.size}
            value={targetSize}
            options={sizeOptions.map((n) => ({ id: n, label: `${n} teams` }))}
            onChange={(value) => setTargetSize(Number(value))}
            disabled={loading || Boolean(busy) || Boolean(resize?.blocker)}
          />
          <button type="submit" className="btn-primary btn-sm"
            disabled={loading || Boolean(busy) || Boolean(sizeBlocked) || targetSize === configured}>
            {busy === "size" ? LEAGUE_SIZE_COPY.saving : LEAGUE_SIZE_COPY.save}
          </button>
          <button type="button" className="btn-ghost btn-sm" onClick={() => onNavigate?.("room")}>
            {LEAGUE_SIZE_COPY.invite}
          </button>
        </form>
        {resize && <p className="chart-note" role="status">{sizeBlocked || LEAGUE_SIZE_COPY.preview(targetSize, actual)}</p>}
        <h4 className="hub-section-title">{LEAGUE_SIZE_COPY.addTitle}</h4>
        {addPreview?.blocker && addPreview.blocker !== resize?.blocker && <HubAlert variant="warn">{addPreview.blocker}</HubAlert>}
        {addPreview && !addPreview.blocker && (
          <p className="chart-note">{addFranchiseSupport({ nextCount: addPreview.next_team_count, currentCount: configured, cap: addPreview.salary_cap })}</p>
        )}
        <form className="hub-form-row" onSubmit={addFranchise}>
          <label>
            {LEAGUE_SIZE_COPY.teamName}
            <input type="text" value={franchiseName} onChange={(e) => setFranchiseName(e.target.value)}
              placeholder={LEAGUE_SIZE_COPY.teamPlaceholder} maxLength={80}
              disabled={loading || !addPreview?.ok || Boolean(busy)} />
          </label>
          <button type="submit" className="btn-ghost btn-sm"
            disabled={loading || !addPreview?.ok || !franchiseName.trim() || Boolean(busy) || !canAddSeat({ configured, actual })}>
            {busy === "add" ? "Adding…" : addFranchiseLabel({ configured, actual })}
          </button>
        </form>
      </section>

      {notice && <HubAlert variant="info">{notice}</HubAlert>}
      {error && <div className="error">{error}</div>}
      {loading && <p className="chart-note">Loading members…</p>}

      <div className="table-wrap hub-members-table-wrap">
        <table className="data-table hub-table hub-members-table">
          <thead>
            <tr>
              <th>Team</th>
              <th>Account</th>
              <th>Sleeper</th>
              <th>Role</th>
              <th>Last sync</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => {
              const isPrimaryTeam = commissionerSub
                && t.user_sub
                && String(t.user_sub) === String(commissionerSub);
              const role = isPrimaryTeam
                ? "Primary"
                : (t.is_commissioner ? "Co-commish" : "Member");
              const removal = removals.get(String(t.id));
              return (
                <tr key={t.id}>
                  <td>{hubTeamLabel(t)}</td>
                  <td data-label="Account">{t.user_sub ? "Claimed" : "Unclaimed"}</td>
                  <td data-label="Sleeper">
                    {t.sleeper_roster_id
                      ? (t.sleeper_team_name || "Linked")
                      : "Not linked"}
                  </td>
                  <td data-label="Role">{role}</td>
                  <td className="table-meta" data-label="Last sync">
                    {t.sleeper_synced_at
                      ? new Date(t.sleeper_synced_at).toLocaleString()
                      : "—"}
                  </td>
                  <td>
                    <div className="hub-member-actions">
                    {isPrimary && t.user_sub && !isPrimaryTeam && (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={loading || Boolean(busy)}
                        onClick={() => toggleCoCommish(t.id, !t.is_commissioner)}
                      >
                        {t.is_commissioner ? "Remove co-commish" : "Make co-commish"}
                      </button>
                    )}
                    {removal?.ok ? (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={loading || Boolean(busy)}
                        aria-label={`${removeFranchiseLabel()}: ${hubTeamLabel(t)}`}
                        onClick={() => removeFranchise(t.id, hubTeamLabel(t))}
                      >
                        {busy === t.id ? "Removing…" : removeFranchiseLabel()}
                      </button>
                    ) : (
                      removal?.blocker && !isPrimaryTeam ? (
                        <span className="table-meta">{removeFranchiseBlocked(removal.blocker)}</span>
                      ) : null
                    )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OfficeAccess({ leagueId, hubContext, workspace, onChanged, onNavigate }) {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!leagueId) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/members`);
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setTeams(data.teams || []);
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [leagueId]);

  useEffect(() => {
    load();
  }, [load]);

  const overview = useMemo(
    () => ({
      league: { sleeper_league_id: hubContext?.sleeper_league_id },
      teams: teams.map((t) => ({ team: t })),
    }),
    [teams, hubContext?.sleeper_league_id],
  );

  return (
    <div className="hub-office-access">
      <section className="hub-office-access-section">
        <header className="hub-section-head">
          <h3 className="hub-section-title">Invites</h3>

        </header>
        <LeagueInvites
          leagueId={leagueId}
          hubContext={hubContext}
          onChanged={onChanged}
        />
      </section>

      <section className="hub-office-access-section">
        <header className="hub-section-head">
          <h3 className="hub-section-title">Sleeper team connections</h3>
          <p className="hub-section-hint">Connect each team to its Sleeper roster.</p>
        </header>
        {error && <div className="error">{error}</div>}
        {loading && <p className="chart-note">Loading teams…</p>}
        {!loading && (
          <LeagueSleeperConnect
            leagueId={leagueId}
            hubContext={hubContext}
            overview={overview}
            onConnected={() => {
              load();
              onChanged?.();
            }}
          />
        )}
      </section>

      <section className="hub-office-access-section">
        <header className="hub-section-head">
          <h3 className="hub-section-title">Imports</h3>
          <p className="hub-section-hint">Bring in league or cap sheets from CSV / Excel.</p>
        </header>
        <LeagueSheetImport
          season={workspace?.season || hubContext?.season}
          onImported={onChanged}
          embedded
          commissionerMode
        />
        <CapSheetImport onImported={onChanged} embedded />
      </section>

      <OfficeLeagueLifecycle
        leagueId={leagueId}
        leagueName={hubContext?.league_name}
        onChanged={onChanged}
        onNavigate={onNavigate}
      />
    </div>
  );
}

export default function LeagueOffice({
  leagueId,
  hubContext,
  workspace,
  officeTab,
  onOfficeTabChange,
  onChanged,
  onNavigate,
  onWorkspaceSaved,
  active = true,
}) {
  const mobileLayout = useMobileLayout();
  const isCommissioner = Boolean(hubContext?.is_commissioner);
  const tabs = useMemo(() => visibleOfficeTabs(isCommissioner), [isCommissioner]);
  const intro = useMemo(() => commissionerIntro(isCommissioner), [isCommissioner]);
  const activeTab = isOfficeTabAllowed(officeTab, isCommissioner)
    ? officeTab
    : defaultOfficeTab(isCommissioner);
  const [historySeason, setHistorySeason] = useState("current");
  const [dataEpoch, setDataEpoch] = useState(0);
  const season = Number(hubContext?.season || new Date().getFullYear());
  const handleChanged = useCallback(() => {
    setDataEpoch((n) => n + 1);
    onChanged?.();
  }, [onChanged]);
  const seasonOptions = useMemo(() => {
    const years = [];
    for (let y = season; y >= season - 6; y -= 1) {
      years.push({
        value: String(y),
        label: y === season
          ? `${y} season (pre-draft / after draft)`
          : `${y} season (after ${y} draft)`,
      });
    }
    return [{ value: "current", label: `Current (${season} season)` }, ...years];
  }, [season]);

  useEffect(() => {
    // Keep URL in sync only while Roster management is the visible Fantasy tab. This pane stays
    // mounted (display:none) after first visit — syncing when inactive yanks
    // navigation back to /hub/office whenever officeTab is cleared.
    if (!active) return;
    if (officeTab !== activeTab) onOfficeTabChange?.(activeTab);
  }, [active, officeTab, activeTab, onOfficeTabChange]);

  // "Current" = planning season (may have no rows yet — seed via pre-draft).
  const seasonFilter = historySeason === "current" ? String(season) : historySeason;
  const guideYear = historySeason === "current" ? season : historySeason;

  return (
    <div className="hub-league-office">
      <HubExperienceHero
        eyebrow="Roster management"
        heading={mobileLayout ? null : intro.title}
        support={intro.purpose}
        compact={mobileLayout}
      />

      {isCommissioner && (
        <p className="hub-office-admin-boundary" role="note">
          Changes here apply league-wide. Day-to-day roster and cap decisions stay on My team and Cap.
        </p>
      )}

      <HubPageSticky>
      <div className="hub-filter-bar hub-office-tab-bar">
        <HubFilterScroll>
          {tabs.map((tab) => (
            <HubFilterChip
              key={tab.id}
              active={activeTab === tab.id}
              onClick={() => onOfficeTabChange?.(tab.id)}
            >
              {tab.label}
            </HubFilterChip>
          ))}
        </HubFilterScroll>
      </div>
      </HubPageSticky>

      {activeTab === "current" && isCommissioner && (
        <HubPage>
          <header className="hub-section-head">
            <h3 className="hub-section-title">Current contracts</h3>
            <p className="hub-section-hint">
              {liveContractStage(hubContext?.season, {
                draftCompleted: Boolean(hubContext?.draft_completed),
                leagueStatus: hubContext?.league_status,
              }).sectionHint}
            </p>
            <div className="hub-office-contract-links" role="group" aria-label="Open related views">
              <span className="hub-filter-label">Related</span>
              <button type="button" className="btn-ghost btn-sm" onClick={() => onNavigate?.("planner")}>
                Cap
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => onOfficeTabChange?.("historic")}>
                Sheets
              </button>
            </div>
          </header>
          <CommissionerLeagueRosters
            leagueId={leagueId}
            season={hubContext?.season}
            workspace={workspace}
            hubContext={hubContext}
            onChanged={handleChanged}
            reloadNonce={dataEpoch}
          />
          <AwardTitlesEditor
            catalog={awardCatalogFromRules(workspace?.rules)}
            currentRules={workspace?.rules || hubContext?.rules}
            leagueId={leagueId}
            onSaved={onWorkspaceSaved}
          />
        </HubPage>
      )}

      {activeTab === "historic" && isCommissioner && (
        <>
          {seasonOptions?.length > 0 && (
            <div className="hub-filter-bar">
              <HubFilterMenu
                label="Season"
                value={historySeason || "current"}
                options={seasonOptions.map((s) => ({ id: s.value, label: s.label }))}
                onChange={setHistorySeason}
              />
            </div>
          )}
          <HubPage>
            <header className="hub-section-head">
              <h2 className="hub-tab-intro-title">Salary sheets</h2>
              <p className="hub-section-hint">{sheetsDefaultHint()}</p>
            </header>
            <SheetsYearGuide year={guideYear} />
            <TeamSalarySheets
              leagueId={leagueId}
              seasonFilter={seasonFilter}
              isCommissioner={isCommissioner}
              reloadNonce={dataEpoch}
              embedded
            />
          </HubPage>
          <HubPage>
            <OfficeAdvancedAudit
              leagueId={leagueId}
              hubContext={hubContext}
              seasonFilter={seasonFilter}
            />
          </HubPage>
        </>
      )}

      {activeTab === "members" && isCommissioner && (
        <HubPage>
          <OfficeMembers
            key={leagueId}
            onNavigate={onNavigate}
            leagueId={leagueId}
            hubContext={hubContext}
            onChanged={handleChanged}
          />
        </HubPage>
      )}

      {activeTab === "access" && isCommissioner && (
        <HubPage>
          <OfficeAccess
            leagueId={leagueId}
            hubContext={hubContext}
            workspace={workspace}
            onChanged={handleChanged}
            onNavigate={onNavigate}
          />
        </HubPage>
      )}
    </div>
  );
}
