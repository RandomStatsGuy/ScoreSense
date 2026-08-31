import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import MobileDataList, { MobileStat } from "../MobileDataList";
import MobilePlayerCard from "../MobilePlayerCard";
import PlayerCell, { usePlayerMedia } from "../PlayerCell";
import { HubPage, HubTableCard } from "./HubUILayout";
import HubTabIntro from "./HubTabIntro";
import { fmtSal } from "./rosterFormat";
import { seedTradeFromPlayer } from "./tradeSeed";
import ContractHistoryLink from "./ContractHistoryLink";
import TeamIdentityMark from "./TeamIdentityMark";
import { identityFor, useTeamIdentities } from "./TeamIdentityContext";

function gradeLabel(grade) {
  if (grade === "good") return "Good value";
  if (grade === "bad") return "Overpay";
  if (grade === "fair") return "Fair";
  return null;
}

function gradeClass(grade) {
  if (grade === "good") return "hub-value-delta-pos";
  if (grade === "bad") return "hub-value-delta-neg";
  return "hub-value-delta-fair";
}

function contractGradeText(row) {
  const grade = gradeLabel(row.contract_grade);
  if (!grade) return null;
  const delta = row.value_delta;
  const fair = row.fair_value;
  const parts = [grade];
  if (delta != null) {
    parts.push(`(${delta <= 0 ? "" : "+"}${fmtSal(delta)})`);
  }
  if (fair != null) {
    parts.push(`vs ${fmtSal(fair)} fair`);
  }
  return parts.join(" ");
}

/** Compact chip for collapsed mobile cards — avoids multi-line contract cells. */
function contractGradeChip(row) {
  const grade = gradeLabel(row.contract_grade);
  if (!grade) return null;
  const delta = row.value_delta;
  if (delta == null || grade === "Fair") return grade;
  const deltaStr = `${delta <= 0 ? "" : "+"}${fmtSal(delta)}`;
  if (grade === "Good value") return `Value ${deltaStr}`;
  return `${grade} ${deltaStr}`;
}

