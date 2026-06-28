import React, { useMemo, useState } from "react";
import { useAuth } from "../AuthContext";
import VerifyEmailBanner from "../VerifyEmailBanner";

const DISMISS_KEY = "hub_setup_checklist_dismissed";

function hasRules(workspace) {
  return Boolean(workspace?.rules && workspace?.preset_id);
}

function hasSleeper(workspace, hubContext) {
  return Boolean(
    hubContext?.sleeper_league_id
      || workspace?.sleeper_league_id
      || (workspace?.sleeper_player_ids || []).length > 0,
  );
}

export default function HubSetupChecklist({
  workspace,
  hubContext,
  memberships = [],
  onNavigate,
}) {
  const { user, refreshAuth } = useAuth();
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === "1",
  );

  const steps = useMemo(() => {
    const inLeague = hubContext?.mode === "league";
    const emailOk = user?.auth_type !== "native" || user?.email_verified !== false;
    return [
      {
        id: "account",
        label: "Verify email",
        done: emailOk,
        hidden: emailOk,
        action: null,
      },
      {
        id: "rules",
        label: "Configure rules",
        done: hasRules(workspace),
        action: () => document.querySelector(".hub-setup-panel .rules-wizard, .hub-setup-accordion")?.scrollIntoView?.({ behavior: "smooth" }),
      },
      {
        id: "sleeper",
        label: "Link Sleeper",
        done: hasSleeper(workspace, hubContext),
        action: () => document.querySelector(".hub-setup-panel--sleeper, .hub-setup-accordion")?.scrollIntoView?.({ behavior: "smooth" }),
      },
      {
        id: "league",
        label: inLeague ? "League active" : "Create or join a league (optional)",
        done: inLeague || memberships.length > 0,
        optional: !inLeague,
        action: () => document.querySelector(".hub-league-setup-add-toggle")?.click?.(),
      },
    ].filter((s) => !s.hidden);
  }, [workspace, hubContext, memberships.length, user]);

  const allDone = steps.every((s) => s.done);
  const show = !dismissed && !allDone && (memberships.length === 0 || !hasSleeper(workspace, hubContext));

  if (!show) return null;

  return (
    <section className="panel hub-setup-checklist">
      <div className="hub-setup-checklist-head">
        <h3>Get started</h3>
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => {
            localStorage.setItem(DISMISS_KEY, "1");
            setDismissed(true);
          }}
        >
          Dismiss
        </button>
      </div>
      {!user?.email_verified && user?.auth_type === "native" && (
        <VerifyEmailBanner user={user} onVerified={refreshAuth} />
      )}
      <ol className="hub-setup-checklist-steps">
        {steps.map((step) => (
          <li key={step.id} className={step.done ? "is-done" : ""}>
            <span className="hub-setup-checklist-mark" aria-hidden="true">
              {step.done ? "✓" : "○"}
            </span>
            <span>{step.label}</span>
            {!step.done && step.action && (
              <button type="button" className="btn-ghost btn-sm" onClick={step.action}>
                Go
              </button>
            )}
            {step.done && step.id === "league" && onNavigate && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => onNavigate("value")}>
                Players →
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
