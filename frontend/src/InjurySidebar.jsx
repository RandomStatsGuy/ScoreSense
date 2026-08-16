import React, { useMemo, useState } from "react";
import Chip, { injuryChipTone } from "./Chip";
import InjuryStaleSafeguard from "./InjuryStaleSafeguard";
import ProjectionTrustLabel from "./ProjectionTrustLabel";
import { formatRelativeTime, formatReturnEstimate } from "./format";
import { formatInjuryPollCadence } from "./injuryRefresh";
import usePlayersContext from "./usePlayersContext";
import {
  buildAttentionItems,
  buildOpportunityItems,
  filterInjuriesByQuery,
  injuryCardClass,
  injuryStatusShort,
  practiceLabel,
  sortInjuriesBySeverity,
} from "./injuryExperience";
import { isStaleVsProjection } from "./playerContextDisplay";

const POSITION_LABELS = { qb: "QB", rb: "RB", wr: "WR/TE" };
const POSITION_PLURAL = { qb: "QBs", rb: "RBs", wr: "WR/TE" };

const RETURN_HEURISTIC_TITLE =
  "Heuristic from injury type and designation — not an official team report";

function compactReturnLabel(returnEst) {
  if (!returnEst?.text) return null;
  let label = String(returnEst.text).replace(/^Est\.\s*return:\s*/i, "").trim();
  label = label
    .replace(/\bweeks?\b/gi, "wk")
    .replace(/\bdays?\b/gi, "d")
    .replace(/\s*-\s*/g, "–");
  return returnEst.isEstimate ? `est. ${label}` : label;
}

function compactUpdated(updated) {
  if (!updated) return null;
  return String(updated).replace(/^Updated\s+/i, "");
}

function InjuryMetaLine({ injury }) {
  const bodyPart = String(injury.injury_body_part || "").trim() || null;
  const notes = String(injury.injury_notes || "").trim() || null;
  const updated = compactUpdated(formatRelativeTime(injury.news_updated));
  const returnEst = formatReturnEstimate(injury.return_estimate);
  const returnLabel = compactReturnLabel(returnEst);
  const leadBits = [injury.team, bodyPart].filter(Boolean);
  const tailBits = [returnLabel, updated].filter(Boolean);
  const metaTitle = [...leadBits, notes, ...tailBits].filter(Boolean).join(" · ");
  if (!leadBits.length && !notes && !tailBits.length) return null;

  return (
    <p className="injury-card-meta" title={metaTitle}>
      {leadBits.length ? (
        <span className="injury-card-meta-lead">{leadBits.join(" · ")}</span>
      ) : null}
      {notes ? (
        <span className="injury-card-meta-notes">
          {leadBits.length ? " · " : ""}
          {notes}
        </span>
      ) : null}
      {tailBits.length ? (
        <span
          className="injury-card-meta-tail"
          title={returnLabel ? RETURN_HEURISTIC_TITLE : undefined}
        >
          {leadBits.length || notes ? " · " : ""}
          {tailBits.join(" · ")}
        </span>
      ) : null}
    </p>
  );
}

function AttentionCard({ item, onCompareReplacements }) {
  const { injury, status, practice, changedAt, assumesActive, projectionRow, context } = item;
  const statusShort = injuryStatusShort(status);
  const changedLabel = compactUpdated(formatRelativeTime(changedAt));
  const practiceText = practice || practiceLabel(injury);
  const showStale = context ? isStaleVsProjection(context) : false;

  return (
    <li className={injuryCardClass(status)}>
      <div className="injury-card-top">
        <span className="injury-card-name" title={injury.full_name}>
          {injury.full_name}
        </span>
        {status ? (
          <Chip
            tone={injuryChipTone(status)}
            className="injury-status-chip"
            title={status}
            aria-label={`Injury status: ${status}`}
          >
            {statusShort}
          </Chip>
        ) : null}
      </div>
      <div className="injury-attention-facts">
        {practiceText ? (
          <span className="injury-attention-fact">
            Practice <strong>{practiceText}</strong>
          </span>
        ) : (
          <span className="injury-attention-fact muted">Practice unknown</span>
        )}
        {changedLabel ? (
          <span className="injury-attention-fact muted">{changedLabel}</span>
        ) : null}
      </div>
      {assumesActive ? (
        <div className="injury-attention-trust">
          <ProjectionTrustLabel kind="assumes_active" className="projection-trust-label--compact" />
        </div>
      ) : null}
      {showStale ? <InjuryStaleSafeguard context={context} /> : null}
      <InjuryMetaLine injury={injury} />
      {onCompareReplacements && projectionRow?.player_id ? (
        <div className="injury-card-actions">
          <button
            type="button"
            className="btn btn-ghost injury-compare-btn"
            onClick={() => onCompareReplacements(projectionRow)}
          >
            Compare replacements
          </button>
        </div>
      ) : null}
    </li>
  );
}

