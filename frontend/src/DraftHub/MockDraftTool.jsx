import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { useAuth } from "../AuthContext";
import { connectionErrorMessage, parseApiError } from "../format";
import AccountAuth from "../AccountAuth";
import VerifyEmailBanner from "../VerifyEmailBanner";
import Button from "../ui/Button";
import { HubAlert, HubFilterChip, HubPage } from "./HubUILayout";
import DraftSeat from "./DraftSeat";
import ThinkingScrim from "../ui/ThinkingScrim";
import useSlowThink from "../hooks/useSlowThink";
import {
  MOCK_DRAFT_PRESETS,
  MOCK_TEAM_SIZES,
  botCountForTeams,
  buildMockDraftStartBody,
  mockDraftDisplayName,
  mockDraftHeroCopy,
  mockDraftFormatLabel,
  mockDraftLaunchSummary,
  mockRoomPhaseKey,
  mockRoomPhaseLabel,
  mockRoomResumeLabel,
  readStoredMockLeagueId,
  resolveMockDraftSeason,
  writeStoredMockLeagueId,
} from "./mockDraftConfig";

const DraftRoom = lazy(() => import("./DraftRoom"));

const EMPTY_ROWS = [];
const FORMAT_PERSONALITY = {
  salary_cap_auction_v1: { icon: "$", note: "Nominate and bid. Overspend and you miss later names." },
  snake_draft_v1: { icon: "S", note: "Plan the turns. Let the board come to you." },
  linear_draft_v1: { icon: "L", note: "Same seat every round. Make position count." },
};

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
  const [launchMode, setLaunchMode] = useState("live");
  const [hubContext, setHubContext] = useState(null);
  const [recent, setRecent] = useState([]);
  const [busy, setBusy] = useState(false);
  const [busyKind, setBusyKind] = useState("");
  const [error, setError] = useState("");
  const showThink = useSlowThink(busy);

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
        lobby: launchMode === "together",
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
        if (!sim.ok) {
          const simError = await parseApiError(sim);
          setToolLabel("Simulated mock");
          persistLeague(data.league_id);
          throw new Error(simError);
        }
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

  const toggleKeep = async (room, saved) => {
    setBusy(true);
    setBusyKind("keep");
    setError("");
    try {
      const res = await apiFetch(`/api/hub/mock-draft/${room.league_id}/keep`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saved }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      setRecent(await loadRecent());
    } catch (e) {
      setError(connectionErrorMessage(e, "Could not update saved mocks"));
    } finally {
      setBusy(false);
      setBusyKind("");
    }
  };

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
      <Suspense fallback={<p className="chart-note">Loading draft room…</p>}>
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
      </Suspense>
    );
  }

  const mockHero = mockDraftHeroCopy();

  return (
    <HubPage className="mock-draft-tool">
      <ThinkingScrim
        show={showThink}
        scene="mock"
        title={busyKind === "simulate" ? "Running the whole draft" : undefined}
        steps={busyKind === "simulate"
          ? ["Seating the bots", "Playing out every pick", "Building the recap"]
          : undefined}
      />
      <header className="mock-draft-hero">
        <div>
          <p className="hub-experience-kicker">{mockHero.kicker}</p>
          <h2>{mockHero.heading}</h2>
          <p>{mockHero.support}</p>
        </div>
        <div className="mock-draft-hero-note" role="note">
          <strong>{mockHero.noteTitle}</strong>
          <span>{mockHero.noteBody}</span>
        </div>
      </header>
      {error ? <HubAlert variant="danger">{error}</HubAlert> : null}

      <div className="mock-draft-builder">
        <div className="mock-draft-config">
          <section className="mock-draft-step" aria-labelledby="mock-format-title">
            <header className="mock-draft-step-head">
              <span>1</span>
              <div>
                <h3 id="mock-format-title">{mockHero.formatTitle}</h3>
                <p>{mockHero.formatSupport}</p>
              </div>
            </header>
            <div className="mock-draft-formats" aria-label="Draft format">
              {MOCK_DRAFT_PRESETS.map((preset) => {
                const active = selectedPreset.id === preset.id;
                const personality = FORMAT_PERSONALITY[preset.id] || { icon: "•", note: preset.hint };
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`mock-draft-format-card${active ? " is-active" : ""}`}
                    disabled={busy || formatLocked}
                    aria-pressed={active}
                    onClick={() => setPresetId(preset.id)}
                  >
                    <span className="mock-draft-format-icon" aria-hidden="true">{personality.icon}</span>
                    <span>
                      <strong>{preset.label}</strong>
                      <small>{personality.note}</small>
                    </span>
                    <span className="mock-draft-format-check" aria-hidden="true">{active ? "✓" : ""}</span>
                  </button>
                );
              })}
            </div>
            {formatLocked ? (
              <p className="chart-note">Format follows {hubContext?.league_name || "your league"}.</p>
            ) : null}
          </section>

          <section className="mock-draft-step" aria-labelledby="mock-field-title">
            <header className="mock-draft-step-head">
              <span>2</span>
              <div>
                <h3 id="mock-field-title">Set the field</h3>
                <p>Set the size. Invite friends or leave the rest to bots.</p>
              </div>
            </header>
            <fieldset className="mock-draft-teams" disabled={busy}>
              <legend className="sr-only">Field size</legend>
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
            </fieldset>

            <details className="mock-draft-advanced">
              <summary>Match a real league <span>Optional</span></summary>
              <div className="mock-draft-advanced-body">
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
                        <span className="hub-toggle-hint">Scoring, roster spots, and draft type.</span>
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
                        Use familiar manager names
                        <span className="hub-toggle-hint">Names only—keepers and rosters stay out.</span>
                      </span>
                    </label>
                  </div>
                ) : (
                  <p className="chart-note">
                    Join a league in Setup to use its scoring and manager names.
                  </p>
                )}
              </div>
            </details>
          </section>
        </div>

        <aside className="mock-draft-launchpad" aria-label="Launch mock draft">
          <p className="hub-experience-kicker">Your room</p>
          <div className="mock-draft-field draft-seat-row" aria-label={`One human and ${botCount} bots`}>
            {Array.from({ length: teamCount }, (_, index) => (
              <DraftSeat
                key={index}
                variant="mark"
                slot={index + 1}
                mine={index === 0}
              />
            ))}
          </div>

          <div className="mock-draft-experience-toggle" role="group" aria-label="Draft experience">
            <button
              type="button"
              className={launchMode === "together" ? "is-active" : ""}
              aria-pressed={launchMode === "together"}
              onClick={() => setLaunchMode("together")}
            >
              Invite friends
              <small>Open a lobby</small>
            </button>
            <button
              type="button"
              className={launchMode === "live" ? "is-active" : ""}
              aria-pressed={launchMode === "live"}
              onClick={() => setLaunchMode("live")}
            >
              Solo vs bots
              <small>Start now</small>
            </button>
            <button
              type="button"
              className={launchMode === "simulate" ? "is-active" : ""}
              aria-pressed={launchMode === "simulate"}
              onClick={() => setLaunchMode("simulate")}
            >
              Instant sim
              <small>Jump to the recap</small>
            </button>
          </div>

          <div className="mock-draft-launch-copy">
            <h3>
              {launchMode === "together"
                ? "Open the lobby."
                : launchMode === "live"
                  ? "Take the clock."
                  : "See the outcome."}
            </h3>
            <p>
              {launchMode === "together"
                ? "Share a link. Friends join with a name and pick a snake seat. No signup."
                : launchMode === "live"
                  ? `You ${presetId === "salary_cap_auction_v1" ? "nominate and bid" : "make the picks"}; bots keep the room moving.`
                  : `Bots run all ${launchSummary.teams} teams, then open a complete recap.`}
            </p>
          </div>

          <p className="mock-draft-launch-summary">
            <strong>{launchSummary.format}</strong>
            <span>{launchSummary.teams} teams</span>
            <span>{launchSummary.season ?? "Default"} projections</span>
          </p>

          <Button
            className="mock-draft-launch-button"
            disabled={busy}
            onClick={() => startRoom({ simulate: launchMode === "simulate" })}
          >
            {busy
              ? (busyKind === "simulate" ? "Simulating…" : "Opening room…")
              : launchMode === "simulate"
                ? "Simulate this draft"
                : launchMode === "together"
                  ? "Open the lobby"
                  : "Enter the draft room"}
          </Button>
          <p className="mock-draft-launch-foot">
            {launchMode === "together"
              ? `You host · ${teamCount - 1} open seats · shareable link`
              : `1 human · ${botCount} bots · private practice`}
          </p>
        </aside>
      </div>

      {recent.length > 0 && (
        <details className="mock-draft-recent" aria-label="Saved and recent mock drafts">
          <summary>Practice rooms <span>{recent.length}</span></summary>
          <p className="chart-note mock-draft-recent-note">
            Throwaway mocks are cleaned up automatically. Save up to 6 favorites to keep them.
          </p>
          <ul>
            {recent.map((room) => {
              const phase = mockRoomPhaseKey(room);
              return (
                <li key={room.league_id} className={`mock-draft-recent-item mock-draft-recent-item--${phase}`}>
                  <div>
                    <strong className="mock-draft-recent-name">{room.name || "Mock draft"}</strong>
                    <div className="mock-draft-recent-meta">
                      <span className={`mock-draft-status mock-draft-status--${phase}`}>
                        {mockRoomPhaseLabel(room)}
                      </span>
                      <span>{mockDraftFormatLabel(room.draft_type)}</span>
                      {room.team_count ? <span>{room.team_count}-team</span> : null}
                      {room.saved ? <span className="mock-draft-saved-flag">Saved</span> : null}
                    </div>
                  </div>
                  <div className="mock-draft-recent-actions">
                    <button
                      type="button"
                      className={`mock-draft-keep${room.saved ? " is-saved" : ""}`}
                      disabled={busy}
                      aria-pressed={Boolean(room.saved)}
                      aria-label={room.saved ? "Unpin this mock" : "Save this mock"}
                      onClick={() => toggleKeep(room, !room.saved)}
                    >
                      {room.saved ? "★" : "☆"}
                    </button>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => resumeRoom(room.league_id, room.name || "Mock draft")}>
                      {mockRoomResumeLabel(room)}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </HubPage>
  );
}
