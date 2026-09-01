import React, { useId, useMemo, useState } from "react";
import useMobileLayout from "../useMobileLayout";
import {
  effectiveMemberships,
  isActiveMembership,
  isSoloContext,
  membershipLabel,
} from "./hubLeagues";
import TeamIdentityMark from "./TeamIdentityMark";
import { identityFor, useTeamIdentities } from "./TeamIdentityContext";
import { CREATE_LEAGUE_VALUE, SOLO_VALUE, interpretLeagueSwitcherValue } from "./leagueAccessCopy";

const LIST_SCROLL_THRESHOLD = 4;

function currentValue(hubContext) {
  if (hubContext?.mode === "league" && hubContext?.league_id) {
    return hubContext.league_id;
  }
  return SOLO_VALUE;
}

function LeagueRow({
  title,
  meta,
  active,
  disabled,
  onClick,
}) {
  return (
    <button
      type="button"
      className={`hub-league-pick-row${active ? " is-active" : ""}`}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
    >
      <span className="hub-league-pick-row-check" aria-hidden="true">
        {active ? "✓" : ""}
      </span>
      <span className="hub-league-pick-row-body">
        <span className="hub-league-pick-row-title">{title}</span>
        {meta && <span className="hub-league-pick-row-meta">{meta}</span>}
      </span>
    </button>
  );
}