function OpportunityCard({ item }) {
  return (
    <li className="injury-card injury-card--opportunity">
      <div className="injury-card-top">
        <span className="injury-card-name" title={item.name}>
          {item.name}
        </span>
        {item.pointsLabel ? (
          <span className="injury-opp-delta" aria-label={`Opportunity ${item.pointsLabel}`}>
            {item.pointsLabel}
          </span>
        ) : null}
      </div>
      <p className="injury-card-meta">
        <span className="injury-card-meta-lead">
          {[item.team, item.position].filter(Boolean).join(" · ")}
        </span>
      </p>
      {item.driverLabel ? (
        <p className="injury-opp-driver">{item.driverLabel}</p>
      ) : null}
      {item.context && isStaleVsProjection(item.context) ? (
        <InjuryStaleSafeguard context={item.context} />
      ) : null}
    </li>
  );
}

function AllInjuryCard({ injury }) {
  const statusShort = injuryStatusShort(injury.injury_status);
  return (
    <li className={injuryCardClass(injury.injury_status)}>
      <div className="injury-card-top">
        <span className="injury-card-name" title={injury.full_name}>
          {injury.full_name}
        </span>
        {injury.injury_status ? (
          <Chip
            tone={injuryChipTone(injury.injury_status)}
            className="injury-status-chip"
            title={injury.injury_status}
            aria-label={`Injury status: ${injury.injury_status}`}
          >
            {statusShort}
          </Chip>
        ) : null}
      </div>
      <InjuryMetaLine injury={injury} />
    </li>
  );
}

/**
 * SCORE-25 Injuries panel: Needs attention · Opportunity changes · All (collapsed).
 * SCORE-33: manual refresh → POST /api/injuries/refresh (server-owned poll; no browser→Sleeper).
 * Consumes /api/injuries + weekly projections (+ cached player-context when warm).
 */
