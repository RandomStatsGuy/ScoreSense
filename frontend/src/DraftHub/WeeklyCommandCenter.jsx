import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, fmtNum, formatRelativeTime, parseApiError } from "../format";
import { isAbortError } from "../fetchAbort";
import useMobileLayout from "../useMobileLayout";
import MobileDataList, { MobileStat } from "../MobileDataList";
import MobilePlayerCard from "../MobilePlayerCard";
import {
  formatMovementSummary,
  formatP50Move,
  formatRankMove,
  rowMovementTone,
} from "../projectionMovement";
import HubTabIntro from "./HubTabIntro";
import {
  HubAlert,
  HubAlertStack,
  HubPage,
  HubPageMeta,
  HubSection,
  HubStatCard,
  HubStatGrid,
  HubTableCard,
  HubToolbar,
} from "./HubUILayout";
import {
  isPoorProjectionCoverage,
  projectionCoverageRatio,
} from "./projectionCoverage";

function fmtPts(value) {
  return fmtNum(value, 1);
}

function ProjectionChangeItem({ item }) {
  const rankLabel = formatRankMove({
    previousRank: item?.previous_rank,
    currentRank: item?.current_rank,
    rankDelta: item?.rank_delta,
    position: item?.position,
    slateStatus: item?.slate_status,
  });
  const p50Label = formatP50Move(item?.p50_delta ?? item?.delta_p50);
  const tone = rowMovementTone(item);
  const name = item?.player_name || item?.player_id || "Player";
  const leftSlate = String(item?.slate_status || "").toLowerCase() === "left";
  const metaBits = [
    item?.position,
    item?.team,
    item?.slot || item?.lineup_role,
    leftSlate ? "Left slate" : null,
  ].filter(Boolean);

  return (
    <li className={`hub-wcc-move-item hub-wcc-move-item--${tone}`}>
      <div className="hub-wcc-move-main">
        <strong>{name}</strong>
        {metaBits.length ? (
          <span className="chart-note"> {metaBits.join(" · ")}</span>
        ) : null}
        {rankLabel ? (
          <div className="hub-wcc-move-rank">{rankLabel}</div>
        ) : null}
      </div>
      {p50Label ? (
        <span className="hub-wcc-move-p50" title="Projected points vs prior refresh">
          {p50Label}
        </span>
      ) : (
        <span className="hub-wcc-move-p50 muted">—</span>
      )}
    </li>
  );
}

function playerMeta(player) {
  const bits = [player?.position, player?.team].filter(Boolean);
  if (player?.opponent) bits.push(`vs ${player.opponent}`);
  return bits.join(" · ");
}

function PlayerFlags({ player }) {
  const flags = [];
  if (player?.on_bye) flags.push({ key: "bye", label: "BYE", tone: "warn" });
  if (player?.injured) {
    flags.push({
      key: "inj",
      label: player.injury_status || "OUT",
      tone: "danger",
    });
  }
  if (player?.projection_missing || player?.has_projection === false) {
    flags.push({ key: "miss", label: "No proj", tone: "muted" });
  }
  if (!flags.length) return null;
  return (
    <span className="hub-wcc-flags">
      {flags.map((f) => (
        <span key={f.key} className={`hub-wcc-flag hub-wcc-flag--${f.tone}`}>
          {f.label}
        </span>
      ))}
    </span>
  );
}

function DecisionCard({ decision }) {
  const delta = decision?.delta_p50;
  return (
    <article className="hub-wcc-decision">
      <div className="hub-wcc-decision-main">
        <p className="hub-wcc-decision-message">{decision.message}</p>
        <p className="hub-wcc-decision-meta">
          {decision.bench_player_name}
          {" "}
          ({decision.bench_position || "BN"} · {fmtPts(decision.bench_p50)})
          {" → "}
          {decision.starter_slot || decision.starter_position || "starter"}
          {" · "}
          {decision.starter_player_name}
          {decision.starter_p50 != null ? ` (${fmtPts(decision.starter_p50)})` : ""}
        </p>
      </div>
      {delta != null && (
        <span className="hub-wcc-decision-delta" title="Projected point advantage">
          +{fmtPts(delta)}
        </span>
      )}
    </article>
  );
}

function RosterTable({ rows, emptyLabel }) {
  if (!rows?.length) {
    return <p className="chart-note">{emptyLabel}</p>;
  }
  return (
    <HubTableCard>
      <div className="table-wrap">
        <table className="data-table hub-table hub-roster-table hub-wcc-table">
          <thead>
            <tr>
              <th>Slot</th>
              <th className="col-player">Player</th>
              <th className="num hub-col-proj">Floor</th>
              <th className="num hub-col-proj">Proj</th>
              <th className="num hub-col-proj">Ceil</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.player_id}>
                <td>{row.slot || "—"}</td>
                <td className="col-player">
                  <div className="hub-wcc-player-cell">
                    <strong>{row.player_name || row.player_id}</strong>
                    <span className="chart-note">{playerMeta(row)}</span>
                  </div>
                </td>
                <td className="num">{fmtPts(row.p10)}</td>
                <td className="num">{fmtPts(row.p50)}</td>
                <td className="num">{fmtPts(row.p90)}</td>
                <td><PlayerFlags player={row} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </HubTableCard>
  );
}