function ActiveContextHero({ hubContext, soloActive, mobileLayout, identity }) {
  if (soloActive) {
    return (
      <div className="hub-league-active-hero hub-league-active-hero--solo">
        {!mobileLayout && <p className="hub-league-active-kicker">Active now</p>}
        <h3 className="hub-league-active-title">Solo prep</h3>
        <p className="hub-league-active-meta">
          {mobileLayout ? "Pick a league below" : "Solo rules and roster — switch to a league below for shared tools."}
        </p>
      </div>
    );
  }
  return (
    <div className="hub-league-active-hero">
      {!mobileLayout && <p className="hub-league-active-kicker">Active now</p>}
      <h3 className="hub-league-active-title">
        <TeamIdentityMark
          team={{ id: hubContext.team_id, name: hubContext.team_name }}
          identity={identity}
          size="sm"
        />
        {hubContext.league_name || "League"}
      </h3>
      <p className="hub-league-active-meta">
        {[
          hubContext.team_name,
          hubContext.league_room_code,
          hubContext.is_commissioner ? (mobileLayout ? "Commish" : "Commissioner") : "Member",
          hubContext.season,
        ].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}

export default function LeagueSwitcher({
  memberships = [],
  hubContext,
  onSwitch,
  onCreateLeague,
  variant = "panel",
  disabled = false,
  hideActiveHero = false,
}) {
  const selectId = useId();
  const searchId = useId();
  const { identities } = useTeamIdentities();
  const [busy, setBusy] = useState(false);
  const [switchError, setSwitchError] = useState("");
  const [filter, setFilter] = useState("");
  const leagues = useMemo(
    () => effectiveMemberships(memberships, hubContext),
    [memberships, hubContext],
  );
  const value = currentValue(hubContext);
  const soloActive = isSoloContext(hubContext);
  const showPanel = variant === "panel";
  const mobileLayout = useMobileLayout();

  const filteredLeagues = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return leagues;
    return leagues.filter((m) => {
      const hay = [
        m.league_name,
        m.room_code,
        m.team?.name,
        m.is_commissioner ? "commissioner" : "member",
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [leagues, filter]);

  if (!showPanel && leagues.length === 0 && !soloActive) return null;

  const switchTo = async (next) => {
    const choice = interpretLeagueSwitcherValue(next, value);
    if (choice.action === "create") {
      onCreateLeague?.();
      return;
    }
    if (choice.action === "noop" || busy || disabled) return;
    setBusy(true);
    setSwitchError("");
    try {
      if (choice.action === "solo") {
        await onSwitch?.({ solo: true });
      } else {
        await onSwitch?.({ leagueId: choice.leagueId });
      }
    } catch (e) {
      setSwitchError(e.message || "Could not switch league");
    } finally {
      setBusy(false);
    }
  };

  if (variant === "compact") {
    if (leagues.length === 0 && soloActive && !onCreateLeague) return null;
    return (
      <div className="hub-league-switcher hub-league-switcher--compact">
        <label htmlFor={selectId} className="hub-league-switcher-label">
          {mobileLayout ? "League" : "Switch league"}
        </label>
        <div className="hub-league-switcher-compact-row">
          {leagues.length > 0 || !soloActive ? (
            <select
              id={selectId}
              className="hub-league-switcher-select"
              value={value}
              onChange={(e) => switchTo(e.target.value)}
              disabled={busy || disabled}
              aria-busy={busy}
            >
              {leagues.map((m) => (
                <option key={m.league_id} value={m.league_id}>
                  {m.league_name || membershipLabel(m)}
                </option>
              ))}
              <option value={SOLO_VALUE}>{mobileLayout ? "Solo prep" : "Personal prep (just me)"}</option>
              {onCreateLeague ? (
                <option value={CREATE_LEAGUE_VALUE}>+ Create or join a league…</option>
              ) : null}
            </select>
          ) : (
            <span id={selectId} className="hub-league-context-name">Solo prep</span>
          )}
          {onCreateLeague ? (
            <button
              type="button"
              className="btn-ghost btn-sm hub-league-switcher-create"
              disabled={busy || disabled}
              onClick={() => onCreateLeague()}
            >
              New league
            </button>
          ) : null}
        </div>
        {switchError && <div className="error hub-league-picker-error">{switchError}</div>}
      </div>
    );
  }

  const showSearch = leagues.length > LIST_SCROLL_THRESHOLD;
  const listScrollable = leagues.length > LIST_SCROLL_THRESHOLD;

  return (
    <div className="hub-league-picker" aria-busy={busy}>
      {!hideActiveHero && (
        <ActiveContextHero
          hubContext={hubContext}
          soloActive={soloActive}
          mobileLayout={mobileLayout}
          identity={identityFor(identities, { id: hubContext?.team_id, identity: hubContext?.team_identity })}
        />
      )}

      <div className="hub-league-pick-panel">
        <div className="hub-league-pick-panel-head">
          <h4 className="hub-league-pick-panel-title">{mobileLayout ? "Leagues" : "Switch league"}</h4>
          {leagues.length > 1 && (
            <span className="table-meta">{leagues.length} leagues</span>
          )}
        </div>

        {showSearch && (
          <label className="hub-league-pick-search" htmlFor={searchId}>
            <span className="sr-only">Search leagues</span>
            <input
              id={searchId}
              type="search"
              className="search-input"
              placeholder="Search leagues…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              disabled={busy || disabled}
            />
          </label>
        )}

        <div
          className={`hub-league-pick-list${listScrollable ? " hub-league-pick-list--scroll" : ""}`}
          role="list"
        >
          {filteredLeagues.length === 0 && filter.trim() && (
            <p className="chart-note hub-league-pick-empty">No leagues match &ldquo;{filter.trim()}&rdquo;</p>
          )}
          {filteredLeagues.map((m) => {
            const active = isActiveMembership(m, hubContext);
            return (
              <LeagueRow
                key={m.league_id}
                title={m.league_name || "League"}
                meta={[
                  m.team?.name,
                  m.room_code,
                  m.is_commissioner ? "Commissioner" : null,
                ].filter(Boolean).join(" · ")}
                active={active}
                disabled={busy || disabled}
                onClick={() => switchTo(m.league_id)}
              />
            );
          })}
          <LeagueRow
            title="Solo prep"
            meta="Solo workspace — no shared league"
            active={soloActive}
            disabled={busy || disabled}
            onClick={() => switchTo(SOLO_VALUE)}
          />
        </div>
        {onCreateLeague ? (
          <div className="hub-league-pick-create">
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={busy || disabled}
              onClick={() => onCreateLeague()}
            >
              Create or join a league
            </button>
          </div>
        ) : null}
      </div>

      {busy && <p className="chart-note hub-league-picker-busy">Switching league…</p>}
      {switchError && <div className="error hub-league-picker-error">{switchError}</div>}
    </div>
  );
}
