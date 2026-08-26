import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { useAuth } from "../AuthContext";
import { connectionErrorMessage, parseApiError } from "../format";
import AccountAuth from "../AccountAuth";
import VerifyEmailBanner from "../VerifyEmailBanner";
import Button from "../ui/Button";
import { HubAlert, HubFilterChip, HubPage } from "./HubUILayout";
import HubTabIntro from "./HubTabIntro";
import DraftRoom from "./DraftRoom";
import {
  MOCK_DRAFT_PRESETS,
  MOCK_TEAM_SIZES,
  botCountForTeams,
  buildMockDraftStartBody,
  mockDraftDisplayName,
  mockDraftFormatLabel,
  mockDraftLaunchSummary,
  mockRoomPhaseKey,
  mockRoomPhaseLabel,
  mockRoomResumeLabel,
  readStoredMockLeagueId,
  resolveMockDraftSeason,
  writeStoredMockLeagueId,
} from "./mockDraftConfig";

const EMPTY_ROWS = [];

export default function MockDraftTool({ projMeta = null }) {
  const {
    authenticated,
    ready: authReady,
    hubAuthRequired,
    refreshAuth,
    user,
    termsUrl,
    privacyUrl,
    patreonConfigured,
  } = useAuth();
  const [leagueId, setLeagueId] = useState(() => readStoredMockLeagueId());
  const [toolLabel, setToolLabel] = useState("");
  const [presetId, setPresetId] = useState("salary_cap_auction_v1");
  const [teamCount, setTeamCount] = useState(12);
  const [useLeagueRules, setUseLeagueRules] = useState(false);
  const [useLeagueManagers, setUseLeagueManagers] = useState(false);
  const [hubContext, setHubContext] = useState(null);
  const [recent, setRecent] = useState([]);
  const [busy, setBusy] = useState(false);
  const [busyKind, setBusyKind] = useState("");
  const [error, setError] = useState("");

  const needsAuth = hubAuthRequired !== false && !authenticated;
  const needsVerify = Boolean(
    authenticated
    && hubAuthRequired !== false
    && user?.auth_type === "native"
    && user?.email_verified === false,
  );
  const sourceLeagueId = hubContext?.mode === "league" ? hubContext.league_id : null;
  const hasLeague = Boolean(sourceLeagueId);
  const season = resolveMockDraftSeason(projMeta, hubContext);
  const botCount = botCountForTeams(teamCount);
  const formatLocked = Boolean((useLeagueRules || useLeagueManagers) && hasLeague);
  const launchSummary = useMemo(
    () => mockDraftLaunchSummary({
      presetId,
      teamCount,
      season,
      useLeagueRules,
      useLeagueManagers,
      hasLeague,
      leagueName: hubContext?.league_name,
    }),
    [presetId, teamCount, season, useLeagueRules, useLeagueManagers, hasLeague, hubContext?.league_name],
  );

  useEffect(() => {
    if (!formatLocked) return;
    const t = String(hubContext?.rules?.draft_type || "auction").toLowerCase();
    if (t === "snake") setPresetId("snake_draft_v1");
    else if (t === "linear") setPresetId("linear_draft_v1");
    else setPresetId("salary_cap_auction_v1");
  }, [formatLocked, hubContext?.rules?.draft_type]);

  const persistLeague = useCallback((id) => {
    setLeagueId(id || "");
    writeStoredMockLeagueId(id || "");
  }, []);

  const loadContext = useCallback(async (signal) => {
    const res = await apiFetch("/api/hub/context", { signal });
    if (!res.ok) throw new Error(await parseApiError(res));
    return res.json();
  }, []);

  const loadRecent = useCallback(async (signal) => {
    const res = await apiFetch("/api/hub/mock-drafts", { signal });
    if (!res.ok) throw new Error(await parseApiError(res));
    const data = await res.json();
    return data.rooms || [];
  }, []);

  useEffect(() => {
    if (needsAuth || needsVerify || !authReady) return undefined;
    const ctrl = new AbortController();
    (async () => {
      try {
        const [ctx, rooms] = await Promise.all([
          loadContext(ctrl.signal),
          loadRecent(ctrl.signal),
        ]);
        if (ctrl.signal.aborted) return;
        setHubContext(ctx);
        setRecent(rooms);
        setError("");
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setError(connectionErrorMessage(e, "Could not load mock draft"));
      }
    })();
    return () => ctrl.abort();
  }, [authReady, needsAuth, needsVerify, loadContext, loadRecent]);

  const startRoom = async ({ simulate = false } = {}) => {
    setBusy(true);
    setBusyKind(simulate ? "simulate" : "start");
    setError("");
    try {
      const name = mockDraftDisplayName({
        presetId,
        simulate,
        useLeagueManagers,
        leagueName: hubContext?.league_name,
      });
      const body = buildMockDraftStartBody({
        presetId,
        teamCount,
        season,
        sourceLeagueId,
        useLeagueRules,
        useLeagueManagers,
        name,
      });
      const res = await apiFetch("/api/hub/mock-draft/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      if (simulate) {
        const sim = await apiFetch(`/api/hub/league/${data.league_id}/test/simulate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!sim.ok) throw new Error(await parseApiError(sim));
      }
      setToolLabel(simulate ? "Simulated mock" : (useLeagueManagers ? "League mirror mock" : "Mock draft"));
      persistLeague(data.league_id);
    } catch (e) {
      setError(connectionErrorMessage(e, simulate ? "Simulation failed" : "Could not start mock draft"));
    } finally {
      setBusy(false);
      setBusyKind("");
    }
  };

  const resumeRoom = (id, label = "Mock draft") => {
    setError("");
    setToolLabel(label);
    persistLeague(id);
  };

  const exitRoom = useCallback(() => {
    persistLeague("");
    setToolLabel("");
    const ctrl = new AbortController();
    loadRecent(ctrl.signal)
      .then((rooms) => setRecent(rooms))
      .catch(() => {});
  }, [loadRecent, persistLeague]);

  const selectedPreset = useMemo(
    () => MOCK_DRAFT_PRESETS.find((p) => p.id === presetId) || MOCK_DRAFT_PRESETS[0],
    [presetId],
  );

  if (authReady && needsAuth) {
    return (
      <div className="draft-hub draft-hub-auth">
        <AccountAuth
          onAuthed={async () => { await refreshAuth(); }}
          title="Sign in"
          subtitle="Mock drafts need an account so bots can sit in a private room."
          compact
          termsUrl={termsUrl}
          privacyUrl={privacyUrl}
          patreonConfigured={patreonConfigured}
        />
      </div>
    );
  }

  if (authReady && needsVerify) {
    return (
      <div className="draft-hub draft-hub-auth">
        <VerifyEmailBanner user={user} onVerified={async () => { await refreshAuth(); }} />
      </div>
    );
  }

  if (leagueId) {
    return (
      <DraftRoom
        leagueId={leagueId}
        onLeagueIdChange={(id) => {
          if (!id) exitRoom();
          else persistLeague(id);
        }}
        onExitRoom={exitRoom}
        valueRows={EMPTY_ROWS}
        season={season}
        hubContext={hubContext}
        toolMode
        toolLabel={toolLabel}
      />
    );
  }

  return (
    <HubPage className="mock-draft-tool">
      <HubTabIntro
        title="Mock draft"
        purpose="You control one team. Bots fill the remaining seats. Nothing here touches your real league."
        audience="Draft live when you want the clock, or run an instant simulation to jump to the recap."
      />
      {error ? <HubAlert variant="danger">{error}</HubAlert> : null}

      <p className="mock-draft-role" role="note">
        Your seat is human. The other {botCount} {botCount === 1 ? "team is a bot" : "teams are bots"}.
      </p>

      <div className="mock-draft-setup">
        <section className="mock-draft-formats" aria-label="Draft format">
          {MOCK_DRAFT_PRESETS.map((preset) => {
            const active = selectedPreset.id === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                className={`mock-draft-format-card${active ? " is-active" : ""}`}
                disabled={busy || formatLocked}
                aria-pressed={active}
                onClick={() => setPresetId(preset.id)}
              >
                <strong>{preset.label}</strong>
                <span className="chart-note">{preset.hint}</span>
              </button>
            );
          })}
        </section>
        {formatLocked ? (
          <p className="chart-note">Format follows {hubContext?.league_name || "your league"}.</p>
        ) : null}

        <div className="mock-draft-controls">
          <fieldset className="mock-draft-teams" disabled={busy}>
            <legend>Field size</legend>
            <div className="mock-draft-team-chips" role="group" aria-label="League size">
              {MOCK_TEAM_SIZES.map((n) => (
                <HubFilterChip
                  key={n}
                  compact
                  active={teamCount === n}
                  disabled={busy}
                  onClick={() => setTeamCount(n)}
                >
                  {n} teams
                </HubFilterChip>
              ))}
            </div>
            <p className="chart-note">1 human + {botCount} bots</p>
          </fieldset>

          {hasLeague ? (
            <div className="mock-draft-league-opts">
              <label className="hub-toggle-row">
                <input
                  type="checkbox"
                  checked={useLeagueRules}
                  disabled={busy}
                  onChange={(e) => setUseLeagueRules(e.target.checked)}
                />
                <span>
                  Use {hubContext?.league_name || "my league"} rules
                  <span className="hub-toggle-hint">Scoring, roster spots, and draft type from the league.</span>
                </span>
              </label>
              <label className="hub-toggle-row">
                <input
                  type="checkbox"
                  checked={useLeagueManagers}
                  disabled={busy}
                  onChange={(e) => setUseLeagueManagers(e.target.checked)}
                />
                <span>
                  Fill seats with {hubContext?.league_name || "my league"}&apos;s managers
                  <span className="hub-toggle-hint">Bot names only. Does not copy keepers or rosters.</span>
                </span>
              </label>
            </div>
          ) : (
            <p className="chart-note">
              Join a league in League → Setup to mock with your scoring rules and manager names.
            </p>
          )}
        </div>

        <section className="mock-draft-summary" aria-label="Launch summary">
          <h3 className="mock-draft-summary-title">This mock</h3>
          <dl className="mock-draft-summary-grid">
            <div>
              <dt>Format</dt>
              <dd>{launchSummary.format}</dd>
            </div>
            <div>
              <dt>Teams</dt>
              <dd>{launchSummary.teams}</dd>
            </div>
            <div>
              <dt>Bots</dt>
              <dd>{launchSummary.bots}</dd>
            </div>
            <div>
              <dt>Projections</dt>
              <dd>{launchSummary.season ?? "App default"}</dd>
            </div>
            <div>
              <dt>Rules</dt>
              <dd>{launchSummary.ruleSource}</dd>
            </div>
            <div>
              <dt>Managers</dt>
              <dd>{launchSummary.managerSource}</dd>
            </div>
          </dl>
        </section>

        <div className="hub-draft-entry-split mock-draft-launch">
          <div className="hub-draft-entry-card hub-draft-entry-card--live is-emphasized">
            <div className="hub-draft-entry-card-head">
              <h3>Draft live vs bots</h3>
              <p>
                Interactive room. You{" "}
                {presetId === "snake_draft_v1" || presetId === "linear_draft_v1" ? "pick" : "nominate"}
                {" "}at your seat; bots handle the other teams on the clock.
              </p>
            </div>
            <div className="hub-draft-entry-card-actions">
              <Button
                disabled={busy}
                onClick={() => startRoom({ simulate: false })}
              >
                {busy && busyKind === "start" ? "Starting…" : "Start mock draft"}
              </Button>
            </div>
          </div>
          <div className="hub-draft-entry-card hub-draft-entry-card--practice">
            <div className="hub-draft-entry-card-head">
              <h3>Instant simulation</h3>
              <p>
                No live clock. Bots take every pick immediately, then the recap opens.
                {" "}A {launchSummary.teams}-team {String(launchSummary.format || "draft").toLowerCase()} can take a minute.
              </p>
            </div>
            <div className="hub-draft-entry-card-actions">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => startRoom({ simulate: true })}
                title="Run every pick instantly, then open the recap"
              >
                {busy && busyKind === "simulate" ? "Simulating…" : "Simulate full draft"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {recent.length > 0 && (
        <section className="mock-draft-recent" aria-label="Recent mock drafts">
          <h3>Recent mocks</h3>
          <ul>
            {recent.map((room) => {
              const phase = mockRoomPhaseKey(room);
              return (
                <li
                  key={room.league_id}
                  className={`mock-draft-recent-item mock-draft-recent-item--${phase}`}
                >
                  <div>
                    <strong className="mock-draft-recent-name">{room.name || "Mock draft"}</strong>
                    <div className="mock-draft-recent-meta">
                      <span className={`mock-draft-status mock-draft-status--${phase}`}>
                        {mockRoomPhaseLabel(room)}
                      </span>
                      <span>{mockDraftFormatLabel(room.draft_type)}</span>
                      {room.team_count ? <span>{room.team_count}-team</span> : null}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => resumeRoom(room.league_id, room.name || "Mock draft")}
                  >
                    {mockRoomResumeLabel(room)}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </HubPage>
  );
}
