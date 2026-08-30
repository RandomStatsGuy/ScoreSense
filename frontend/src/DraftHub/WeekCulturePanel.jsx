import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import { isAbortError } from "../fetchAbort";
import { HubSection } from "./HubUILayout";
import TeamIdentityMark from "./TeamIdentityMark";
import { EMOTE_COPY, emoteTitle } from "./atmosphereCatalog";
import { identityFor, useTeamIdentities } from "./TeamIdentityContext";
import { hubTeamLabel } from "./hubTeamLabel";

function EmoteFigure({ emoteKey }) {
  return (
    <span className={`hub-emote-figure hub-emote-figure--${emoteKey}`} aria-hidden="true">
      <span className="hub-emote-head" />
      <span className="hub-emote-body" />
    </span>
  );
}

export default function WeekCulturePanel({ hubContext, week }) {
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

  return (
    <HubSection
      title="This week's trophies"
      hint="Optional league votes. One vote per trophy. Reactions unlock after you win the matchup."
      className="hub-week-culture"
    >
      {loading && !data && <p className="chart-note">Loading league trophies…</p>}
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

      {data?.can_react && (
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

      {!data?.can_react && data && (
        <p className="chart-note">
          {data.scoring_available
            ? "Reactions unlock after you win the matchup."
            : "Link Sleeper scoring to unlock victory reactions after a win."}
        </p>
      )}

      {(data?.polls || []).map((poll) => (
        <article key={poll.id} className="hub-week-poll">
          <header className="hub-week-poll-head">
            <h4>{poll.title}</h4>
            <p className="chart-note">{poll.support}</p>
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
    </HubSection>
  );
}
