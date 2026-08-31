import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import { isAbortError } from "../fetchAbort";
import TeamIdentityMark from "./TeamIdentityMark";
import { EMOTE_COPY, emoteTitle } from "./atmosphereCatalog";
import { identityFor, useTeamIdentities } from "./TeamIdentityContext";
import { hubTeamLabel } from "./hubTeamLabel";
import { trophyStripCopy } from "./weekBoard";

function EmoteFigure({ emoteKey }) {
  return (
    <span className={`hub-emote-figure hub-emote-figure--${emoteKey}`} aria-hidden="true">
      <span className="hub-emote-head" />
      <span className="hub-emote-body" />
    </span>
  );
}

export default function WeekCulturePanel({ hubContext, week, boardReady = true }) {
  const leagueId = hubContext?.league_id;
  const { identities } = useTeamIdentities();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async (signal) => {
    if (!leagueId || hubContext?.mode !== "league") {
      setData(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (week) params.set("week", String(week));
      const q = params.toString();
      const res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/week-culture${q ? `?${q}` : ""}`,
        { signal },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      if (!signal?.aborted) setData(payload);
    } catch (e) {
      if (isAbortError(e) || signal?.aborted) return;
      setError(connectionErrorMessage(e));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [leagueId, hubContext?.mode, week]);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  if (!leagueId || hubContext?.mode !== "league") return null;

  const vote = async (pollId, nomineeTeamId) => {
    setBusy(`vote:${pollId}`);
    setError("");
    try {
      const res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/week-culture/polls/${encodeURIComponent(pollId)}/vote`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nominee_team_id: nomineeTeamId }),
        },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      setData(await res.json());
    } catch (e) {
      setError(e.message || "Could not save vote");
    } finally {
      setBusy("");
    }
  };

  const sendEmote = async (emoteKey) => {
    if (!data?.opponent?.hub_team_id && !data?.opponent?.id) return;
    setBusy(`emote:${emoteKey}`);
    setError("");
    try {
      const res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/week-culture/emotes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to_team_id: data.opponent.hub_team_id || data.opponent.id,
            emote_key: emoteKey,
            week: data.week,
            season: data.season,
          }),
        },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      setData(await res.json());
    } catch (e) {
      setError(e.message || "Could not send reaction");
    } finally {
      setBusy("");
    }
  };

  const opponentName = data?.opponent?.team_name || "your opponent";
  const myEmote = (data?.emotes || []).find((row) => String(row.from_team_id) === String(hubContext?.team_id));
  const incoming = (data?.emotes || []).filter((row) => String(row.to_team_id) === String(hubContext?.team_id));
  const polls = data?.polls || [];
  const previewTeams = [];
  for (const poll of polls) {
    for (const option of poll.options || []) {
      if (!previewTeams.some((t) => String(t.id) === String(option.team_id))) {
        previewTeams.push({ id: option.team_id, name: option.team_name });
      }
    }
  }

  return (
    <section className="hub-week-culture hub-week-culture-strip" aria-label="This week's trophies">
      <header className="hub-week-culture-strip-head">
        <h3>This week's trophies</h3>
        <p className="chart-note">{trophyStripCopy({ boardReady, loading: loading && !data })}</p>
      </header>
      {error && <div className="error">{error}</div>}

      {incoming.length > 0 && (
        <div className="hub-emote-incoming" role="status">
          {incoming.map((row) => (
            <p key={row.id}>
              <EmoteFigure emoteKey={row.emote_key} />
              {hubTeamLabel({ name: "A manager" })} sent you {emoteTitle(row.emote_key)}.
            </p>
          ))}
        </div>
      )}

      {boardReady && data?.can_react && (
        <div className="hub-emote-dock">
          <p className="hub-emote-dock-copy">
            You beat {opponentName}. Send one reaction — they will see it here.
          </p>
          <div className="hub-emote-choices" role="group" aria-label="Victory reaction">
            {Object.entries(EMOTE_COPY).map(([key, meta]) => (
              <button
                key={key}
                type="button"
                className={`hub-emote-choice${myEmote?.emote_key === key ? " is-active" : ""}`}
                aria-pressed={myEmote?.emote_key === key}
                aria-label={meta.title}
                title={meta.hint}
                disabled={Boolean(busy)}
                onClick={() => sendEmote(key)}
              >
                <EmoteFigure emoteKey={key} />
                <span>{meta.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!boardReady && previewTeams.length > 0 ? (
        <ul className="hub-week-culture-marks">
          {previewTeams.slice(0, 6).map((team) => (
            <li key={team.id}>
              <TeamIdentityMark
                team={team}
                identity={identityFor(identities, team)}
                size="sm"
                showName
              />
            </li>
          ))}
        </ul>
      ) : null}

      {boardReady && polls.map((poll) => (
        <article key={poll.id} className="hub-week-poll hub-week-poll--strip">
          <header className="hub-week-poll-head">
            <h4>{poll.title}</h4>
          </header>
          <div className="hub-week-poll-options">
            {(poll.options || []).map((option) => {
              const team = { id: option.team_id, name: option.team_name };
              const selected = poll.viewer_vote === option.team_id;
              return (
                <button
                  key={option.team_id}
                  type="button"
                  className={`hub-week-poll-option${selected ? " is-active" : ""}`}
                  aria-pressed={selected}
                  disabled={Boolean(busy)}
                  onClick={() => vote(poll.id, option.team_id)}
                >
                  <TeamIdentityMark
                    team={team}
                    identity={identityFor(identities, team)}
                    size="sm"
                  />
                  <span className="hub-week-poll-option-main">
                    <strong>{option.team_name}</strong>
                    <span className="chart-note">
                      {option.votes} vote{option.votes === 1 ? "" : "s"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </article>
      ))}
    </section>
  );
}
