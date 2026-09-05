import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import { formatCount } from "../formatCount";
import useMobileLayout from "../useMobileLayout";
import MobileDataList from "../MobileDataList";
import MobilePlayerCard from "../MobilePlayerCard";
import PlayerCell, { usePlayerMedia } from "../PlayerCell";
import {
  HubExperienceHero,
  HubExperienceLayout,
  HubExperienceSummary,
  HubFilterMenu,
  HubLoadingSkeleton,
  HubPage,
  HubPageSticky,
  HubTableCard,
} from "./HubUILayout";
import { fmtSal } from "./rosterFormat";
import { seedTradeFromPlayer, seedTradePartner } from "./tradeSeed";
import ContractHistoryLink from "./ContractHistoryLink";
import { identityFor, useTeamIdentities } from "./TeamIdentityContext";
import TeamIdentityMark from "./TeamIdentityMark";
import {
  DEALS_VIEW,
  ROSTERS_COPY,
  activeRoster,
  contractGradeClass,
  contractGradeText,
  dealCounts,
  expireChipLabel,
  formatDealsRailFacts,
  formatManagerRailFacts,
  joinFacts,
  leagueDealRows,
  managerDealFacts,
  managerPickerOptions,
  nicknameLine,
  ownerLine,
  positionSpendNote,
  rosterCaption,
  rosterHeading,
  tradeActionLabel,
  tradeLockReason,
  yearsLeftLabel,
} from "./leagueRostersPresentation";

function ExpireStatus({ chip }) {
  const label = expireChipLabel(chip);
  if (!label) return null;
  return (
    <span
      className={`hub-expire-chip${chip === "extend" ? " hub-expire-chip--extend" : ""}`}
    >
      {label}
    </span>
  );
}

function YouMark() {
  return <em className="hub-roster-you">{ROSTERS_COPY.you}</em>;
}