function RosterMobileList({ rows, emptyLabel }) {
  if (!rows?.length) {
    return <p className="chart-note">{emptyLabel}</p>;
  }
  return (
    <MobileDataList>
      {rows.map((row) => (
        <MobilePlayerCard
          key={row.player_id}
          name={row.player_name || row.player_id}
          meta={`${row.slot || "BN"} · ${playerMeta(row)}`}
          heroValue={row.has_projection ? fmtPts(row.p50) : "—"}
          heroLabel="Proj"
          badge={<PlayerFlags player={row} />}
          expanded={(
            <div className="hub-wcc-mobile-stats">
              <MobileStat label="Floor" value={fmtPts(row.p10)} />
              <MobileStat label="Ceil" value={fmtPts(row.p90)} />
            </div>
          )}
        />
      ))}
    </MobileDataList>
  );
}

export default function WeeklyCommandCenter({
  hubContext,
  onSynced,
  onNavigateSetup,
  reloadToken,
}) {
  const mobileLayout = useMobileLayout();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [syncError, setSyncError] = useState("");
  const [weekOverride, setWeekOverride] = useState("");
  const [showRosterDetail, setShowRosterDetail] = useState(!mobileLayout);

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (weekOverride !== "") params.set("week", String(weekOverride));
      const q = params.toString();
      const res = await apiFetch(`/api/hub/week${q ? `?${q}` : ""}`, { signal });
      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      if (!signal?.aborted) setData(payload);
    } catch (e) {
      if (isAbortError(e) || signal?.aborted) return;
      setError(connectionErrorMessage(e));
      setData(null);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [weekOverride]);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load, hubContext?.league_id, hubContext?.team_id, hubContext?.mode, reloadToken]);

  useEffect(() => {
    setShowRosterDetail(!mobileLayout);
  }, [mobileLayout]);

  const runSync = useCallback(async () => {
    const endpoint = data?.sync?.sync_endpoint;
    if (!endpoint) return;
    setSyncing(true);
    setSyncError("");
    setSyncMessage("");
    try {
      const isSolo = endpoint === "/api/hub/sleeper/sync";
      const res = await apiFetch(endpoint, {
        method: data?.sync?.sync_action || "POST",
        ...(isSolo
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ import_to_hub: true }),
            }
          : {}),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const result = await res.json();
      setSyncMessage(
        result.message
        || (result.teams_synced != null
          ? `Synced ${result.teams_synced} team(s) from Sleeper.`
          : "League synced from Sleeper."),
      );
      await onSynced?.(result);
      await load();
    } catch (e) {
      setSyncError(connectionErrorMessage(e));
    } finally {
      setSyncing(false);
    }
  }, [data?.sync?.sync_action, data?.sync?.sync_endpoint, load, onSynced]);

  const meta = data?.meta || {};
  const status = data?.status || {};
  const sync = data?.sync || {};
  const counts = data?.counts || {};
  const summary = data?.summary || {};
  const decisions = data?.decisions || [];
  const wideRanges = data?.wide_ranges || [];
  const starters = data?.roster?.starters || [];
  const bench = data?.roster?.bench || [];
  const projectionChanges = data?.projection_changes || { available: false, items: [] };
  const materialMoves = (projectionChanges.items || []).filter(
    (item) => item.material === true || item.movement_material === true,
  );
  const projectionChangeItems = materialMoves.length
    ? materialMoves
    : (projectionChanges.items || []).slice(0, 8);

  const syncedLabel = sync.sleeper_synced_at
    ? formatRelativeTime(sync.sleeper_synced_at)
    : (sync.linked ? "Synced — time unknown" : "Not linked");

  const weekLabel = meta.week != null ? `Week ${meta.week}` : "This Week";
  const teamLabel = data?.hub_context?.team_name || hubContext?.team_name;
  const leagueLabel = data?.hub_context?.league_name || hubContext?.league_name;
  const isSolo = hubContext?.mode !== "league";
  const showSoloSync = isSolo && Boolean(sync.sync_endpoint);
  const canSyncRoster = Boolean(sync.sync_endpoint) && Boolean(sync.linked);
  const poorCoverage = Boolean(data) && isPoorProjectionCoverage({ counts, status });
  const rosterCount = Number(counts.roster) || 0;
  const missingCount = Number(counts.missing_projections) || 0;
  const coveredCount = Math.max(0, rosterCount - missingCount);
  const coveragePct = Math.round(projectionCoverageRatio(counts) * 100);

  return (
    <HubPage className="hub-wcc">
      <HubTabIntro
        title="This Week"
        purpose="Lineup help for this week based on your latest synced roster and current projections."
        audience={teamLabel || leagueLabel || "You"}
        learnMore={(
          <>
            <p>
              Recommendations use your latest synced roster. We estimate starters from
              league roster rules and contract salary when weekly lineup slots are not stored.
            </p>
            <p>
              We flag moves only when a bench player meaningfully outprojects the starter.
              Projection changes highlight notable moves on your roster since the last refresh.
            </p>
          </>
        )}
      />

      <HubToolbar className="hub-wcc-toolbar">
        <label>
          Week
          <input
            type="number"
            min={1}
            max={22}
            value={weekOverride}
            placeholder={meta.week != null ? String(meta.week) : "auto"}
            onChange={(e) => setWeekOverride(e.target.value)}
            aria-label="NFL week override"
          />
        </label>
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => load()}
          disabled={loading || syncing}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
        {showSoloSync && (
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={runSync}
            disabled={syncing || loading || !sync.linked}
            title={sync.note || "Pull the latest roster from Sleeper"}
          >
            {syncing ? "Syncing…" : "Sync League"}
          </button>
        )}
      </HubToolbar>

      <HubPageMeta>
        {weekLabel}
        {meta.season != null ? ` · ${meta.season}` : ""}
        {" · Roster "}
        {syncedLabel || "—"}
        {meta.projections_built_at
          ? ` · Projections ${formatRelativeTime(meta.projections_built_at) || "available"}`
          : ""}
        {meta.starter_inference === "league_rules_salary"
          ? " · Starters estimated from roster"
          : ""}
      </HubPageMeta>

      {error && <div className="error">{error}</div>}
      {syncError && <div className="error">{syncError}</div>}
      {syncMessage && <p className="chart-note hub-wcc-sync-msg">{syncMessage}</p>}

      <HubAlertStack>
        {status.unlinked_league && (
          <HubAlert
            variant="warn"
            action={onNavigateSetup ? (
              <button type="button" className="btn-link" onClick={onNavigateSetup}>
                League settings
              </button>
            ) : null}
          >
            {showSoloSync
              ? "League is not linked to Sleeper. Link in Setup, then use Sync League."
              : "League is not linked to Sleeper. Link in Setup, then use Sync league above."}
          </HubAlert>
        )}
        {status.empty_roster && (
          <HubAlert variant="info">
            {showSoloSync
              ? "No roster players yet. Sync League after linking Sleeper, or add contracts in My team."
              : "No roster players yet. Sync league above after linking Sleeper, or add contracts in My team."}
          </HubAlert>
        )}
        {status.projections_missing && !poorCoverage && (
          <HubAlert variant="warn">
            Weekly projections are not available for this week yet. Your roster still loads from Hub.
          </HubAlert>
        )}
        {Boolean(counts.on_bye) && (
          <HubAlert variant="info">
            {counts.on_bye} player{counts.on_bye === 1 ? "" : "s"} on bye.
          </HubAlert>
        )}
        {Boolean(counts.injured) && (
          <HubAlert variant="danger">
            {counts.injured} injured / unavailable player{counts.injured === 1 ? "" : "s"} on roster.
          </HubAlert>
        )}
        {Boolean(counts.missing_projections) && !status.projections_missing && !poorCoverage && (
          <HubAlert variant="info">
            {counts.missing_projections} roster player{counts.missing_projections === 1 ? "" : "s"} without a weekly projection
            {meta.missing_positions?.length
              ? ` (positions still building: ${meta.missing_positions.join(", ").toUpperCase()})`
              : ""}
            .
          </HubAlert>
        )}
      </HubAlertStack>

      <HubSection
        title="Decisions that need attention"
        hint="Highest-value lineup swaps first. We flag moves only when a bench player meaningfully outprojects the starter."
        className="hub-wcc-decisions"
      >
        {loading && !data ? (
          <p className="chart-note">Loading this week…</p>
        ) : poorCoverage ? (
          <div className="hub-wcc-coverage-block" role="status">
            <h4 className="hub-wcc-coverage-title">Projections need attention</h4>
            <p className="hub-wcc-coverage-body">
              {status.projections_missing
                ? "Weekly projections are not available for this week yet, so lineup recommendations would not be reliable."
                : (
                  <>
                    Only {coveredCount} of {rosterCount} roster players have weekly projections
                    ({coveragePct}% coverage)
                    {missingCount > 0 ? ` — ${missingCount} missing` : ""}
                    . Lineup advice would mostly be noise until coverage improves.
                  </>
                )}
            </p>
            <p className="hub-wcc-coverage-hint">
              Recommendations use your latest synced roster. Refresh projections after a sync,
              or sync your league roster if it looks out of date.
            </p>
            <div className="hub-wcc-coverage-actions">
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={() => load()}
                disabled={loading || syncing}
              >
                {loading ? "Refreshing…" : "Refresh projections"}
              </button>
              {canSyncRoster && (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={runSync}
                  disabled={syncing || loading}
                  title={sync.note || "Pull the latest roster from Sleeper"}
                >
                  {syncing ? "Syncing…" : "Sync roster"}
                </button>
              )}
              {status.unlinked_league && onNavigateSetup && (
                <button type="button" className="btn-link" onClick={onNavigateSetup}>
                  League settings
                </button>
              )}
            </div>
          </div>
        ) : decisions.length === 0 ? (
          <p className="chart-note">{summary.headline || "No high-value lineup swaps this week."}</p>
        ) : (
          <div className="hub-wcc-decision-list">
            {decisions.map((d) => (
              <DecisionCard
                key={`${d.bench_player_id}-${d.starter_player_id}`}
                decision={d}
              />
            ))}
          </div>
        )}
        {!poorCoverage && summary.top_messages?.length > 0 && decisions.length === 0 && (
          <ul className="hub-wcc-top-messages">
            {summary.top_messages.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        )}
      </HubSection>

      <HubStatGrid>
        <HubStatCard
          label="Decisions"
          value={poorCoverage ? "—" : (counts.decisions ?? "—")}
          sub={
            poorCoverage
              ? "Waiting on projection coverage"
              : (summary.headline || "—")
          }
          tone={!poorCoverage && (counts.decisions || 0) > 0 ? "accent" : "default"}
        />
        <HubStatCard label="Starters" value={counts.starters ?? "—"} />
        <HubStatCard label="Bench" value={counts.bench ?? "—"} />
        <HubStatCard
          label="Wide ranges"
          value={counts.wide_ranges ?? "—"}
          tone={(counts.wide_ranges || 0) > 0 ? "danger" : "default"}
        />
      </HubStatGrid>

      <HubSection
        title="Wide projection ranges"
        hint="Players with an unusually wide floor-to-ceiling spread this week."
      >
        {wideRanges.length === 0 ? (
          <p className="chart-note">No unusually wide ranges this week.</p>
        ) : (
          <ul className="hub-wcc-range-list">
            {wideRanges.map((row) => (
              <li key={row.player_id} className="hub-wcc-range-item">
                <div>
                  <strong>{row.player_name}</strong>
                  <span className="chart-note">
                    {" "}
                    {row.slot || row.lineup_role || ""}
                    {row.position ? ` · ${row.position}` : ""}
                  </span>
                </div>
                <span className="hub-wcc-range-vals">
                  {fmtPts(row.p10)}–{fmtPts(row.p90)}
                  {row.spread != null ? ` · spread ${fmtPts(row.spread)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </HubSection>

      <HubSection
        title="Projection changes"
        hint="Notable moves on your roster since the last refresh."
      >
        {projectionChanges.available && projectionChangeItems.length ? (
          <ul className="hub-wcc-move-list">
            {projectionChangeItems.slice(0, 12).map((item) => (
              <ProjectionChangeItem
                key={item.player_id || formatMovementSummary(item)}
                item={item}
              />
            ))}
          </ul>
        ) : projectionChanges.available ? (
          <p className="chart-note">No notable projection moves on your roster this refresh.</p>
        ) : (
          <p className="chart-note">
            {projectionChanges.note || "Projection movement tracking is not available yet."}
          </p>
        )}
      </HubSection>

      {mobileLayout && (
        <div className="hub-wcc-roster-toggle">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setShowRosterDetail((v) => !v)}
            aria-expanded={showRosterDetail}
          >
            {showRosterDetail ? "Hide roster detail" : "Show starters & bench"}
          </button>
        </div>
      )}

      {showRosterDetail && (
        <>
          <HubSection
            title="Starters"
            hint="Estimated current lineup from league rules and salary."
          >
            {mobileLayout ? (
              <RosterMobileList rows={starters} emptyLabel="No starters estimated." />
            ) : (
              <RosterTable rows={starters} emptyLabel="No starters estimated." />
            )}
          </HubSection>

          <HubSection
            title="Bench"
            hint="Sorted by projected points for decision priority."
          >
            {mobileLayout ? (
              <RosterMobileList rows={bench} emptyLabel="No bench players." />
            ) : (
              <RosterTable rows={bench} emptyLabel="No bench players." />
            )}
          </HubSection>
        </>
      )}
    </HubPage>
  );
}
