import React, { useEffect, useRef, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import { HubFilterMenu, HubPage } from "./HubUILayout";
import { CORRECTIONS_COPY as COPY, correctionTeamRows } from "./weekCorrectionsPresentation";
import { clearHubDataCache } from "./hubDataCache";

export default function WeekCorrections({ leagueId, season, onChanged }) {
  const [week, setWeek] = useState(1);
  const [context, setContext] = useState(null);
  const [teams, setTeams] = useState([]);
  const [reason, setReason] = useState("");
  const [acknowledge, setAcknowledge] = useState(false);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const scope = useRef(0);
  const resultRef = useRef(null);
  const base = `/api/hub/league/${encodeURIComponent(leagueId)}/corrections/${season}/${week}`;
  useEffect(() => {
    const generation = ++scope.current;
    setContext(null); setPreview(null); setTeams([]); setError(""); setReason(""); setAcknowledge(false); setBusy(false);
    const controller = new AbortController();
    (async () => {
      try {
        const response = await apiFetch(base, { signal: controller.signal });
        if (!response.ok) throw new Error(await parseApiError(response));
        const data = await response.json();
        if (scope.current !== generation) return;
        setContext(data); setTeams(correctionTeamRows(data));
      } catch (failure) {
        if (scope.current === generation && failure.name !== "AbortError") setError(failure.message);
      }
    })();
    return () => { scope.current += 1; controller.abort(); };
  }, [base, reload]);

  const edit = (teamIndex, playerIndex, field, value) => {
    setPreview(null);
    setTeams(previous => previous.map((team, index) => index !== teamIndex ? team : {
      ...team, players: team.players.map((player, row) => row !== playerIndex ? player : { ...player, [field]: value }),
    }));
  };
  const request = async (publish = false) => {
    const generation = scope.current;
    setBusy(true); setError(""); setNotice("");
    try {
      const body = publish ? {
        preview_id: preview.id, revision: preview.revision, reason: preview.reason, idempotency_key: preview.id,
      } : { teams, reason, revision: context.revision, acknowledge_empty: acknowledge };
      const response = await apiFetch(`${base}/${publish ? "publish" : "preview"}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await parseApiError(response));
      const data = await response.json();
      if (scope.current !== generation) return;
      if (publish) {
        clearHubDataCache();
        setNotice(COPY.published); setPreview(null); setReload(value => value + 1); onChanged?.();
      } else {
        setPreview(data);
        requestAnimationFrame(() => resultRef.current?.focus());
      }
    } catch (failure) {
      if (scope.current === generation) setError(failure.message);
    } finally {
      if (scope.current === generation) setBusy(false);
    }
  };
  const slots = [{ id: "BN", label: "Bench" }, ...Object.entries(context?.slots || {}).flatMap(([position, count]) =>
    Array.from({ length: count }, (_, index) => ({ id: `${position}${index + 1}`, label: `${position} ${index + 1}` })))];
  return <HubPage>
    <h2>{COPY.title}</h2><p>{COPY.support}</p>
    <label>Week <input type="number" min="1" max="18" value={week} disabled={busy}
      onChange={event => { setNotice(""); setWeek(Math.max(1, Math.min(18, Number(event.target.value) || 1))); }} /></label>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!context && !error && <p role="status">{COPY.loading}</p>}
    {context && <>
      {teams.map((team, teamIndex) => <fieldset key={team.team_id} disabled={busy}>
        <legend>{context.teams.find(item => item.id === team.team_id)?.name}</legend>
        {!team.players.length && <p>{COPY.missing}</p>}
        {team.players.map((player, playerIndex) => <div className="hub-filter-bar" key={playerIndex}>
          <label>Player ID <input value={player.player_id} onChange={event => edit(teamIndex, playerIndex, "player_id", event.target.value)} /></label>
          <label>Player name <input value={player.player_name} onChange={event => edit(teamIndex, playerIndex, "player_name", event.target.value)} /></label>
          <HubFilterMenu label="Position" value={player.position} options={["QB", "RB", "WR", "TE", "K", "DEF"].map(id => ({ id, label: id }))}
            onChange={value => edit(teamIndex, playerIndex, "position", value)} disabled={busy} />
          <HubFilterMenu label="Slot" value={player.slot} options={slots} onChange={value => edit(teamIndex, playerIndex, "slot", value)} disabled={busy} />
          <button type="button" className="btn-ghost" aria-label={`${COPY.remove}: ${player.player_name || player.player_id || playerIndex + 1}`}
            onClick={() => { setPreview(null); setTeams(previous => previous.map((item, index) => index !== teamIndex ? item : { ...item, players: item.players.filter((_, row) => row !== playerIndex) })); }}>Remove</button>
        </div>)}
        <button type="button" className="btn-ghost" onClick={() => { setPreview(null); setTeams(previous => previous.map((item, index) => index !== teamIndex ? item : { ...item, players: [...item.players, { player_id: "", player_name: "", nfl_team: "", position: "QB", slot: "BN" }] })); }}>{COPY.add}</button>
      </fieldset>)}
      <label>{COPY.reason}<textarea value={reason} disabled={busy} onChange={event => { setReason(event.target.value); setPreview(null); }} /></label>
      <label><input type="checkbox" checked={acknowledge} disabled={busy} onChange={event => { setAcknowledge(event.target.checked); setPreview(null); }} />{COPY.empty}</label>
      <button type="button" className={preview ? "btn-ghost" : "btn-primary"} disabled={busy || reason.trim().length < 3} onClick={() => request()}>{COPY.preview}</button>
      {preview && <section ref={resultRef} tabIndex={-1} aria-live="polite">
        <h3>Review Week {week}</h3>
        {preview.blockers.map(blocker => <p key={blocker} role="alert">{blocker}</p>)}
        <table><caption>Scores and standings</caption><thead><tr><th>Team</th><th>Score before</th><th>Score after</th><th>Record before</th><th>Record after</th></tr></thead>
          <tbody>{preview.after.standings.map(row => {
            const prior = preview.before.standings.find(item => item.team_id === row.team_id);
            return <tr key={row.team_id}><td>{row.name}</td><td>{preview.before.scores.find(item => item.team_id === row.team_id)?.points ?? "Not recorded"}</td>
              <td>{preview.after.scores.find(item => item.team_id === row.team_id)?.points}</td><td>{prior?.wins}-{prior?.losses}-{prior?.ties}</td><td>{row.wins}-{row.losses}-{row.ties}</td></tr>;
          })}</tbody></table>
        <button type="button" className="btn-primary" disabled={busy || !preview.can_publish} onClick={() => request(true)}>{COPY.publish}</button>
      </section>}
      <h3>{COPY.history}</h3>
      {(context.history || []).map(item => <div key={item.id}><p>{item.published_at} · {item.reason}</p>
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => {
          setTeams(correctionTeamRows({ ...context, lineups: item.before.lineups }));
          setReason(`Reverse correction: ${item.reason}`); setAcknowledge(false); setPreview(null);
        }}>Review reversal</button></div>)}
    </>}
  </HubPage>;
}