function TradeActions({
  row,
  ownerTeamId,
  myTeamId,
  acquisitionWindow,
  onNavigateTrade,
  onOpenContractHistory,
}) {
  const lockedReason = tradeLockReason(row, acquisitionWindow);
  const locked = Boolean(lockedReason);
  const label = tradeActionLabel({ isOwnTeam: ownerTeamId === myTeamId });
  return (
    <span className="hub-roster-action-group">
      <button
        type="button"
        className="btn-ghost btn-sm"
        disabled={locked}
        title={locked ? lockedReason : undefined}
        onClick={() => {
          seedTradeFromPlayer({
            player_id: row.player_id,
            player_name: row.player_name,
            team_id: ownerTeamId,
            salary: row.salary,
            position: row.position,
          });
          onNavigateTrade?.();
        }}
      >
        {label}
      </button>
      {locked ? <span className="hub-roster-trade-lock">{ROSTERS_COPY.tradeLockedShort}</span> : null}
      <ContractHistoryLink
        playerId={row.player_id}
        playerName={row.player_name}
        onOpen={onOpenContractHistory}
      />
    </span>
  );
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
  const [teamId, setTeamId] = useState(DEALS_VIEW);
  const acquisitionWindow = hubContext?.acquisition_window || null;

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
        if (prev === DEALS_VIEW) return DEALS_VIEW;
        if (prev && (data.teams || []).some((b) => b.team?.id === prev)) return prev;
        return DEALS_VIEW;
      });
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [leagueId]);

  useEffect(() => {
    load();
  }, [load]);

  const teamBlocks = useMemo(() => {
    return [...(overview?.teams || [])].sort((a, b) => (
      ownerLine(a.team).localeCompare(ownerLine(b.team))
    ));
  }, [overview]);

  const dealRows = useMemo(() => leagueDealRows(teamBlocks), [teamBlocks]);
  const dealsView = teamId === DEALS_VIEW;
  const block = useMemo(
    () => (dealsView ? null : teamBlocks.find((b) => b.team?.id === teamId) || null),
    [dealsView, teamBlocks, teamId],
  );
  const stats = block?.stats || {};
  const roster = useMemo(
    () => (dealsView ? dealRows : activeRoster(block)),
    [dealsView, dealRows, block],
  );
  const playerIds = useMemo(() => roster.map((r) => r.player_id).filter(Boolean), [roster]);
  const media = usePlayerMedia(mobileLayout ? [] : playerIds);
  const counts = dealCounts(dealRows);

  const pickerOptions = useMemo(
    () => managerPickerOptions(teamBlocks, dealRows),
    [teamBlocks, dealRows],
  );

  const heading = dealsView ? ROSTERS_COPY.dealsHeading : rosterHeading(block);
  const caption = dealsView ? ROSTERS_COPY.dealsCaption : rosterCaption(block);

  const glanceItems = dealsView
    ? [
        { id: "overpays", label: ROSTERS_COPY.glanceOverpays, value: String(counts.overpays) },
        { id: "bargains", label: ROSTERS_COPY.glanceBargains, value: String(counts.bargains) },
        { id: "managers", label: ROSTERS_COPY.glanceManagers, value: String(teamBlocks.length) },
      ]
    : [
        { id: "committed", label: ROSTERS_COPY.glanceCommitted, value: fmtSal(stats.committed) },
        { id: "dead", label: ROSTERS_COPY.glanceDead, value: fmtSal(stats.dead_cap) },
        { id: "free", label: ROSTERS_COPY.glanceFree, value: fmtSal(stats.unspent) },
        {
          id: "expiring",
          label: ROSTERS_COPY.glanceExpiring,
          value: String(managerDealFacts(block).expiring),
        },
      ];

  const ownerRail = (
    <nav className="hub-roster-owner-rail" aria-labelledby="hub-roster-managers-heading">
      <h3 id="hub-roster-managers-heading" className="hub-roster-rail-heading">
        {ROSTERS_COPY.managersHeading}
      </h3>
      <ul className="hub-roster-owner-list">
        <li>
          <button
            type="button"
            className={`hub-roster-owner-btn${dealsView ? " is-selected" : ""}`}
            aria-pressed={dealsView}
            onClick={() => setTeamId(DEALS_VIEW)}
          >
            <strong>{ROSTERS_COPY.dealsNav}</strong>
            <span>{formatDealsRailFacts(dealRows)}</span>
          </button>
        </li>
        {teamBlocks.map((b) => {
          const selected = b.team.id === teamId;
          const facts = formatManagerRailFacts(managerDealFacts(b));
          const nick = nicknameLine(b.team);
          return (
            <li key={b.team.id}>
              <button
                type="button"
                className={`hub-roster-owner-btn${selected ? " is-selected" : ""}`}
                aria-pressed={selected}
                onClick={() => setTeamId(b.team.id)}
              >
                <strong>
                  {ownerLine(b.team)}
                  {b.team.id === myTeamId ? <YouMark /> : null}
                </strong>
                {nick ? <span>{nick}</span> : null}
                <span>{facts}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );

  const renderPlayer = (row) => {
    const owner = row.ownerTeam;
    return (
      <div className="hub-roster-player-stack">
        <div className="hub-roster-player-line">
          <PlayerCell
            name={row.player_name}
            team={row.team}
            playerId={row.player_id}
            media={media}
            size="sm"
            showTeam={false}
            narrativeScope="season"
          />
        </div>
        {dealsView && owner ? (
          <span className="hub-roster-owner-sub">{ownerLine(owner)}</span>
        ) : null}
        <ExpireStatus chip={row.expire_chip} />
      </div>
    );
  };

  const renderDesktopTable = () => (
    <div className="table-wrap">
      <table className="data-table hub-table hub-roster-table">
        <caption className="hub-roster-table-caption">{caption}</caption>
        <thead>
          <tr>
            <th className="hub-roster-col-player">{ROSTERS_COPY.player}</th>
            <th className="hub-roster-col-pos">{ROSTERS_COPY.pos}</th>
            <th className="num hub-roster-col-cap">{ROSTERS_COPY.cap}</th>
            <th className="num hub-roster-col-years">{ROSTERS_COPY.years}</th>
            <th className="hub-roster-col-type">{ROSTERS_COPY.type}</th>
            <th className="hub-roster-col-contract">{ROSTERS_COPY.contract}</th>
            <th className="hub-roster-actions">{ROSTERS_COPY.actions}</th>
          </tr>
        </thead>
        <tbody>
          {roster.length === 0 && (
            <tr>
              <td colSpan={7} className="hub-roster-empty">
                {dealsView ? ROSTERS_COPY.dealsEmpty : ROSTERS_COPY.emptyRoster}
              </td>
            </tr>
          )}
          {roster.map((r) => {
            const gradeText = contractGradeText(r);
            const ownerTeamId = r.ownerTeamId || teamId;
            return (
              <tr key={`${ownerTeamId}-${r.player_id}`} className={r.overpay ? "hub-overpay" : ""}>
                <td className="hub-roster-col-player">{renderPlayer(r)}</td>
                <td className="hub-roster-col-pos">{r.position}</td>
                <td className="num hub-roster-col-cap">{fmtSal(r.salary)}</td>
                <td className="num hub-roster-col-years">{r.years_remaining ?? r.contract_years ?? "—"}</td>
                <td className="hub-roster-col-type">{r.contract_type || "—"}</td>
                <td className="hub-roster-col-contract">
                  {gradeText ? (
                    <span
                      className={`hub-roster-grade-chip ${contractGradeClass(r.contract_grade)}`}
                      title={r.fair_value != null ? `Fair value ${fmtSal(r.fair_value)}` : undefined}
                    >
                      {gradeText}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="hub-roster-actions">
                  {r.player_id ? (
                    <TradeActions
                      row={r}
                      ownerTeamId={ownerTeamId}
                      myTeamId={myTeamId}
                      acquisitionWindow={acquisitionWindow}
                      onNavigateTrade={onNavigateTrade}
                      onOpenContractHistory={onOpenContractHistory}
                    />
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const renderMobileCards = () => (
    <MobileDataList
      emptyMessage={!roster.length ? (dealsView ? ROSTERS_COPY.dealsEmpty : ROSTERS_COPY.emptyRoster) : null}
    >
      {roster.map((r) => {
        const gradeText = contractGradeText(r);
        const ownerTeamId = r.ownerTeamId || teamId;
        const lockedReason = tradeLockReason(r, acquisitionWindow);
        const expire = expireChipLabel(r.expire_chip);
        return (
          <MobilePlayerCard
            key={`${ownerTeamId}-${r.player_id}`}
            className={r.overpay ? "hub-overpay" : ""}
            name={r.player_name}
            meta={joinFacts([
              expire,
              r.position,
              r.team,
              dealsView ? ownerLine(r.ownerTeam) : "",
            ])}
            heroValue={fmtSal(r.salary)}
            heroLabel="cap"
            heroSub={yearsLeftLabel(r) !== "—" ? yearsLeftLabel(r) : undefined}
            hideHeroSubWhenOpen
            expanded={(
              <div className="hub-roster-mobile-expand">
                {gradeText ? (
                  <p className={`hub-roster-mobile-judgment ${contractGradeClass(r.contract_grade)}`}>
                    {gradeText}
                  </p>
                ) : null}
                {lockedReason ? <p className="hub-roster-trade-lock">{lockedReason}</p> : null}
              </div>
            )}
            actions={r.player_id ? (
              <TradeActions
                row={r}
                ownerTeamId={ownerTeamId}
                myTeamId={myTeamId}
                acquisitionWindow={acquisitionWindow}
                onNavigateTrade={onNavigateTrade}
                onOpenContractHistory={onOpenContractHistory}
              />
            ) : null}
          />
        );
      })}
    </MobileDataList>
  );

  return (
    <HubPage className="hub-experience-page hub-roster-browser-page">
      <HubExperienceHero
        eyebrow={ROSTERS_COPY.eyebrow}
        heading={ROSTERS_COPY.heading}
        support={ROSTERS_COPY.support}
        chip={overview?.teams?.length ? formatCount(overview.teams.length, "manager") : undefined}
      />
      {error && <div className="error">{error}</div>}
      {loading && !overview && <HubLoadingSkeleton label={ROSTERS_COPY.loading} rows={4} />}

      {overview && (
        <HubExperienceLayout
          summaryLabel={ROSTERS_COPY.glanceEyebrow}
          summary={(
            <HubExperienceSummary
              eyebrow={ROSTERS_COPY.glanceEyebrow}
              title={dealsView ? ROSTERS_COPY.glanceDealsTitle : heading}
              subtitle={dealsView ? ROSTERS_COPY.dealsHint : nicknameLine(block?.team) || undefined}
              items={glanceItems}
              note={!dealsView ? positionSpendNote(stats) || undefined : undefined}
              action={(
                <div className="hub-roster-glance-actions">
                  {block?.team && block.team.id !== myTeamId && onNavigateTrade ? (
                    <button
                      type="button"
                      className="btn-primary hub-experience-summary-action"
                      onClick={() => {
                        seedTradePartner(block.team.id);
                        onNavigateTrade();
                      }}
                    >
                      {ROSTERS_COPY.proposeTrade}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn-ghost hub-experience-summary-action hub-roster-browser-refresh"
                    onClick={() => load({ refresh: true })}
                  >
                    {ROSTERS_COPY.refreshLeague}
                  </button>
                </div>
              )}
            />
          )}
        >
          <div className="hub-roster-owner-layout">
            {mobileLayout ? (
              <HubPageSticky>
                <HubFilterMenu
                  className="hub-roster-manager-picker"
                  label={ROSTERS_COPY.managersHeading}
                  value={teamId}
                  options={pickerOptions}
                  onChange={setTeamId}
                />
              </HubPageSticky>
            ) : ownerRail}
            <div className="hub-roster-owner-main">
              <header className="hub-roster-browser-toolbar">
                {block?.team ? (
                  <h3 className="hub-roster-selected-heading">
                    <TeamIdentityMark
                      team={block.team}
                      identity={identityFor(identities, block.team)}
                      size="md"
                      showName
                    />
                    {block.team.id === myTeamId ? <YouMark /> : null}
                  </h3>
                ) : (
                  <h3 className="hub-roster-selected-heading">{heading}</h3>
                )}
                {block?.team && block.team.id !== myTeamId && onNavigateTrade ? (
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    onClick={() => {
                      seedTradePartner(block.team.id);
                      onNavigateTrade();
                    }}
                  >
                    {ROSTERS_COPY.proposeTrade}
                  </button>
                ) : null}
              </header>
              <HubTableCard className="hub-roster-browser-table-wrap">
                {mobileLayout ? renderMobileCards() : renderDesktopTable()}
              </HubTableCard>
            </div>
          </div>
        </HubExperienceLayout>
      )}
    </HubPage>
  );
}
