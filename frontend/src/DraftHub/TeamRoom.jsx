import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { apiFetch } from "../auth";
import {
  MY_TEAM_COPY as COPY,
  roomNumber,
  roomDelta,
  roomResult,
} from "./rosterPresentation";
import { JerseySvg } from "./LockerRoomScene";
import { nflTeamColors } from "./nflTeamColors";
import { paintMediaUrl, PAINT_WIDTH, teamLogoUrl } from "./draftMedia";
import { HubFilterMenu } from "./HubUILayout";
import { formatSyncedAgo } from "./gameCenterPresentation";
import "../styles/team-room.css";

export function TeamRoomView({
  data,
  onWeek,
  onTeam,
  onContract,
  onNickname,
  onShare,
  onAppearance,
  onLineup,
  matchupHref,
  busy = false,
  message = "",
}) {
  const [section, setSection] = useState("starters");
  const [selected, setSelected] = useState(null);
  const [nickname, setNickname] = useState("");
  const [sharing, setSharing] = useState(false);
  const id = useId().replaceAll(":", "");
  const trigger = useRef(null);
  useEffect(() => {
    setSelected(null);
    setSection("starters");
    setSharing(false);
  }, [data.team.id, data.week]);
  const hasStarters = data.starters.some((p) => p.player_id);
  const players =
    section === "starters" && hasStarters ? data.starters : data.bench;
  const active = players.find((p) => p.player_id === selected);
  useEffect(() => {
    setNickname(active?.nickname || "");
  }, [active?.player_id, active?.nickname]);
  const close = () => {
    setSelected(null);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!selected) return undefined;
    const escape = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [selected]);
  const winner =
    data.state === "final" && players.some((p) => p.points != null)
      ? Math.max(
          ...players
            .filter((p) => p.points != null)
            .map((p) => Number(p.points)),
        )
      : null;
  const shareUrl = data.share_token
    ? `${location.origin}/team-room/${data.share_token}`
    : "";
  const Scoreboard = matchupHref ? "a" : "div";
  return (
    <section
      className={`team-room team-room--${data.theme || "none"}`}
      aria-label={`${data.team.name} team room`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          close();
          setSharing(false);
        }
      }}
    >
      <div className="team-room-orbits" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <header className="team-room-heading">
        <div className="team-room-crest" aria-hidden="true">
          {data.photo_url ? (
            <img src={data.photo_url} alt="" />
          ) : (
            (data.team.name || "Team")
              .split(/\s+/)
              .map((s) => s[0])
              .slice(0, 2)
              .join("")
          )}
        </div>
        <div>
          <h1>{data.team.name}</h1>
          {data.team.owner_name && <p>{data.team.owner_name}</p>}
        </div>
        <div className="team-room-actions">
          {data.teams?.length > 1 && (
            <HubFilterMenu
              label="Visit team"
              value={data.team.id}
              options={data.teams.map((t) => ({
                id: t.id,
                label: [t.owner_name, t.name].filter(Boolean).join(" · "),
              }))}
              onChange={onTeam}
            />
          )}
          {data.can_edit && onAppearance && (
            <button onClick={onAppearance} className="btn-ghost">
              Edit look
            </button>
          )}
          {data.can_edit && (
            <button
              className="btn-ghost"
              aria-expanded={sharing}
              onClick={() => setSharing(!sharing)}
            >
              {COPY.shareRoom}
            </button>
          )}
        </div>
      </header>
      {sharing && (
        <div className="team-room-share">
          <p>{COPY.shareDescription}</p>
          {shareUrl ? (
            <>
              <label>
                Room link
                <input
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <button
                className="btn-ghost"
                disabled={busy}
                onClick={() => onShare(false)}
              >
                Turn off sharing
              </button>
            </>
          ) : (
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() => onShare(true)}
            >
              Create share link
            </button>
          )}
        </div>
      )}
      <Scoreboard className="team-room-scoreboard" href={matchupHref} aria-label={matchupHref ? COPY.openGameCenter : undefined}>
        <div>
          <span>{data.team.name}</span>
          <strong key={data.score}>{roomNumber(data.score)}</strong>
        </div>
        <div className="team-room-score-context">
          <span>
            {data.season} · Week {data.week}
          </span>
          <b className={`team-room-state team-room-state--${data.state}`}>
            {COPY.roomStates[data.state] || COPY.roomStates.unknown}
          </b>
          <p>
            {roomResult(data) ||
              (data.opponent
                ? "Scores appear after kickoff"
                : "Opponent not available")}
          </p>
        </div>
        <div>
          <span>{data.opponent?.name || "Opponent"}</span>
          <strong>{roomNumber(data.opponent?.score)}</strong>
        </div>
        {matchupHref && <span className="team-room-matchup-link">{COPY.openGameCenter} <span aria-hidden="true">→</span></span>}
      </Scoreboard>
      <div className="team-room-toolbar">
        <HubFilterMenu
          label="Week"
          value={String(data.week)}
          options={Array.from({ length: data.max_week || 18 }, (_, i) => ({
            id: String(i + 1),
            label: `Week ${i + 1}`,
          }))}
          onChange={(v) => onWeek(Number(v))}
        />
        <div role="group" aria-label="Room roster">
          <button
            aria-pressed={section === "starters"}
            onClick={() => {
              setSection("starters");
              setSelected(null);
            }}
          >
            Starters <span>{data.starters.length}</span>
          </button>
          <button
            aria-pressed={section === "bench"}
            onClick={() => {
              setSection("bench");
              setSelected(null);
            }}
          >
            Bench <span>{data.bench.length}</span>
          </button>
        </div>
        <span className="team-room-freshness">
          {formatSyncedAgo(data.synced_at)}
        </span>
      </div>
      {!hasStarters && section === "starters" && (
        <div className="team-room-empty">
          <p>{COPY.lineupEmpty}</p>
          {onLineup && (
            <button className="btn-link" onClick={onLineup}>
              Open This Week
            </button>
          )}
        </div>
      )}
      {!players.length ? (
        <p className="team-room-empty">{COPY.roomEmpty}</p>
      ) : (
        <div
          className="team-room-wall"
          style={{ "--room-columns": Math.min(12, players.length) }}
        >
          {players.map((p, i) => {
            const media = data.media?.[p.player_id] || {};
            const delta = roomDelta(p, data.state);
            const colors = nflTeamColors(p.team);
            const chosen = selected === p.player_id;
            const top = winner != null && p.points === winner && winner > 0;
            return (
              <div
                className={`team-room-locker${chosen ? " is-open" : ""}${top ? " is-top" : ""}`}
                key={`${p.player_id}-${i}`}
                style={{
                  "--locker-offset": `${Math.abs(i - (players.length - 1) / 2) * 5}px`,
                  "--jersey-color": colors.jersey[0],
                }}
              >
                <button
                  className="team-room-locker-trigger"
                  disabled={!p.player_id}
                  aria-expanded={chosen}
                  aria-controls={`${id}-detail`}
                  aria-label={`Open ${p.name}'s locker`}
                  onClick={(e) => {
                    trigger.current = e.currentTarget;
                    setSelected(chosen ? null : p.player_id);
                  }}
                >
                  <span className="team-room-player-score">
                    <strong key={p.points}>{roomNumber(p.points)}</strong>
                    <small
                      className={
                        delta == null ? "" : delta >= 0 ? "positive" : "caution"
                      }
                    >
                      {delta == null
                        ? p.projection == null
                          ? p.projection_status === "not_saved" ? COPY.projectionNotSavedShort : "Proj —"
                          : `Proj ${roomNumber(p.projection)}`
                        : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} vs proj`}
                    </small>
                    {top && (
                      <small className="team-room-award">Top scorer</small>
                    )}
                  </span>
                  <span className="team-room-cubicle">
                    <JerseySvg
                      detailed
                      colors={colors.jersey}
                      number={media.jersey_number}
                      gradientId={`${id}-jersey-${i}`}
                    />
                    <span className="team-room-player-name">
                      <b>{p.name}</b>
                      <small>
                        {p.nickname ||
                          `${p.slot || p.position || ""} · ${p.team || "FA"}`}
                      </small>
                    </span>
                    <img
                      className="team-room-team-mark"
                      src={
                        paintMediaUrl(media.team_logo_url, PAINT_WIDTH.mark) ||
                        teamLogoUrl(p.team, { width: 48 })
                      }
                      alt=""
                      onError={(e) => {
                        e.currentTarget.style.visibility = "hidden";
                      }}
                    />
                  </span>
                </button>
                {chosen && (
                  <div
                    className="team-room-drawer"
                    id={`${id}-detail`}
                    aria-label={`${p.name} locker details`}
                  >
                    <div className="team-room-drawer-head">
                      <div>
                        <h2>{p.name}</h2>
                        <p>
                          {p.position} · {p.team}
                        </p>
                      </div>
                      <button
                        className="btn-ghost"
                        onClick={close}
                        aria-label="Close locker"
                      >
                        ×
                      </button>
                    </div>
                    <div className="team-room-detail-score">
                      <strong>
                        {roomNumber(p.points)} <small>pts</small>
                      </strong>
                      <span>
                        {p.projection == null
                          ? p.projection_status === "not_saved" ? COPY.projectionNotSaved : COPY.projectionMissing
                          : `Projection ${roomNumber(p.projection)}`}
                      </span>
                    </div>
                    {delta != null && (
                      <p className={delta >= 0 ? "positive" : "caution"}>
                        {delta > 0 ? "+" : ""}
                        {delta.toFixed(1)} vs projection
                      </p>
                    )}
                    {data.can_edit && p.can_manage !== false && onNickname && (
                      <details className="team-room-nickname-edit">
                        <summary>Edit nickname</summary>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            onNickname(p.player_id, nickname);
                          }}
                        >
                          <label>
                            {COPY.nicknameLabel}
                            <input
                              maxLength={40}
                              value={nickname}
                              onChange={(e) => setNickname(e.target.value)}
                            />
                          </label>
                          <div className="team-room-drawer-actions">
                            <button className="btn-ghost" disabled={busy}>
                              Save nickname
                            </button>
                            <button
                              type="button"
                              className="btn-link"
                              disabled={busy}
                              onClick={() => onNickname(p.player_id, null)}
                            >
                              {COPY.resetNickname}
                            </button>
                          </div>
                        </form>
                      </details>
                    )}
                    {!data.can_edit && p.nickname && (
                      <p className="team-room-nickname">“{p.nickname}”</p>
                    )}
                    {data.can_edit && p.can_manage !== false && onContract && (
                      <button
                        className="btn-ghost team-room-contract"
                        onClick={(e) =>
                          onContract(p.player_id, e.currentTarget)
                        }
                      >
                        View contract
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="team-room-floor" aria-hidden="true">
        <span className="team-room-bench" />
        <span className="team-room-floor-mark">
          {(data.team.name || "")
            .split(/\s+/)
            .map((s) => s[0])
            .slice(0, 2)
            .join("")}
        </span>
      </div>
      <p className="team-room-status" role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}

export default function TeamRoom({
  leagueId,
  teamId,
  token,
  onContract,
  onAppearance,
  onLineup,
}) {
  const [viewTeam, setViewTeam] = useState(teamId);
  const [week, setWeek] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    setViewTeam(teamId);
    setWeek(null);
  }, [leagueId, teamId]);
  const base = token
    ? `/api/hub/shared-room/${encodeURIComponent(token)}`
    : `/api/hub/league/${encodeURIComponent(leagueId)}/teams/${encodeURIComponent(viewTeam)}/room`;
  useEffect(() => {
    const version = ++generation.current;
    const ctrl = new AbortController();
    let timer;
    let pending = false;
    setData(null);
    setError("");
    setMessage("");
    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const res = await apiFetch(`${base}${week ? `?week=${week}` : ""}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) throw Error(COPY.roomError);
        const next = await res.json();
        if (version === generation.current) {
          setData(next);
          setError("");
        }
      } catch (e) {
        if (!ctrl.signal.aborted && version === generation.current)
          setError(e.message || COPY.roomError);
      } finally {
        pending = false;
      }
    };
    load();
    timer = setInterval(load, 60000);
    document.addEventListener("visibilitychange", load);
    return () => {
      ctrl.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [base, week, retry]);
  const mutate = useCallback(
    async (path, body) => {
      const version = generation.current;
      setBusy(true);
      setMessage("");
      try {
        const res = await apiFetch(`${base}/${path}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw Error("Could not save. Try again.");
        const result = await res.json();
        if (version === generation.current) {
          if (path === "share")
            setData((prev) => ({ ...prev, share_token: result.share_token }));
          else {
            const pid = decodeURIComponent(path.split("/").pop());
            setData((prev) => ({
              ...prev,
              starters: prev.starters.map((p) =>
                p.player_id === pid
                  ? { ...p, nickname: body.nickname ?? p.sleeper_nickname }
                  : p,
              ),
              bench: prev.bench.map((p) =>
                p.player_id === pid
                  ? { ...p, nickname: body.nickname ?? p.sleeper_nickname }
                  : p,
              ),
            }));
          }
          setMessage(
            path === "share"
              ? result.share_token
                ? "Sharing is on."
                : "Room link disabled."
              : COPY.nicknameSaved,
          );
        }
      } catch (e) {
        if (version === generation.current) setMessage(e.message);
      } finally {
        setBusy(false);
      }
    },
    [base],
  );
  if (!data)
    return (
      <div className="team-room-loading" role="status">
        <p>{error || COPY.roomLoading}</p>
        {error && (
          <button className="btn-ghost" onClick={() => setRetry((n) => n + 1)}>
            Try again
          </button>
        )}
      </div>
    );
  return (
    <TeamRoomView
      data={data}
      matchupHref={!token && leagueId && data.opponent ? `/hub/game?matchupWeek=${data.week}&matchupTeam=${encodeURIComponent(data.team.id)}` : undefined}
      busy={busy}
      message={error ? `${error} Showing the last update.` : message}
      onWeek={setWeek}
      onTeam={(id) => {
        setViewTeam(id);
        setWeek(null);
      }}
      onContract={viewTeam === teamId ? onContract : null}
      onAppearance={viewTeam === teamId ? onAppearance : null}
      onLineup={viewTeam === teamId ? onLineup : null}
      onNickname={(pid, name) =>
        mutate(`nicknames/${encodeURIComponent(pid)}`, { nickname: name })
      }
      onShare={(enabled) => mutate("share", { enabled })}
    />
  );
}
