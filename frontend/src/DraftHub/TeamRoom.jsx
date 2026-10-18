import React, { useCallback, useEffect, useState, useRef } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import { MY_TEAM_COPY as COPY } from "./rosterPresentation";
import { roomAfterSwap } from "./teamRoomPresentation";
import TeamRoomView from "./TeamRoomView";
import { getRoomSnapshot, invalidateWeeklySnapshot, roomSnapshotKey, setRoomSnapshot } from "./hubDataCache";
import "../styles/team-room.css";
export { default as TeamRoomView } from "./TeamRoomView";

export default function TeamRoom({
  cacheScope,
  leagueId,
  teamId,
  token,
  sleeperLeagueId = "",
  onContract,
  onAppearance,
  onLineup,
  onLineupChanged,
}) {
  const [viewTeam, setViewTeam] = useState(teamId);
  const [week, setWeek] = useState(null);
  const [data, setData] = useState(() => getRoomSnapshot(roomSnapshotKey(cacheScope, leagueId, teamId, null)));
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const dataRef = useRef(data);
  dataRef.current = data;
  const reload = useRef(null);
  useEffect(() => {
    setViewTeam(teamId);
    setWeek(null);
  }, [leagueId, teamId]);
  const base = token
    ? `/api/hub/shared-room/${encodeURIComponent(token)}`
    : `/api/hub/league/${encodeURIComponent(leagueId)}/teams/${encodeURIComponent(viewTeam)}/room`;
  const cacheKey = token ? null : roomSnapshotKey(cacheScope, leagueId, viewTeam, week);
  useEffect(() => {
    const version = ++generation.current;
    const ctrl = new AbortController();
    let timer;
    let pending = false;
    const cached = getRoomSnapshot(cacheKey);
    setData(cached);
    setError("");
    setMessage(cached ? "Checking for room updates…" : "");
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
          setRoomSnapshot(cacheKey, leagueId, next);
          setData(next);
          setError("");
          setMessage("");
        }
      } catch (e) {
        if (!ctrl.signal.aborted && version === generation.current)
          setError(e.message || COPY.roomError);
      } finally {
        pending = false;
      }
    };
    load();
    reload.current = load;
    timer = setInterval(load, 60000);
    document.addEventListener("visibilitychange", load);
    return () => {
      ctrl.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
      if (reload.current === load) reload.current = null;
    };
  }, [base, cacheKey, leagueId, week, retry]);
  // Native leagues save a Room drop or Start through the same lineup swap as the Lineup tab.
  const swapLineup = useCallback(
    async (starterId, benchId) => {
      const current = dataRef.current;
      if (token || !leagueId || !current || !starterId || !benchId) return false;
      const version = generation.current;
      setBusy(true);
      setMessage("");
      try {
        const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/lineup/swap`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ starter_player_id: starterId, bench_player_id: benchId, week: current.week, team_id: current.team?.id }),
        });
        if (!res.ok) throw new Error(await parseApiError(res));
        await res.json();
        if (version !== generation.current) return false;
        const next = roomAfterSwap(dataRef.current, starterId, benchId);
        setRoomSnapshot(cacheKey, leagueId, next);
        setData(next);
        invalidateWeeklySnapshot(leagueId);
        onLineupChanged?.();
        void reload.current?.();
        return true;
      } catch (e) {
        if (version === generation.current) setMessage(connectionErrorMessage(e, COPY.roomSaveFailed));
        return false;
      } finally {
        if (version === generation.current) setBusy(false);
      }
    },
    [token, leagueId, cacheKey, onLineupChanged],
  );
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
      sleeperLeagueId={sleeperLeagueId}
      onContract={viewTeam === teamId ? onContract : null}
      onAppearance={viewTeam === teamId ? onAppearance : null}
      onLineup={viewTeam === teamId ? onLineup : null}
      onSwap={!token && viewTeam === teamId ? swapLineup : null}
      onNickname={(pid, name) =>
        mutate(`nicknames/${encodeURIComponent(pid)}`, { nickname: name })
      }
      onShare={(enabled) => mutate("share", { enabled })}
    />
  );
}