export default function LeagueRostersBrowser({
  leagueId,
  hubContext,
  onNavigateTrade,
  onOpenContractHistory,
}) {
  const { identities } = useTeamIdentities();
  const mobileLayout = useMobileLayout();
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const myTeamId = hubContext?.team_id || "";
  const [teamId, setTeamId] = useState(myTeamId);

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (!leagueId) {
      setLoading(false);
      setOverview(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const q = refresh ? "?refresh=1" : "";
      const res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/rosters${q}`,
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setOverview(data);
      setTeamId((prev) => {
        if (prev && (data.teams || []).some((b) => b.team?.id === prev)) return prev;
        if (myTeamId && (data.teams || []).some((b) => b.team?.id === myTeamId)) return myTeamId;
        return data.teams?.[0]?.team?.id || "";
      });
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [leagueId, myTeamId]);

  useEffect(() => {
    load();
  }, [load]);

  const block = useMemo(
    () => (overview?.teams || []).find((b) => b.team?.id === teamId) || null,
    [overview, teamId],
  );
  const stats = block?.stats || {};
  const roster = useMemo(
    () => (block?.roster || []).filter((r) => String(r.roster_status || "active") === "active"),
    [block],
  );
  const playerIds = useMemo(() => roster.map((r) => r.player_id).filter(Boolean), [roster]);
  // Desktop table still uses headshots; skip the media fetch on mobile cards.
  const media = usePlayerMedia(mobileLayout ? [] : playerIds);

  const addToTrade = (row) => {
    seedTradeFromPlayer({
      player_id: row.player_id,
      player_name: row.player_name,
      team_id: teamId,
      salary: row.salary,
      position: row.position,
    });
    onNavigateTrade?.();
  };

  const tradeLabel = teamId === myTeamId ? "Add to trade" : "Trade for";

  return (
    <HubPage>
      <HubTabIntro
        title="Rosters"
        purpose="Browse every team’s contracts, spot good and bad deals, and start a trade."
      />
      {error && <div className="error">{error}</div>}
      {loading && !overview && <p className="chart-note">Loading league rosters…</p>}

      {overview && (
        <>
          <div className="hub-roster-browser-toolbar">
            <label className="hub-roster-browser-team">
              <span className="sr-only">Team</span>
              <select
                className="hub-league-switcher-select"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
              >
                {(overview.teams || []).map((b) => (
                  <option key={b.team.id} value={b.team.id}>
                    {b.team.name}
                    {b.team.id === myTeamId ? " (you)" : ""}
                  </option>
                ))}
              </select>
            </label>
            {block?.team && (
              <TeamIdentityMark
                team={block.team}
                identity={identityFor(identities, block.team)}
                size="md"
                showName
              />
            )}
            <button
              type="button"
              className="btn-ghost btn-sm hub-roster-browser-refresh"
              onClick={() => load({ refresh: true })}
            >
              Refresh
            </button>
          </div>

          {block && (
            <div className="hub-roster-team-stats" aria-label="Team summary">
              <span><strong>{fmtSal(stats.committed)}</strong> committed</span>
              <span><strong>{fmtSal(stats.dead_cap)}</strong> dead</span>
              <span><strong>{fmtSal(stats.unspent)}</strong> free</span>
              {stats.fp_per_dollar != null && (
                <span title="Projected fair-value fantasy points per dollar of salary">
                  <strong>{stats.fp_per_dollar}</strong> pts /$
                </span>
              )}
              {Object.entries(stats.by_position_spend || {}).map(([pos, amt]) => (
                <span key={pos} className="hub-insights-chip">
                  {pos} {fmtSal(amt)}
                  {stats.by_position_count?.[pos] != null
                    ? ` · ${stats.by_position_count[pos]}`
                    : ""}
                </span>
              ))}
            </div>
          )}

          <HubTableCard className="hub-roster-browser-table-wrap">
            {mobileLayout ? (
              <MobileDataList
                emptyMessage={!roster.length ? "No active players." : null}
              >
                {roster.map((r) => {
                  const gradeChip = contractGradeChip(r);
                  const gradeText = contractGradeText(r);
                  const yrs = r.years_remaining ?? r.contract_years ?? "—";
                  const actions = r.player_id
                    ? [
                        <button
                          key="trade"
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => addToTrade(r)}
                        >
                          {tradeLabel}
                        </button>,
                        <ContractHistoryLink
                          key="history"
                          playerId={r.player_id}
                          playerName={r.player_name}
                          onOpen={onOpenContractHistory}
                        />,
                      ]
                    : null;
                  return (
                    <MobilePlayerCard
                      key={r.player_id}
                      className={r.overpay ? "hub-overpay" : ""}
                      name={r.player_name}
                      meta={[r.team, r.position].filter(Boolean).join(" · ") || "—"}
                      heroValue={fmtSal(r.salary)}
                      heroLabel="cap"
                      heroSub={yrs !== "—" ? `${yrs} yr${yrs === 1 ? "" : "s"}` : undefined}
                      badge={(
                        <>
                          {gradeChip && (
                            <span
                              className={`hub-roster-grade-chip ${gradeClass(r.contract_grade)}`}
                              title={gradeText || undefined}
                            >
                              {gradeChip}
                            </span>
                          )}
                          {r.expire_chip === "extend" && (
                            <span className="hub-expire-chip hub-expire-chip--extend">Extend?</span>
                          )}
                          {r.expire_chip === "fa" && (
                            <span className="hub-expire-chip">Expires — FA</span>
                          )}
                        </>
                      )}
                      expanded={(
                        <div className="mobile-stat-grid hub-roster-mobile-grid">
                          <MobileStat label="Type" value={r.contract_type || "—"} />
                          <MobileStat label="Yrs left" value={yrs} />
                          <MobileStat
                            label="Pts /$"
                            value={r.fp_per_dollar ?? "—"}
                            title="Projected fair-value fantasy points per dollar of salary"
                          />
                          <MobileStat
                            label="Contract"
                            value={gradeText || "—"}
                            className={gradeText ? gradeClass(r.contract_grade) : ""}
                            title={r.fair_value != null ? `Model fair auction value ${fmtSal(r.fair_value)}` : undefined}
                          />
                        </div>
                      )}
                      actions={actions}
                    />
                  );
                })}
              </MobileDataList>
            ) : (
              <div className="table-wrap">
                <table className="data-table hub-table hub-roster-table">
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Pos</th>
                      <th className="num">Cap</th>
                      <th className="num">Yrs</th>
                      <th>Type</th>
                      <th>Contract</th>
                      <th
                        className="num"
                        title="Projected fair-value fantasy points per dollar of salary"
                      >
                        Pts /$
                      </th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {roster.length === 0 && (
                      <tr>
                        <td colSpan={8} className="hub-roster-empty">No active players.</td>
                      </tr>
                    )}
                    {roster.map((r) => {
                      const gradeText = contractGradeText(r);
                      return (
                        <tr
                          key={r.player_id}
                          className={r.overpay ? "hub-overpay" : ""}
                        >
                          <td className="col-player">
                            <PlayerCell
                              name={r.player_name}
                              team={r.team}
                              playerId={r.player_id}
                              media={media}
                              size="sm"
                              showTeam={false}
                              narrativeScope="season"
                            />
                            {r.expire_chip === "extend" && (
                              <span className="hub-expire-chip hub-expire-chip--extend">Extend?</span>
                            )}
                            {r.expire_chip === "fa" && (
                              <span className="hub-expire-chip">Expires — FA</span>
                            )}
                          </td>
                          <td>{r.position}</td>
                          <td className="num">{fmtSal(r.salary)}</td>
                          <td className="num">{r.years_remaining ?? r.contract_years ?? "—"}</td>
                          <td>{r.contract_type || "—"}</td>
                          <td>
                            {gradeText ? (
                              <span
                                className={gradeClass(r.contract_grade)}
                                title={r.fair_value != null ? `Model fair auction value ${fmtSal(r.fair_value)}` : undefined}
                              >
                                {gradeText}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="num">{r.fp_per_dollar ?? "—"}</td>
                          <td>
                            {r.player_id && (
                              <>
                              <button
                                type="button"
                                className="btn-ghost btn-sm"
                                onClick={() => addToTrade(r)}
                              >
                                {tradeLabel}
                              </button>
                              <ContractHistoryLink
                                playerId={r.player_id}
                                playerName={r.player_name}
                                onOpen={onOpenContractHistory}
                              />
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </HubTableCard>
        </>
      )}
    </HubPage>
  );
}
