import React, { useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";

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
  const presetLabel = presets?.find((p) => p.id === presetId)?.label
    || presets?.find((p) => p.id === "salary_cap_auction_v1")?.label
    || "Salary cap auction";

  const setBusy = (next) => {
    setBusyLocal(next);
    onBusy?.(next);
  };

  const createLeague = async () => {
    if (!leagueName.trim()) {
      const msg = "Enter a league name.";
      setError(msg);
      onError?.(msg);
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
          team_count: Number(teamCount) || 12,
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
      const msg = e.message || "Could not create league";
      setError(msg);
      onError?.(msg);
    } finally {
      setBusy(false);
    }
  };

  const joinLeague = async () => {
    if (!roomCode.trim() || !joinTeamName.trim()) {
      const msg = "Room code and team name are required to join.";
      setError(msg);
      onError?.(msg);
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
      const msg = e.message || "Could not join league";
      setError(msg);
      onError?.(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="hub-league-setup-grid">
      <div className="hub-league-setup-card">
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
          <label>
            Draft format
            <select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
              {(presets || [
                { id: "salary_cap_auction_v1", label: "Salary cap auction" },
                { id: "snake_draft_v1", label: "Snake draft" },
                { id: "linear_draft_v1", label: "Linear draft" },
              ]).map((p) => (
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
            />
          </label>
          <button type="button" className="btn-primary" disabled={busy} onClick={createLeague}>
            {busy ? "Creating…" : "Create league"}
          </button>
        </div>
      </div>

      <div className="hub-league-setup-card">
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
            />
          </label>
          <label>
            Team name
            <input
              value={joinTeamName}
              onChange={(e) => setJoinTeamName(e.target.value)}
              placeholder="As listed by commissioner"
            />
          </label>
          <button type="button" className="btn-ghost" disabled={busy} onClick={joinLeague}>
            Join league
          </button>
        </div>
      </div>
      </div>
      {error && <div className="error hub-league-create-form-error">{error}</div>}
    </>
  );
}
