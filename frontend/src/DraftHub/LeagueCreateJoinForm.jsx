import React, { useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import { leaguePresetOptions, parseLeagueTeamCount } from "./leagueCreateJoin";

export default function LeagueCreateJoinForm({
  season,
  presets,
  busy: busyExternal = false,
  onBusy,
  onSuccess,
  onError,
}) {
  const [leagueName, setLeagueName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamCount, setTeamCount] = useState(12);
  const [roomCode, setRoomCode] = useState("");
  const [joinTeamName, setJoinTeamName] = useState("");
  const [busyLocal, setBusyLocal] = useState(false);
  const [error, setError] = useState("");
  const [presetId, setPresetId] = useState("salary_cap_auction_v1");

  const busy = busyExternal || busyLocal;
  const formatOptions = leaguePresetOptions(presets);
  const presetLabel = formatOptions.find((p) => p.id === presetId)?.label
    || formatOptions.find((p) => p.id === "salary_cap_auction_v1")?.label
    || "Salary cap auction";

  const setBusy = (next) => {
    setBusyLocal(next);
    onBusy?.(next);
  };

  const fail = (msg) => {
    setError(msg);
    onError?.(msg);
  };

  const createLeague = async () => {
    if (!leagueName.trim()) {
      fail("Enter a league name.");
      return;
    }
    const parsed = parseLeagueTeamCount(teamCount);
    if (!parsed.ok) {
      fail(parsed.error);
      return;
    }
    setBusy(true);
    setError("");
    onError?.("");
    try {
      const res = await apiFetch("/api/hub/league", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: leagueName.trim(),
          season,
          team_count: parsed.count,
          commissioner_team_name: teamName.trim() || "Commissioner",
          preset_id: presetId,
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setLeagueName("");
      setTeamName("");
      onSuccess?.(data, `Created "${data.name}". Room code: ${data.room_code}. Switched to this league.`);
    } catch (e) {
      fail(e.message || "Could not create league");
    } finally {
      setBusy(false);
    }
  };

  const joinLeague = async () => {
    if (!roomCode.trim() || !joinTeamName.trim()) {
      fail("Room code and team name are required to join.");
      return;
    }
    setBusy(true);
    setError("");
    onError?.("");
    try {
      const res = await apiFetch("/api/hub/league/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_code: roomCode.trim().toUpperCase(),
          team_name: joinTeamName.trim(),
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setRoomCode("");
      setJoinTeamName("");
      onSuccess?.(data, `Joined as ${joinTeamName.trim()}. Switched to this league.`);
    } catch (e) {
      fail(e.message || "Could not join league");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="hub-league-setup-grid">
        <form
          className="hub-league-setup-card"
          onSubmit={(e) => {
            e.preventDefault();
            createLeague();
          }}
        >
          <h3>Create a new league</h3>
          <p className="chart-note">
            You become commissioner and get a room code. Format: {presetLabel}.
          </p>
          <div className="hub-form-col">
            <label>
              League name
              <input
                value={leagueName}
                onChange={(e) => setLeagueName(e.target.value)}
                placeholder="Sunday Night Cap League"
                required
              />
            </label>
            <label>
              Your team name
              <input
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="My Team"
              />
            </label>
            <div className="hub-league-field-split">
              <label>
                Draft format
                <select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
                  {formatOptions.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Teams
                <input
                  type="number"
                  min={2}
                  max={20}
                  value={teamCount}
                  onChange={(e) => setTeamCount(e.target.value)}
                  required
                />
              </label>
            </div>
            <button type="submit" className="btn-primary btn-sm" disabled={busy}>
              {busy ? "Creating…" : "Create league"}
            </button>
          </div>
        </form>

        <form
          className="hub-league-setup-card"
          onSubmit={(e) => {
            e.preventDefault();
            joinLeague();
          }}
        >
          <h3>Join with a room code</h3>
          <p className="chart-note">
            Use the room code and team name your commissioner shared. This is full league access, not just draft night.
          </p>
          <div className="hub-form-col">
            <label>
              Room code
              <input
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="ABC123"
                required
              />
            </label>
            <label>
              Team name
              <input
                value={joinTeamName}
                onChange={(e) => setJoinTeamName(e.target.value)}
                placeholder="As listed by commissioner"
                required
              />
            </label>
            <button type="submit" className="btn-ghost btn-sm" disabled={busy}>
              Join league
            </button>
          </div>
        </form>
      </div>
      {error && <div className="error hub-league-create-form-error">{error}</div>}
    </>
  );
}
