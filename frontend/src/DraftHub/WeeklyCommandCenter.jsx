import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, fmtNum, formatRelativeTime, parseApiError } from "../format";
import { isAbortError } from "../fetchAbort";
import useMobileLayout from "../useMobileLayout";
import MobileDataList, { MobileStat } from "../MobileDataList";
import MobilePlayerCard from "../MobilePlayerCard";
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

function fmtPts(value) {
  return fmtNum(value, 1);
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
        <span className="hub-wcc-decision-delta" title="Projected P50 advantage">
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
  onNavigateSetup,
}) {
  const mobileLayout = useMobileLayout();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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
  }, [load, hubContext?.league_id, hubContext?.team_id, hubContext?.mode]);

  useEffect(() => {
    setShowRosterDetail(!mobileLayout);
  }, [mobileLayout]);

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

  const syncedLabel = sync.sleeper_synced_at
    ? formatRelativeTime(sync.sleeper_synced_at)
    : (sync.linked ? "Synced — time unknown" : "Not linked");

  const weekLabel = meta.week != null ? `Week ${meta.week}` : "Your Week";
  const teamLabel = data?.hub_context?.team_name || hubContext?.team_name;
  const leagueLabel = data?.hub_context?.league_name || hubContext?.league_name;

  return (
    <HubPage className="hub-wcc">
      <HubTabIntro
        title="Your Week"
        purpose="Lineup decisions for your Hub roster from current weekly projections — no silent Sleeper polling."
        audience={teamLabel || leagueLabel || "You"}
        learnMore={(
          <>
            <p>
              Starters are inferred from league starter counts using a salary-desc heuristic
              (Hub does not store weekly lineup slots). Swap suggestions use deterministic
              P50 thresholds against that inferred lineup.
            </p>
            <p>
              Projection movement vs prior refresh is not tracked yet.
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
          disabled={loading}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
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
          ? " · Starters inferred (salary)"
          : ""}
      </HubPageMeta>

      {error && <div className="error">{error}</div>}

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
            League is not linked to Sleeper. Link in Setup, then use Sync league above.
          </HubAlert>
        )}
        {status.empty_roster && (
          <HubAlert variant="info">
            No roster players yet. Sync league above after linking Sleeper, or add contracts in My team.
          </HubAlert>
        )}
        {status.projections_missing && (
          <HubAlert variant="warn">
            Weekly projection artifacts are missing for this week. Roster still loads from Hub state.
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
        {Boolean(counts.missing_projections) && !status.projections_missing && (
          <HubAlert variant="info">
            {counts.missing_projections} roster player{counts.missing_projections === 1 ? "" : "s"} without a weekly projection
            {meta.missing_positions?.length
              ? ` (no artifact for ${meta.missing_positions.join(", ").toUpperCase()})`
              : ""}
            .
          </HubAlert>
        )}
      </HubAlertStack>

      <HubSection
        title="Decisions that need attention"
        hint="Highest-value lineup swaps first. Bench P50 must clear the starter by the configured threshold."
        className="hub-wcc-decisions"
      >
        {loading && !data ? (
          <p className="chart-note">Loading your week…</p>
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
        {summary.top_messages?.length > 0 && decisions.length === 0 && (
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
          value={counts.decisions ?? "—"}
          sub={summary.headline || "—"}
          tone={(counts.decisions || 0) > 0 ? "accent" : "default"}
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
        hint="Unusually high volatility or floor–ceiling spread on your roster."
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
        hint="Material moves since the prior refresh."
      >
        {projectionChanges.available && projectionChanges.items?.length ? (
          <ul className="hub-wcc-top-messages">
            {projectionChanges.items.map((item) => (
              <li key={item.player_id || item.message}>
                {item.message
                  || `${item.player_name} ${item.delta_p50 >= 0 ? "+" : ""}${fmtPts(item.delta_p50)}`}
              </li>
            ))}
          </ul>
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
            hint="Inferred current lineup (league rules + salary)."
          >
            {mobileLayout ? (
              <RosterMobileList rows={starters} emptyLabel="No starters inferred." />
            ) : (
              <RosterTable rows={starters} emptyLabel="No starters inferred." />
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
