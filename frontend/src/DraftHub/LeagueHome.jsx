import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, formatRelativeTime, parseApiError } from "../format";
import { isAbortError } from "../fetchAbort";
import useMobileLayout from "../useMobileLayout";
import HubTabIntro from "./HubTabIntro";
import {
  HubAlert,
  HubAlertStack,
  HubPage,
  HubPageMeta,
  HubSection,
  HubStatCard,
  HubStatGrid,
  HubToolbar,
} from "./HubUILayout";

/** Valid Hub subview targets returned by `/api/hub/home` actions / primary CTA. */
const HUB_ACTION_VIEWS = new Set([
  "setup",
  "planner",
  "roster",
  "week",
  "office",
  "value",
  "room",
  "rosters",
  "trades",
  "insights",
  "home",
]);

function severityVariant(severity) {
  if (severity === "high") return "danger";
  if (severity === "low") return "info";
  return "warn";
}

function fmtCap(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(Math.round(n))}`;
}

function ActionRow({ action, onNavigate }) {
  const href = HUB_ACTION_VIEWS.has(action?.href) ? action.href : null;
  return (
    <li className={`hub-home-action hub-home-action--${severityVariant(action?.severity)}`}>
      <div className="hub-home-action-main">
        <p className="hub-home-action-message">{action.message}</p>
        {action.count != null && (
          <span className="hub-home-action-meta">{action.count} item{action.count === 1 ? "" : "s"}</span>
        )}
        {action.amount != null && action.id === "cap_overage" && (
          <span className="hub-home-action-meta">{fmtCap(action.amount)} over</span>
        )}
      </div>
      {href && onNavigate ? (
        <button
          type="button"
          className="btn-ghost btn-sm hub-home-action-go"
          onClick={() => onNavigate(href)}
        >
          Go
        </button>
      ) : null}
    </li>
  );
}

/**
 * Phase-aware League Home + action center (SCORE-10).
 * Consumes GET /api/hub/home — no live Sleeper on load.
 */
export default function LeagueHome({
  hubContext,
  reloadToken = 0,
  onNavigate,
  onNavigateSetup,
}) {
  const mobileLayout = useMobileLayout();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    try {
      // include_week=true so in-season action center can surface lineup decisions.
      const res = await apiFetch("/api/hub/home?include_week=true", { signal });
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
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [
    load,
    hubContext?.league_id,
    hubContext?.team_id,
    hubContext?.mode,
    hubContext?.draft_completed,
    reloadToken,
  ]);

  const phase = data?.phase || {};
  const primaryCta = phase.primary_cta || null;
  const actions = data?.actions || [];
  const attention = data?.attention || {};
  const cap = data?.cap || {};
  const preDraft = data?.pre_draft;
  const weekSummary = data?.week_summary || {};
  const freshness = data?.freshness || {};
  const counts = data?.counts || {};
  const statusLine = data?.status_line
    || (hubContext?.league_name
      ? `${hubContext.league_name} · ${phase.label || "League"}`
      : `Solo prep · ${phase.label || "League"}`);

  const ctaView = primaryCta?.view && HUB_ACTION_VIEWS.has(primaryCta.view)
    ? primaryCta.view
    : (data?.checklist?.default_view && HUB_ACTION_VIEWS.has(data.checklist.default_view)
      ? data.checklist.default_view
      : null);
  const ctaLabel = primaryCta?.label || "Continue";

  const projBuilt = freshness.projections?.built_at;
  const projDays = freshness.projections?.days_old;

  const goSetup = onNavigateSetup || (onNavigate ? () => onNavigate("setup") : null);

  return (
    <HubPage className={`hub-league-home${mobileLayout ? " hub-league-home--mobile" : ""}`}>
      <HubTabIntro
        title="League Home"
        purpose="What needs attention now — then jump to the phase-right next step."
        compact={mobileLayout}
      />

      <HubToolbar className="hub-home-toolbar">
        <div className="hub-home-status" role="status">
          <span className="hub-home-status-line">{statusLine}</span>
          {phase.label ? (
            <span className={`hub-home-phase-badge hub-home-phase-badge--${phase.id || "unknown"}`}>
              {phase.label}
            </span>
          ) : null}
        </div>
        {ctaView && onNavigate ? (
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => onNavigate(ctaView)}
          >
            {ctaLabel}
          </button>
        ) : null}
        {goSetup ? (
          <button type="button" className="btn-ghost btn-sm" onClick={goSetup}>
            League settings
          </button>
        ) : null}
      </HubToolbar>

      <HubPageMeta>
        {loading && !data ? "Loading League Home…" : null}
        {!loading && projBuilt
          ? `Projections ${formatRelativeTime(projBuilt) || "available"}${
            projDays != null ? ` (${projDays} day${projDays === 1 ? "" : "s"} old)` : ""
          }`
          : null}
        {!loading && !projBuilt && freshness.projections?.available === false
          ? "Projections unavailable"
          : null}
        {weekSummary.available && weekSummary.week != null
          ? ` · Week ${weekSummary.week}`
          : null}
      </HubPageMeta>

      {error && <div className="error">{error}</div>}

      <HubAlertStack>
        {attention.line ? (
          <HubAlert variant={actions.some((a) => a.severity === "high") ? "danger" : "warn"}>
            {attention.line}
          </HubAlert>
        ) : (
          !loading && data && (
            <HubAlert variant="info">
              Nothing urgent — use the phase CTA when you&apos;re ready.
            </HubAlert>
          )
        )}
      </HubAlertStack>

      <HubSection
        title="Action center"
        hint="Highest-priority recovery and decisions first."
        className="hub-home-actions-section"
      >
        {loading && !data ? (
          <p className="chart-note">Checking league signals…</p>
        ) : actions.length === 0 ? (
          <p className="chart-note">No open actions. League Home will surface the next one when something needs you.</p>
        ) : (
          <ol className="hub-home-action-list">
            {actions.map((action) => (
              <ActionRow
                key={action.id}
                action={action}
                onNavigate={onNavigate}
              />
            ))}
          </ol>
        )}
      </HubSection>

      <HubStatGrid className="hub-home-stats">
        <HubStatCard
          label="Cap remaining"
          value={fmtCap(cap.remaining)}
          sub={
            cap.salary_cap != null
              ? `${fmtCap(cap.spent)} of ${fmtCap(cap.salary_cap)} spent`
              : undefined
          }
          tone={Number(cap.remaining) < 0 ? "danger" : "default"}
        />
        <HubStatCard
          label="Open actions"
          value={counts.actions ?? actions.length}
          tone={(counts.actions || actions.length) > 0 ? "accent" : "default"}
        />
        {phase.id === "pre_draft" && preDraft ? (
          <HubStatCard
            label="Expiring"
            value={preDraft.expiring_before_draft_count ?? counts.expiring_contracts ?? 0}
            sub={
              preDraft.must_extend_count
                ? `${preDraft.must_extend_count} must extend`
                : "Before draft"
            }
            tone={(preDraft.must_extend_count || 0) > 0 ? "danger" : "default"}
          />
        ) : null}
        {phase.id === "in_season" ? (
          <HubStatCard
            label="Lineup decisions"
            value={
              weekSummary.available
                ? (weekSummary.decision_count ?? counts.lineup_decisions ?? 0)
                : "—"
            }
            sub={weekSummary.headline || (weekSummary.available ? "This week" : "Unavailable")}
            tone={(weekSummary.decision_count || 0) > 0 ? "accent" : "default"}
          />
        ) : null}
        {phase.id === "live_draft" ? (
          <HubStatCard
            label="Draft"
            value="Live"
            sub="Open the room when you're ready"
            tone="accent"
          />
        ) : null}
        {data?.draft_schedule ? (
          <HubStatCard
            label="Draft night"
            value={
              data.draft_schedule.is_due
                ? "Due"
                : data.draft_schedule.seconds_until > 0
                  ? `${Math.max(1, Math.round(data.draft_schedule.seconds_until / 60))}m`
                  : "Set"
            }
            sub={new Date(data.draft_schedule.starts_at).toLocaleString(undefined, {
              timeZone: data.draft_schedule.timezone || undefined,
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              timeZoneName: "short",
            })}
            tone="accent"
          />
        ) : null}
        {phase.id === "offseason" ? (
          <HubStatCard
            label="Roster"
            value={counts.roster ?? "—"}
            sub="Roster & cap focus"
          />
        ) : null}
      </HubStatGrid>

      <p className="chart-note hub-home-settings-note">
        Setup and imports stay under{" "}
        {goSetup ? (
          <button type="button" className="btn-link" onClick={goSetup}>
            League settings
          </button>
        ) : (
          "League settings"
        )}
        {" — "}
        not the default landing screen.
      </p>
    </HubPage>
  );
}
