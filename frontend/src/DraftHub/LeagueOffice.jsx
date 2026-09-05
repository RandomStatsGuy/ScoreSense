import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import { HubAlert, HubFilterChip, HubFilterScroll, HubPage, HubPageSticky } from "./HubUILayout";
import HubTabIntro from "./HubTabIntro";
import CommissionerLeagueRosters from "./CommissionerLeagueRosters";
import TeamSalarySheets from "./TeamSalarySheets";
import LeagueContractHistory from "./LeagueContractHistory";
import LeagueInvites from "./LeagueInvites";
import LeagueSleeperConnect from "./LeagueSleeperConnect";
import CapSheetImport from "./CapSheetImport";
import { hubTeamLabel } from "./hubTeamLabel";
import {
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
  tabsWithGroupLabels,
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

function OfficeMembers({ leagueId, hubContext, onChanged }) {
  const [teams, setTeams] = useState([]);
  const [commissionerSub, setCommissionerSub] = useState("");
  const [resize, setResize] = useState(null);
  const [franchiseName, setFranchiseName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const isPrimary = Boolean(hubContext?.is_primary_commissioner);

  const load = useCallback(async () => {
    if (!leagueId) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/members`);
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setTeams(data.teams || []);
      setCommissionerSub(data.commissioner_sub || "");
      setResize(data.resize || null);
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setLoading(false);
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
      onChanged?.(data.hub_context);
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setBusy("");
    }
  };

  const addFranchise = async (e) => {
    e.preventDefault();
    const name = franchiseName.trim();
    if (!name) return;
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
      setFranchiseName("");
      setResize(data.resize || null);
      await load();
      onChanged?.(data.hub_context);
    } catch (err) {
      setError(connectionErrorMessage(err));
    } finally {
      setBusy("");
    }
  };

  const removeFranchise = async (teamId, teamName) => {
    const label = teamName || "this seat";
    if (!window.confirm(removeFranchiseConfirm(label))) {
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
      setResize(data.resize || null);
      await load();
      onChanged?.(data.hub_context);
    } catch (err) {
      setError(connectionErrorMessage(err));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="hub-office-members">
      <header className="hub-section-head">
        <h3 className="hub-section-title">Membership</h3>
        <p className="hub-section-hint">
          Who claimed each team and co-commissioner roles. Invites and Sleeper mapping live under Access.
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

      <section className="hub-office-franchises" aria-label="Seats">
        <header className="hub-section-head">
          <h3 className="hub-section-title">Seats</h3>
          <p className="hub-section-hint">{franchiseResizeHint()}</p>
        </header>
        {canAddSeat({
          configured: resize?.team_count,
          actual: resize?.actual_teams ?? teams.length,
        }) ? (
          <>
        {addPreview?.blocker ? (
          <HubAlert variant="warn">{addPreview.blocker}</HubAlert>
        ) : (
          <p className="chart-note">
            {addFranchiseSupport({
              nextCount: addPreview?.next_team_count,
              cap: addPreview?.salary_cap,
            })}
          </p>
        )}
        <form className="hub-form-row" onSubmit={addFranchise}>
          <label>
            New seat
            <input
              type="text"
              value={franchiseName}
              onChange={(e) => setFranchiseName(e.target.value)}
              maxLength={80}
              disabled={!addPreview?.ok || busy === "add"}
            />
          </label>
          <button
            type="submit"
            className="btn-primary btn-sm"
            disabled={!addPreview?.ok || !franchiseName.trim() || busy === "add"}
          >
            {busy === "add" ? "Adding…" : addFranchiseLabel()}
          </button>
        </form>
          </>
        ) : (
          <p className="chart-note">{franchiseResizeHint()}</p>
        )}
      </section>

      {error && <div className="error">{error}</div>}
      {loading && <p className="chart-note">Loading members…</p>}

      <div className="table-wrap">
        <table className="data-table hub-table">
          <thead>
            <tr>
              <th>Team</th>
              <th>Account</th>
              <th>Sleeper</th>
              <th>Role</th>
              <th>Sync</th>
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
                  <td>{t.user_sub ? "Claimed" : "Unclaimed"}</td>
                  <td>
                    {t.sleeper_roster_id
                      ? (t.sleeper_team_name || "Linked")
                      : "Not linked"}
                  </td>
                  <td>{role}</td>
                  <td className="table-meta">
                    {t.sleeper_synced_at
                      ? new Date(t.sleeper_synced_at).toLocaleString()
                      : "—"}
                  </td>
                  <td>
                    {isPrimary && t.user_sub && !isPrimaryTeam && (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={busy === t.id}
                        onClick={() => toggleCoCommish(t.id, !t.is_commissioner)}
                      >
                        {t.is_commissioner ? "Remove co-commish" : "Make co-commish"}
                      </button>
                    )}
                    {removal?.ok ? (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={busy === t.id}
                        onClick={() => removeFranchise(t.id, t.name)}
                      >
                        {busy === t.id ? "Removing…" : removeFranchiseLabel()}
                      </button>
                    ) : (
                      removal?.blocker && !isPrimaryTeam ? (
                        <span className="table-meta">{removeFranchiseBlocked(removal.blocker)}</span>
                      ) : null
                    )}
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

function OfficeAccess({ leagueId, hubContext, workspace, onChanged }) {
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
          <p className="hub-section-hint">
            Assign a named email to one seat. The invite link lives on Draft.
          </p>
        </header>
        <LeagueInvites
          leagueId={leagueId}
          hubContext={hubContext}
          onChanged={onChanged}
        />
      </section>

      <section className="hub-office-access-section">
        <header className="hub-section-head">
          <h3 className="hub-section-title">Sleeper mapping</h3>
          <p className="hub-section-hint">Connect each seat to a Sleeper roster.</p>
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
  const navItems = useMemo(
    () => (mobileLayout ? tabs.map((tab) => ({ type: "tab", ...tab })) : tabsWithGroupLabels(tabs)),
    [tabs, mobileLayout],
  );
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
      <HubTabIntro
        title={mobileLayout ? null : intro.title}
        purpose={intro.purpose}
        audience={intro.audience}
      />

      {isCommissioner && (
        <p className="hub-office-admin-boundary" role="note">
          Changes here apply league-wide. Day-to-day roster and cap decisions stay on My team and Cap.
        </p>
      )}

      <HubPageSticky>
      <div className="hub-filter-bar hub-office-tab-bar">
        <HubFilterScroll>
          {navItems.map((item) => (
            item.type === "label" ? (
              <span key={item.id} className="hub-office-tab-group" aria-hidden="true">
                {item.label}
              </span>
            ) : (
              <HubFilterChip
                key={item.id}
                active={activeTab === item.id}
                onClick={() => onOfficeTabChange?.(item.id)}
              >
                {item.label}
              </HubFilterChip>
            )
          ))}
        </HubFilterScroll>
      </div>
      </HubPageSticky>

      {activeTab === "current" && isCommissioner && (
        <HubPage>
          <header className="hub-section-head">
            <h3 className="hub-section-title">Live contracts</h3>
            <p className="hub-section-hint">
              {liveContractStage(hubContext?.season, {
                draftCompleted: Boolean(hubContext?.draft_completed),
                leagueStatus: hubContext?.league_status,
              }).yearLabel}
              {" "}keepers.
            </p>
            <div className="hub-office-contract-links">
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
            onSaved={onWorkspaceSaved}
          />
        </HubPage>
      )}

      {activeTab === "historic" && isCommissioner && (
        <>
          {seasonOptions?.length > 0 && (
            <div className="hub-filter-bar">
              <label className="hub-league-search">
                <span className="sr-only">Season</span>
                <select
                  className="hub-league-switcher-select"
                  value={historySeason || "current"}
                  onChange={(e) => setHistorySeason(e.target.value)}
                >
                  {seasonOptions.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </label>
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
          />
        </HubPage>
      )}
    </div>
  );
}