export default function InjurySidebar({
  players,
  projections = [],
  position,
  selectedTeams,
  searchQuery,
  isLiveContext,
  defaultSeason,
  defaultWeek,
  season,
  week,
  onCompareReplacements,
  onRefreshInjuries,
  injuryPoll = null,
  injuryRefreshBusy = false,
  injuryRefreshNote = "",
  contextRefreshToken = 0,
  className = "",
}) {
  const [allSearch, setAllSearch] = useState("");
  const context = usePlayersContext(season ?? defaultSeason, week ?? defaultWeek, {
    enabled: Boolean(isLiveContext && (season ?? defaultSeason) != null && (week ?? defaultWeek) != null),
    refreshToken: contextRefreshToken,
  });

  const sortedAll = useMemo(() => sortInjuriesBySeverity(players || []), [players]);

  const attention = useMemo(
    () =>
      buildAttentionItems({
        injuries: sortedAll,
        projections,
        contextById: context.byId,
      }),
    [sortedAll, projections, context.byId],
  );

  const opportunities = useMemo(
    () =>
      buildOpportunityItems({
        projections,
        injuries: players,
        contextById: context.byId,
      }),
    [projections, players, context.byId],
  );

  const allFiltered = useMemo(
    () => filterInjuriesByQuery(sortedAll, allSearch),
    [sortedAll, allSearch],
  );

  const headerLine = useMemo(() => {
    const posLabel = POSITION_PLURAL[position] || POSITION_LABELS[position] || position?.toUpperCase();
    const count = sortedAll.length;
    const noun = count === 1 ? posLabel.replace(/s$/, "") : posLabel;
    let line = `${count} injured ${noun}`;
    if (selectedTeams?.length) {
      line += ` · ${selectedTeams.join(", ")}`;
    }
    if (searchQuery?.trim()) {
      line += ` · table filter "${searchQuery.trim()}"`;
    }
    return line;
  }, [position, selectedTeams, searchQuery, sortedAll.length]);

  const pollLine = useMemo(() => formatInjuryPollCadence(injuryPoll), [injuryPoll]);

  if (!isLiveContext) {
    const weekLabel = defaultWeek != null ? `Week ${defaultWeek}` : "the live week";
    return (
      <section className={`panel injury-sidebar projections-mobile-panel ${className}`.trim()}>
        <div className="injury-sidebar-head">
          <h2>Injuries</h2>
        </div>
        <div className="state-empty-callout sidebar-empty-callout" role="status">
          No injury data is available for this week. View {weekLabel} data for current designations.
        </div>
      </section>
    );
  }

  return (
    <section className={`panel injury-sidebar projections-mobile-panel ${className}`.trim()}>
      <div className="injury-sidebar-head">
        <div className="injury-sidebar-head-row">
          <div>
            <h2>Injuries</h2>
            <p className="panel-subtitle">{headerLine}</p>
            {pollLine ? <p className="table-meta muted">{pollLine}</p> : null}
          </div>
          {typeof onRefreshInjuries === "function" ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm injury-refresh-btn"
              onClick={onRefreshInjuries}
              disabled={injuryRefreshBusy}
              title="Enqueue a server injury refresh and show the current snapshot"
            >
              {injuryRefreshBusy ? "Refreshing…" : "Refresh"}
            </button>
          ) : null}
        </div>
        {injuryRefreshNote ? (
          <p className="injury-refresh-note" role="status">
            {injuryRefreshNote}
          </p>
        ) : null}
      </div>

      <div className="injury-list-scroll">
        <section className="injury-section" aria-labelledby="injury-attention-heading">
          <div className="injury-section-head">
            <h3 id="injury-attention-heading" className="injury-section-title">
              Needs your attention
            </h3>
            <span className="injury-section-count muted">{attention.length}</span>
          </div>
          <p className="injury-section-sub muted">
            Injured players on this week’s projection slate
          </p>
          <ul className="injury-list">
            {attention.length === 0 ? (
              <li className="muted injury-empty-row">No slate injuries need attention</li>
            ) : (
              attention.map((item) => (
                <AttentionCard
                  key={item.key}
                  item={item}
                  onCompareReplacements={onCompareReplacements}
                />
              ))
            )}
          </ul>
        </section>

        <section className="injury-section" aria-labelledby="injury-opportunity-heading">
          <div className="injury-section-head">
            <h3 id="injury-opportunity-heading" className="injury-section-title">
              Opportunity changes
            </h3>
            <span className="injury-section-count muted">{opportunities.length}</span>
          </div>
          <p className="injury-section-sub muted">
            Healthy teammates whose projections moved with an injury
          </p>
          <ul className="injury-list">
            {opportunities.length === 0 ? (
              <li className="muted injury-empty-row">No fantasy opportunity bumps right now</li>
            ) : (
              opportunities.map((item) => <OpportunityCard key={item.key} item={item} />)
            )}
          </ul>
        </section>

        <details className="injury-section injury-section--all">
          <summary className="injury-all-summary">
            <span className="injury-section-title">All reported injuries</span>
            <span className="injury-section-count muted">{sortedAll.length}</span>
          </summary>
          <div className="injury-all-body">
            <label className="injury-all-search-label">
              <span className="sr-only">Search all injuries</span>
              <input
                type="search"
                className="search-input injury-all-search"
                placeholder="Search injuries…"
                value={allSearch}
                onChange={(e) => setAllSearch(e.target.value)}
                aria-label="Search all reported injuries"
              />
            </label>
            <ul className="injury-list">
              {allFiltered.length === 0 ? (
                <li className="muted injury-empty-row">No matching injuries</li>
              ) : (
                allFiltered.map((p) => (
                  <AllInjuryCard key={p.sleeper_id || playerKeySafe(p)} injury={p} />
                ))
              )}
            </ul>
          </div>
        </details>
      </div>
    </section>
  );
}

function playerKeySafe(p) {
  return `${p.full_name}|${p.team}|${p.position}`;
}
