import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import { HubFilterChip, HubFilterScroll, HubPage } from "./HubUILayout";
import HubTabIntro from "./HubTabIntro";
import CommissionerLeagueRosters from "./CommissionerLeagueRosters";
import TeamSalarySheets from "./TeamSalarySheets";
import LeagueContractHistory from "./LeagueContractHistory";
import LeagueChat from "./LeagueChat";
import LeagueInvites from "./LeagueInvites";
import LeagueSleeperConnect from "./LeagueSleeperConnect";
import {
  defaultOfficeTab,
  isOfficeTabAllowed,
  visibleOfficeTabs,
} from "./hubOfficeTabs";
import { seasonCapYearHint } from "./rosterFormat";

function OfficeMembers({ leagueId, hubContext, onChanged }) {
  const [teams, setTeams] = useState([]);
  const [commissionerSub, setCommissionerSub] = useState("");
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
  const overview = useMemo(
    () => ({
      league: { sleeper_league_id: hubContext?.sleeper_league_id },
      teams: teams.map((t) => ({ team: t })),
    }),
    [teams, hubContext?.sleeper_league_id],
  );

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

  return (
    <div className="hub-office-members">
      <div className="hub-roster-team-stats" aria-label="Membership summary">
        <span><strong>{claimed}</strong> / {teams.length} claimed</span>
        <span><strong>{sleeperLinked}</strong> / {teams.length} Sleeper-linked</span>
      </div>

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
              {isPrimary && <th />}
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
              return (
                <tr key={t.id}>
                  <td>{t.name}</td>
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
                  {isPrimary && (
                    <td>
                      {t.user_sub && !isPrimaryTeam && (
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={busy === t.id}
                          onClick={() => toggleCoCommish(t.id, !t.is_commissioner)}
                        >
                          {t.is_commissioner ? "Remove co-commish" : "Make co-commish"}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="hub-office-members-connect">
        <header className="hub-section-head">
          <h3 className="hub-section-title">Sleeper mapping</h3>
          <p className="hub-section-hint">Connect hub teams to Sleeper rosters.</p>
        </header>
        <LeagueSleeperConnect
          leagueId={leagueId}
          hubContext={hubContext}
          overview={overview}
          onConnected={() => {
            load();
            onChanged?.();
          }}
        />
      </div>

      <div className="hub-office-members-invites">
        <header className="hub-section-head">
          <h3 className="hub-section-title">Invites</h3>
          <p className="hub-section-hint">Email invites can include co-commissioner access.</p>
        </header>
        <LeagueInvites
          leagueId={leagueId}
          hubContext={hubContext}
          onChanged={onChanged}
        />
      </div>
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
  active = true,
}) {
  const isCommissioner = Boolean(hubContext?.is_commissioner);
  const tabs = useMemo(() => visibleOfficeTabs(isCommissioner), [isCommissioner]);
  const activeTab = isOfficeTabAllowed(officeTab, isCommissioner)
    ? officeTab
    : defaultOfficeTab(isCommissioner);
  const [historySeason, setHistorySeason] = useState("current");
  const season = Number(hubContext?.season || new Date().getFullYear());
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
    // Keep URL in sync only while Office is the visible hub tab. This pane stays
    // mounted (display:none) after first visit — syncing when inactive yanks
    // navigation back to /hub/office whenever officeTab is cleared.
    if (!active) return;
    if (officeTab !== activeTab) onOfficeTabChange?.(activeTab);
  }, [active, officeTab, activeTab, onOfficeTabChange]);

  // "Current" = planning season (may have no rows yet — seed via pre-draft).
  const seasonFilter = historySeason === "current" ? String(season) : historySeason;

  return (
    <div className="hub-league-office">
      <HubTabIntro
        title="Office"
        purpose={
          isCommissioner
            ? "Chat, edit live contracts, reconcile historic sheets, and manage members."
            : "League chat — talk with every team."
        }
      />

      <div className="hub-filter-bar">
        <HubFilterScroll>
          {tabs.map((t) => (
            <HubFilterChip
              key={t.id}
              active={activeTab === t.id}
              onClick={() => onOfficeTabChange?.(t.id)}
            >
              {t.label}
            </HubFilterChip>
          ))}
        </HubFilterScroll>
      </div>

      {activeTab === "chat" && (
        <HubPage>
          <LeagueChat leagueId={leagueId} hubContext={hubContext} />
        </HubPage>
      )}

      {activeTab === "current" && isCommissioner && (
        <HubPage>
          <p className="chart-note">
            Live keepers for season {hubContext?.season}. Use{" "}
            <button type="button" className="btn-link" onClick={() => onNavigate?.("planner")}>
              Cap
            </button>
            {" "}for extend / FA, or{" "}
            <button type="button" className="btn-link" onClick={() => onOfficeTabChange?.("historic")}>
              Historic
            </button>
            {" "}for past year sheets.
          </p>
          <CommissionerLeagueRosters
            leagueId={leagueId}
            season={hubContext?.season}
            workspace={workspace}
            hubContext={hubContext}
            onChanged={onChanged}
          />
        </HubPage>
      )}

      {activeTab === "historic" && isCommissioner && (
        <>
          {seasonOptions?.length > 0 && (
            <div className="hub-filter-bar">
              <label className="hub-league-search">
                <span className="visually-hidden">Season</span>
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
              <p className="hub-section-hint">
                {seasonCapYearHint(historySeason === "current" ? season : historySeason)}
                {" "}Edit Pos, $, Status, and Acquired on the table.
              </p>
            </header>
            <TeamSalarySheets
              leagueId={leagueId}
              seasonFilter={seasonFilter}
              isCommissioner={isCommissioner}
              embedded
            />
          </HubPage>
          <HubPage>
            <details className="hub-office-advanced">
              <summary>Advanced · bulk audit (optional)</summary>
              <p className="chart-note" style={{ marginTop: 0 }}>
                Optional bulk audit and import tools — day-to-day edits stay on the table above.
              </p>
              <LeagueContractHistory
                leagueId={leagueId}
                hubContext={hubContext}
                seasonFilter={seasonFilter}
                embedded
              />
            </details>
          </HubPage>
        </>
      )}

      {activeTab === "members" && isCommissioner && (
        <HubPage>
          <OfficeMembers
            leagueId={leagueId}
            hubContext={hubContext}
            onChanged={onChanged}
          />
        </HubPage>
      )}
    </div>
  );
}
